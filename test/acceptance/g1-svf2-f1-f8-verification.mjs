// test/acceptance/g1-svf2-f1-f8-verification.mjs
//
// ============================================================================================
//  VERIFICATION-ONLY HARNESS -- NOT PART OF `npm test`, NOT WIRED INTO server.js OR ANY ROUTE,
//  NOT a production module. This file is never imported by `wwwroot/viewer.js` or any other
//  production code, adds no npm script, and starts no server.
//
//  Authorization: docs/prompts/g1-f1-f8-harness-implementation-authorization.md
//  Governing plan: docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md
//
//  IMPLEMENTED, NOT EXECUTED. Every piece of this harness's own logic -- the classifier,
//  `computeOverall`, the control-state model, the 22-step cleanup executor, the browser-owned
//  load-record protocol, page-routing/manifest/error-ledger logic, F1-F8's own evidence
//  collection, all 9 mandatory controls, and the full Phase 0-11 composition (`runHarness`) --
//  is written and offline-tested (fakes/`node:vm`, zero real Playwright import anywhere in any
//  test). `main()` is the ONLY place real Playwright objects are ever constructed, and it is
//  gated behind an explicit, fail-closed activation interlock (both a `--execute-live-f1-f8`
//  CLI flag AND a `G1_F1_F8_LIVE_AUTHORIZED=YES` environment variable, checked before any
//  dynamic `import('playwright')`, browser launch, or other real side effect). Neither
//  condition's presence is proof of owner authorization by itself -- live F1-F8 execution
//  requires separate, explicit authorization per the authorization file linked above, regardless
//  of whether these mechanical safeguards are satisfied. Whether this harness has actually been
//  RUN, and with what result, is recorded in this repository's own handoff/review artifacts
//  (`docs/handoffs/latest.md`, `docs/reviews/`), never in this source file's own banner --
//  treat this comment as a description of the CODE's own state, not of any particular run.
// ============================================================================================

import { randomUUID, createHash } from 'node:crypto';
import { readFile as nodeReadFile, writeFile as nodeWriteFile, rename as nodeRename, mkdir as nodeMkdir, unlink as nodeUnlink } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// Stage 5: compactAndWeld/the collision engine's own limit constants are PURE, already-tested
// production code with no live-Viewer/browser dependency at all (confirmed by direct source
// read -- see the Stage 5 report) -- imported here for genuine, real (never faked/simulated)
// Node-side use by the invalid-geometry-consumer/capacity-breach controls and F5's own scoring.
// This is a Node-side-only import; no in-page function may reference it directly (the
// established "in-page functions reference only their own argument and page globals"
// constraint) -- an in-page function instead reads the SAME production module from
// window.__g1.mod, exactly like observeF1 already does for extractFragments/digestSubtree.
import { compactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';
import { maxCollisionInstancesPerEpoch, maxSyncTriangleCount, maxFragmentsPerDbId, maxChildrenPerNode as MAX_CHILDREN_PER_NODE_LIMIT } from '../../collision/constants.js';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------------------------------
// Verdict / state enums -- exported constants matching the plan's own vocabulary verbatim.
// Do not invent alternate spellings; later stages import these rather than re-deriving them.
// ------------------------------------------------------------------------------------------

/** readFormat's classifier outcome (plan §4.1). */
const CLASSIFIER = Object.freeze({
  CONFIRMED_SVF2: 'CONFIRMED_SVF2',
  CONFIRMED_NON_SVF2: 'CONFIRMED_NON_SVF2',
  CONTRADICTORY: 'CONTRADICTORY',
  INDETERMINATE_PARTIAL: 'INDETERMINATE_PARTIAL',
  INDETERMINATE_UNAVAILABLE: 'INDETERMINATE_UNAVAILABLE',
});

/** Per-check (Fi) verdict enum (plan §6.3). */
const CHECK_VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  NOT_EVIDENCED: 'NOT_EVIDENCED',
});

/** Overall G1 gate verdict enum (plan §6.3). */
const OVERALL_VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
});

/** ControlResult.state enum (plan §6.3a). */
const CONTROL_STATE = Object.freeze({
  DETECTED_RESTORED: 'DETECTED_RESTORED',
  NOT_DETECTED: 'NOT_DETECTED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  TIMED_OUT: 'TIMED_OUT',
  NOT_EXECUTABLE: 'NOT_EXECUTABLE',
});

/** viewerScriptIntegrity / integrityResult enum (plan §6.3, the five-row table). */
const INTEGRITY_RESULT = Object.freeze({
  VERIFIED: 'VERIFIED',
  MISMATCH: 'MISMATCH',
  FETCH_FAILED: 'FETCH_FAILED',
  CAPTURE_UNAVAILABLE: 'CAPTURE_UNAVAILABLE',
  PROVENANCE_AMBIGUOUS: 'PROVENANCE_AMBIGUOUS',
});

/** Per-operation Token.state enum (plan §6.4a). Not itself in the brief's enum list, but
 * exported for the same reason as the others: later stages must not re-invent the spelling. */
const TOKEN_STATE = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  TIMED_OUT: 'timed-out',
  DISPOSED: 'disposed',
  ABANDONED: 'abandoned',
});

// ------------------------------------------------------------------------------------------
// §4.1 -- Fail-closed format classifier
// ------------------------------------------------------------------------------------------

/** Sentinel used internally (and on the returned object) when a signal method is absent. This
 * is a plain string, not a Symbol, so the return value of readFormat() stays JSON-safe for
 * retention as evidence by a later stage. */
const READ_FORMAT_UNAVAILABLE = 'UNAVAILABLE';

function readSignal(model, methodName) {
  const fn = model && model[methodName];
  return typeof fn === 'function' ? fn.call(model) : READ_FORMAT_UNAVAILABLE;
}

/**
 * readFormat(model) -- the exact 5-outcome state machine from plan §4.1, evaluated once,
 * deliberately never an OR (either flag true is enough) and never a bare AND (both must be
 * true with no room for one API being absent).
 *
 * Accepts any object exposing `isOTG`/`isSVF2` as functions, or lacking either/both (the
 * absent case is treated identically to a real Viewer `Model` whose API surface doesn't
 * expose that method on this Viewer version) -- so a plain fake object works in an offline
 * test, not only a real Viewer `Model`.
 *
 * Returns `{ classifier, otg, svf2 }`: `classifier` is one of the CLASSIFIER enum values
 * (the value a later stage feeds into computeOverall()'s `classifier` input); `otg`/`svf2`
 * retain the raw signal values (`true`, `false`, or the `'UNAVAILABLE'` sentinel) as
 * diagnostic evidence, since the plan's own pseudocode names
 * `INDETERMINATE_PARTIAL(available_signal, available_value)` as carrying which signal was
 * available and its value.
 */
function readFormat(model) {
  const otg = readSignal(model, 'isOTG');
  const svf2 = readSignal(model, 'isSVF2');

  const otgAvailable = otg !== READ_FORMAT_UNAVAILABLE;
  const svf2Available = svf2 !== READ_FORMAT_UNAVAILABLE;

  let classifier;
  if (otgAvailable && svf2Available) {
    if (otg === true && svf2 === true) {
      classifier = CLASSIFIER.CONFIRMED_SVF2;
    } else if (otg === false && svf2 === false) {
      classifier = CLASSIFIER.CONFIRMED_NON_SVF2;
    } else {
      classifier = CLASSIFIER.CONTRADICTORY;
    }
  } else if (otgAvailable !== svf2Available) {
    classifier = CLASSIFIER.INDETERMINATE_PARTIAL;
  } else {
    classifier = CLASSIFIER.INDETERMINATE_UNAVAILABLE;
  }

  return { classifier, otg, svf2 };
}

// ------------------------------------------------------------------------------------------
// §4.2 -- Bounded, JSON-safe, secret-redacting error serializer (describeError)
// ------------------------------------------------------------------------------------------

// Named constants for the byte-cap/depth-cap/breadth-cap the plan requires but does not itself
// number -- picked here and documented, per the brief.
const DESCRIBE_ERROR_MAX_STACK_BYTES = 2048;
const DESCRIBE_ERROR_MAX_DEPTH = 4;
const DESCRIBE_ERROR_MAX_ARRAY_ITEMS = 20;
const DESCRIBE_ERROR_MAX_OBJECT_KEYS = 20;
// Depth x breadth alone only loosely bounds the worst case (a maximally-wide tree up to
// DESCRIBE_ERROR_MAX_DEPTH deep, each level fanning out to DESCRIBE_ERROR_MAX_ARRAY_ITEMS /
// DESCRIBE_ERROR_MAX_OBJECT_KEYS children, is ~168k nodes) -- NOT a fixed byte cap the way
// DESCRIBE_ERROR_MAX_STACK_BYTES bounds the stack field alone. This is the running
// total-serialized-size cap plan §4.2 itself requires ("cap ... total serialized size per
// error"), independent of depth/breadth: a wide-but-shallow structure (many small siblings,
// each individually within every per-level cap) can still blow past this before either the
// depth or the breadth cap ever fires.
const DESCRIBE_ERROR_MAX_TOTAL_BYTES = 8192;
const DESCRIBE_ERROR_REDACTION_PLACEHOLDER = '[REDACTED]';

// Only these top-level scalar fields are allowlisted; everything else at the top level is
// ignored unless it is one of the four named structured fields below -- never an unbounded
// generic object walk of the top-level error.
const DESCRIBE_ERROR_STRUCTURED_WALK_KEYS = Object.freeze(['errors', 'details', 'limit', 'requested']);

// Secret-shaped string patterns. Not enumerated by the plan (only the requirement is named),
// so these are this task's own documented design choice.
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
// Matches the rest of the line (not just the first \S+ token) so this pattern is idempotent
// when applied AFTER BEARER_TOKEN_PATTERN already redacted an embedded bearer token -- re-
// matching "Authorization: [REDACTED]" must reproduce the same string, never re-prefix it.
const AUTHORIZATION_HEADER_PATTERN = /\bAuthorization\s*:\s*[^\n]+/gi;
const COOKIE_HEADER_PATTERN = /\bCookie\s*:\s*[^\n]+/gi;
const SENSITIVE_QUERY_PARAM_NAMES = new Set([
  'signature', 'sig', 'token', 'access_token', 'x-amz-signature', 'x-amz-credential',
  'authorization', 'apikey', 'api_key', 'secret', 'client_secret',
]);

function truncateStringBytes(str, maxBytes) {
  const full = Buffer.from(str, 'utf8');
  if (full.byteLength <= maxBytes) return { value: str, truncated: false };
  let end = maxBytes;
  // Back off out of a multi-byte UTF-8 continuation sequence (10xxxxxx) so the truncated
  // string is never garbled by an incomplete trailing code point.
  while (end > 0 && (full[end] & 0xc0) === 0x80) end -= 1;
  return { value: full.subarray(0, end).toString('utf8'), truncated: true };
}

function redactSensitiveQueryParams(str, markRedacted) {
  try {
    const url = new URL(str);
    let changed = false;
    for (const name of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAM_NAMES.has(name.toLowerCase())) {
        url.searchParams.set(name, DESCRIBE_ERROR_REDACTION_PLACEHOLDER);
        changed = true;
      }
    }
    if (changed) {
      markRedacted();
      return url.toString();
    }
    return str;
  } catch {
    // Not a full absolute URL -- fall back to a lightweight bare-query-string pattern
    // (`?token=abc&x=1`) or a param embedded mid-string.
  }
  return str.replace(/([?&])([A-Za-z0-9_-]+)=([^&\s]+)/g, (match, sep, name) => {
    if (SENSITIVE_QUERY_PARAM_NAMES.has(name.toLowerCase())) {
      markRedacted();
      return `${sep}${name}=${DESCRIBE_ERROR_REDACTION_PLACEHOLDER}`;
    }
    return match;
  });
}

/** true once the running total-serialized-size charge (state.totalBytes) has exceeded
 * DESCRIBE_ERROR_MAX_TOTAL_BYTES -- checked before doing any further work on a node. */
function overTotalBudget(state) {
  return state.totalBytes > DESCRIBE_ERROR_MAX_TOTAL_BYTES;
}

/** Adds an approximate serialized-byte charge for `value` to the running per-error total.
 * Deliberately a cheap proportional estimate (raw UTF-8 byte length of the primitive, or of
 * a small pre-built marker object's JSON form) rather than re-serializing the whole
 * in-progress result on every leaf, which would make an already-bounded walk quadratic. */
function chargeBytes(state, value) {
  let size;
  if (typeof value === 'string') size = Buffer.byteLength(value, 'utf8');
  else if (typeof value === 'object' && value !== null) size = Buffer.byteLength(JSON.stringify(value) || '', 'utf8');
  else size = Buffer.byteLength(String(value), 'utf8');
  state.totalBytes += size;
}

/**
 * Redacts, then caps `str` to at most whatever remains of the total-bytes budget (never more,
 * never negative), reusing the same byte-safe truncation as `stack`'s own fixed-cap handling.
 * Sets `state.truncated = true` whenever the string itself had to be shortened for size reasons.
 *
 * This is the single-leaf counterpart to the mid-loop/entry-of-normalizeValue total-budget
 * checks: without it, a bare string charge (`chargeBytes` alone, with no cap) let one oversized
 * string -- e.g. a large response body embedded in `details`, exactly plan §4.2's own named
 * motivation for this cap -- blow the total budget by an arbitrary amount in a single, uncapped
 * charge. Because the entry-level `overTotalBudget()` check runs BEFORE a node is processed
 * (not after), that single-leaf overage would otherwise never set `truncated` at all: the
 * budget was fine walking in, and by the time it wasn't, the whole (uncapped) string was
 * already returned. Capping each string TO the remaining budget, right where it's produced,
 * closes that gap.
 */
function chargeStringValue(str, path, state) {
  const redacted = redactString(str, path, state);
  const remainingBudget = Math.max(0, DESCRIBE_ERROR_MAX_TOTAL_BYTES - state.totalBytes);
  const { value, truncated } = truncateStringBytes(redacted, remainingBudget);
  if (truncated) state.truncated = true;
  chargeBytes(state, value);
  return value;
}

function redactString(str, path, state) {
  if (typeof str !== 'string') return str;
  let result = str;
  let redacted = false;
  const mark = () => { redacted = true; };

  result = result.replace(BEARER_TOKEN_PATTERN, () => { mark(); return DESCRIBE_ERROR_REDACTION_PLACEHOLDER; });
  result = result.replace(AUTHORIZATION_HEADER_PATTERN, () => { mark(); return `Authorization: ${DESCRIBE_ERROR_REDACTION_PLACEHOLDER}`; }); // idempotent: replaces the whole remainder of the line
  result = result.replace(COOKIE_HEADER_PATTERN, () => { mark(); return `Cookie: ${DESCRIBE_ERROR_REDACTION_PLACEHOLDER}`; });
  result = redactSensitiveQueryParams(result, mark);

  if (redacted) state.redactions.push({ path, type: 'secret-shaped-string' });
  return result;
}

function normalizeScalar(value, path, state) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return chargeStringValue(value, path, state);
  if (typeof value === 'number' || typeof value === 'boolean') {
    chargeBytes(state, value);
    return value;
  }
  // Unexpected shape in a scalar slot (e.g. a non-Error `reason` object) -- stringify
  // defensively rather than throwing or silently dropping it.
  return chargeStringValue(String(value), path, state);
}

function normalizeStack(stack, state) {
  if (stack === undefined || stack === null) return null;
  const str = typeof stack === 'string' ? stack : String(stack);
  const redacted = redactString(str, 'stack', state);
  // `stack` keeps its own fixed byte cap (plan §4.2 names it explicitly), but is ALSO capped by
  // whatever remains of the total budget once name/message/code/reason were already charged --
  // the stricter of the two always wins, so stack can never itself push the total over budget.
  const remainingBudget = Math.max(0, DESCRIBE_ERROR_MAX_TOTAL_BYTES - state.totalBytes);
  const cap = Math.min(DESCRIBE_ERROR_MAX_STACK_BYTES, remainingBudget);
  const { value, truncated } = truncateStringBytes(redacted, cap);
  if (truncated) state.truncated = true;
  chargeBytes(state, value);
  return value;
}

function isTypedArray(value) {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function normalizeTypedArray(value) {
  const typedArrayName = (value.constructor && value.constructor.name) || 'TypedArray';
  const sampleLength = Math.min(value.length, DESCRIBE_ERROR_MAX_ARRAY_ITEMS);
  const sample = [];
  for (let i = 0; i < sampleLength; i += 1) sample.push(value[i]);
  return {
    typedArray: typedArrayName,
    length: value.length,
    sample,
    truncated: value.length > DESCRIBE_ERROR_MAX_ARRAY_ITEMS,
  };
}

function isDomExceptionShaped(value) {
  if (typeof DOMException !== 'undefined' && value instanceof DOMException) return true;
  return Boolean(
    value
    && typeof value.name === 'string'
    && typeof value.message === 'string'
    && value.constructor
    && value.constructor.name === 'DOMException',
  );
}

function normalizeErrorLike(value, path, state) {
  const result = {
    name: normalizeScalar(value.name, `${path}.name`, state),
    message: normalizeScalar(value.message, `${path}.message`, state),
  };
  if ('code' in value) result.code = normalizeScalar(value.code, `${path}.code`, state);
  if ('stack' in value) result.stack = normalizeStack(value.stack, state);
  return result;
}

function normalizeValue(value, path, depth, visited, state) {
  // Running total-serialized-size cap (DESCRIBE_ERROR_MAX_TOTAL_BYTES), checked before doing
  // any further work on this node: once prior siblings/ancestors have already charged past the
  // budget, every subsequent node -- at any depth, in any container -- is truncated on entry.
  // Combined with the mid-loop check below (which stops a container from even starting to
  // process further children once the budget tips over mid-walk), this bounds total output
  // size independently of the depth/breadth caps, which only bound per-level fan-out.
  if (overTotalBudget(state)) {
    state.truncated = true;
    return { truncated: true };
  }

  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return chargeStringValue(value, path, state);
  if (typeof value === 'number' || typeof value === 'boolean') {
    chargeBytes(state, value);
    return value;
  }
  if (typeof value === 'function') {
    const marker = { unsupportedType: 'function' };
    chargeBytes(state, marker);
    return marker;
  }

  if (isTypedArray(value)) {
    const marker = normalizeTypedArray(value);
    chargeBytes(state, marker);
    return marker;
  }
  if (value instanceof DataView) {
    const marker = { unsupportedType: 'DataView', byteLength: value.byteLength };
    chargeBytes(state, marker);
    return marker;
  }

  if (typeof value !== 'object') {
    return chargeStringValue(String(value), path, state);
  }

  if (visited.has(value)) {
    const marker = { circular: true };
    chargeBytes(state, marker);
    return marker;
  }

  if (depth >= DESCRIBE_ERROR_MAX_DEPTH) {
    state.truncated = true;
    return { truncated: true };
  }

  visited.add(value);
  try {
    if (Array.isArray(value)) {
      const limited = value.slice(0, DESCRIBE_ERROR_MAX_ARRAY_ITEMS);
      const items = [];
      for (let i = 0; i < limited.length; i += 1) {
        if (overTotalBudget(state)) {
          state.truncated = true;
          items.push({ truncated: true });
          break;
        }
        items.push(normalizeValue(limited[i], `${path}[${i}]`, depth + 1, visited, state));
      }
      if (value.length > DESCRIBE_ERROR_MAX_ARRAY_ITEMS) state.truncated = true;
      return items;
    }

    if (value instanceof Error || isDomExceptionShaped(value)) {
      return normalizeErrorLike(value, path, state);
    }

    const allKeys = Object.keys(value);
    const keys = allKeys.slice(0, DESCRIBE_ERROR_MAX_OBJECT_KEYS);
    const result = {};
    for (const key of keys) {
      if (overTotalBudget(state)) {
        state.truncated = true;
        result.truncated = true;
        break;
      }
      result[key] = normalizeValue(value[key], `${path}.${key}`, depth + 1, visited, state);
    }
    if (allKeys.length > DESCRIBE_ERROR_MAX_OBJECT_KEYS) {
      state.truncated = true;
      result.truncated = true;
    }
    return result;
  } finally {
    visited.delete(value);
  }
}

/**
 * describeError(e) -- the bounded, JSON-safe, secret-redacting error serializer required by
 * plan §4.2. Every error object retained anywhere in this harness's evidence must be passed
 * through this function before being written into `loadError`, `errorLedger` entries,
 * `cleanupFailures`, or any control/check `reason` field.
 *
 * Contract (plan §4.2):
 *  - allowlists scalar fields only (`name`, `message`, `code`, `reason`, `stack` truncated to
 *    DESCRIBE_ERROR_MAX_STACK_BYTES) plus a bounded, depth-capped walk of the four named
 *    structured fields (`errors`, `details`, `limit`, `requested`) -- never an unbounded
 *    generic walk of the top-level error object;
 *  - caps recursion depth (DESCRIBE_ERROR_MAX_DEPTH), per-object breadth
 *    (DESCRIBE_ERROR_MAX_ARRAY_ITEMS / DESCRIBE_ERROR_MAX_OBJECT_KEYS), AND the running total
 *    serialized size of the whole output (DESCRIBE_ERROR_MAX_TOTAL_BYTES) -- the depth/breadth
 *    caps alone only bound per-level fan-out, not a wide-but-shallow tree's cumulative size, so
 *    the total-bytes cap is tracked independently and can truncate the walk even when neither
 *    the depth nor the breadth cap has individually fired. The total cap is enforced BOTH
 *    between siblings (a container stops processing further children once the running total
 *    tips over mid-walk) AND within a single string leaf (every string -- `stack`, every other
 *    scalar field, and every string reached via the structured-field walk -- is itself capped
 *    to whatever remains of the total budget before being charged, exactly like a large
 *    embedded response body would be, per this section's own named motivation), so one
 *    oversized leaf can never blow the total by an arbitrary amount in a single uncapped
 *    charge. Anything shortened or dropped for size reasons is replaced with (or, for a
 *    string, truncated the same byte-safe way `stack` already was) a `{ truncated: true }`
 *    marker where a whole value is dropped, and the top-level `truncated` flag is always set --
 *    informational loss is always visible, never silent;
 *  - detects and breaks circular references via a `WeakSet`-tracked visited-node guard,
 *    replacing a re-encountered object with `{ circular: true }`, rather than letting
 *    `JSON.stringify` throw;
 *  - normalizes typed arrays, `Error` instances, and `DOMException`-shaped objects to plain,
 *    serializable structures;
 *  - redacts bearer-token/`Authorization`-header/cookie-shaped strings and known-sensitive URL
 *    query params (signature/token/secret-shaped param names) wherever they appear, replacing
 *    each redacted span with a fixed placeholder and recording every redaction in the returned
 *    `redactions: [...]` list (never silently invisible).
 *
 * Returns a plain, JSON-safe object: `{ name, message, code, reason, stack, [errors],
 * [details], [limit], [requested], truncated, redactions }`. `errors`/`details`/`limit`/
 * `requested` are present only if the input error object had that field defined.
 */
function describeError(e) {
  const state = { truncated: false, redactions: [], totalBytes: 0 };

  if (e === null || e === undefined) {
    return { name: null, message: String(e), code: null, reason: null, stack: null, truncated: false, redactions: [] };
  }

  if (typeof e !== 'object' && typeof e !== 'function') {
    const message = chargeStringValue(String(e), 'message', state);
    return {
      name: null,
      message,
      code: null,
      reason: null,
      stack: null,
      truncated: state.truncated,
      redactions: state.redactions,
    };
  }

  const visited = new WeakSet();
  visited.add(e);

  const out = {
    name: normalizeScalar(e.name, 'name', state),
    message: normalizeScalar(e.message, 'message', state),
    code: normalizeScalar(e.code, 'code', state),
    reason: normalizeScalar(e.reason, 'reason', state),
    stack: normalizeStack(e.stack, state),
  };

  for (const key of DESCRIBE_ERROR_STRUCTURED_WALK_KEYS) {
    if (key in e && e[key] !== undefined) {
      out[key] = normalizeValue(e[key], key, 1, visited, state);
    }
  }

  out.truncated = state.truncated;
  out.redactions = state.redactions;
  return out;
}

// ------------------------------------------------------------------------------------------
// §6.4a (named paragraphs only) -- generic per-operation Token
// ------------------------------------------------------------------------------------------

// Stage 2 correction (documented, evidenced deviation from Stage 1's own original comment/
// tests -- see plan §6.4a, read in full for Stage 2, lines cited below; Stage 1 only read the
// two named "Per-operation tokens"/"Three-way cancellation classification" paragraphs, which
// name only `timed-out -> abandoned` and did not mention the drain mechanism's own, EARLIER,
// DIFFERENT transition): `timed-out -> disposed` IS a real, required, plan-mandated transition,
// distinct from `timed-out -> abandoned`. Plan §6.4a "Drain (Node, value only --
// `drainLoadToken`)": "Node moves `timed-out → disposed` only when that snapshot is present,
// generation-matched, and ownership-clean" -- reached while the page realm is STILL ALIVE, via
// a confirmed-clean in-page snapshot (sealing/late-arrival disposition already resolved the
// record). `timed-out -> abandoned` (§4.3 step 20a) is the DIFFERENT, LATER, POST-TEARDOWN
// transition for a token whose ownership could never be confirmed clean before the realm was
// destroyed. Both are legal from `timed-out`; neither is reachable from the other constraint's
// own case (a token that reaches `disposed` via drain is already terminal-and-clean and never
// needs step 20a; a token step 20a reaches was never confirmed clean, so drain already gave up
// on it). Also confirmed at plan lines 140 ("'timed-out' → 'disposed' only on an in-page
// snapshot..."), 212 (resource-ownership table's token row), and the terminal-state-machine
// table's own Cases A/B/C (each show `timed-out → disposed` as the normal, non-abandoned
// resolution). `timed-out -> completed` remains illegal (a timed-out record can never revive to
// completed -- plan §6.4a "Why a timed-out or late load can never become PASS", point 1).
const TOKEN_TRANSITIONS = Object.freeze({
  [TOKEN_STATE.ACTIVE]: new Set([TOKEN_STATE.COMPLETED, TOKEN_STATE.TIMED_OUT, TOKEN_STATE.DISPOSED]),
  [TOKEN_STATE.TIMED_OUT]: new Set([TOKEN_STATE.DISPOSED, TOKEN_STATE.ABANDONED]),
  [TOKEN_STATE.COMPLETED]: new Set(),
  [TOKEN_STATE.DISPOSED]: new Set(),
  [TOKEN_STATE.ABANDONED]: new Set(),
});

/** Thrown by transitionToken() for any transition not present in TOKEN_TRANSITIONS. This
 * module's documented choice (per the brief: "throw or return an explicit rejection, your
 * choice, but be consistent") is to throw, always. */
class TokenTransitionError extends Error {
  constructor(token, toState) {
    super(`Token ${token.id}: illegal transition '${token.state}' -> '${toState}'`);
    this.name = 'TokenTransitionError';
    this.tokenId = token.id;
    this.fromState = token.state;
    this.toState = toState;
  }
}

// Tracks every id ever minted so uniqueness is an enforced invariant, not merely a
// probabilistic property of randomUUID().
const mintedTokenIds = new Set();

/**
 * createToken(meta) -- mints a token with a unique id and state: 'active'. `meta` is an
 * opaque, caller-supplied bag (e.g. which operation this token guards) retained on the
 * returned object but never inspected by this module.
 */
function createToken(meta = {}) {
  let id = randomUUID();
  while (mintedTokenIds.has(id)) id = randomUUID();
  mintedTokenIds.add(id);
  return { id, state: TOKEN_STATE.ACTIVE, meta };
}

/**
 * transitionToken(token, toState) -- enforces the state machine `active -> (completed |
 * timed-out | disposed)`, plus the two transitions reachable from `timed-out`: `disposed` (via
 * a confirmed-ownership-clean drain, plan §6.4a -- reached while the realm is still alive) and
 * the post-teardown `abandoned` (§4.3 step 20a -- reached only once the realm is confirmed
 * destroyed and ownership could never be confirmed clean beforehand; see TOKEN_TRANSITIONS'
 * own comment for the full citation trail -- a Stage 2 correction to Stage 1's original,
 * narrower comment here). No transition out of a terminal state (`completed`, `disposed`,
 * `abandoned`) is ever allowed; `abandoned` is only reachable from `timed-out`, never from
 * `active` directly, and `timed-out -> completed` remains illegal (a timed-out record can
 * never revive to completed). Mutates `token.state` in place and returns it on success; throws
 * TokenTransitionError on an illegal transition (the token is left unmodified).
 */
function transitionToken(token, toState) {
  const allowed = TOKEN_TRANSITIONS[token.state];
  if (!allowed || !allowed.has(toState)) {
    throw new TokenTransitionError(token, toState);
  }
  token.state = toState;
  return token;
}

/**
 * isTokenLive(token) -- the reusable continuation-guard idiom every later stage's async
 * continuation calls as its first statement: `if (!isTokenLive(token)) return;` is exactly
 * the plan's own `if (token.state !== 'active') return;` idiom.
 */
function isTokenLive(token) {
  return Boolean(token) && token.state === TOKEN_STATE.ACTIVE;
}

// ------------------------------------------------------------------------------------------
// §6.3a -- Mandatory-control ControlResult model
// ------------------------------------------------------------------------------------------

// Fixed per-control classification table (plan lines 839-851): the nine mandatory controls
// mapped to their fixed `restorationRequired` value. `true` = shared-state perturbation
// (restoration oracle); `false` = harness-local isolated synthetic perturbation
// (non-interference oracle). Never computed at run time -- later stages import this constant
// rather than re-deriving it.
const CONTROL_RESTORATION_REQUIRED = Object.freeze({
  'tree-unavailable': true,
  'wrong-owner': true,
  'late-completion-after-timeout': false,
  'hidden-fragment': true,
  'invalid-geometry-consumer': false,
  'capacity-breach': true,
  'invalid-bounds': true,
  'bounds-beyond-tolerance': true,
  'stale-old-model-event': true,
});

const CONTROL_NAMES = Object.freeze(Object.keys(CONTROL_RESTORATION_REQUIRED));

// Exact field expectations per ControlResult.state, per plan §6.3a's state-definitions table
// (lines 831-837). `undefined` for a field means that state's `restored` is "attempted
// regardless" (NOT_DETECTED) and is not constrained to a single fixed value here.
const CONTROL_STATE_FIELD_EXPECTATIONS = Object.freeze({
  [CONTROL_STATE.DETECTED_RESTORED]: { executed: true, detected: true, restored: true },
  [CONTROL_STATE.NOT_DETECTED]: { executed: true, detected: false },
  [CONTROL_STATE.RESTORE_FAILED]: { executed: true, detected: true, restored: false },
  [CONTROL_STATE.TIMED_OUT]: { executed: true, detected: null, restored: null },
  [CONTROL_STATE.NOT_EXECUTABLE]: { executed: false, detected: null, restored: null },
});

/**
 * validateControlResult(controlName, record) -- rejects a malformed ControlResult: an
 * out-of-enum `state`, a `restorationRequired` that disagrees with this control's fixed
 * classification (CONTROL_RESTORATION_REQUIRED), or `executed`/`detected`/`restored` values
 * that disagree with CONTROL_STATE_FIELD_EXPECTATIONS for the declared `state`. Returns
 * `{ valid: boolean, errors: string[] }`; never throws.
 */
function validateControlResult(controlName, record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['record must be an object'] };
  }

  if (!Object.values(CONTROL_STATE).includes(record.state)) {
    errors.push(`state '${record.state}' is not a valid ControlResult state`);
  }

  const expectedRestorationRequired = CONTROL_RESTORATION_REQUIRED[controlName];
  if (expectedRestorationRequired === undefined) {
    errors.push(`unknown control name '${controlName}'`);
  } else if (record.restorationRequired !== expectedRestorationRequired) {
    errors.push(
      `restorationRequired ${record.restorationRequired} disagrees with the fixed classification `
      + `${expectedRestorationRequired} for control '${controlName}'`,
    );
  }

  const expectations = CONTROL_STATE_FIELD_EXPECTATIONS[record.state];
  if (expectations) {
    for (const field of ['executed', 'detected', 'restored']) {
      if (!(field in expectations)) continue; // unconstrained for this state (e.g. NOT_DETECTED's `restored`)
      if (record[field] !== expectations[field]) {
        errors.push(`field '${field}' = ${record[field]} disagrees with the expected value ${expectations[field]} for state '${record.state}'`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * createControlResult(controlName, fields) -- constructs a well-formed ControlResult (the 5
 * fields: `state`, `executed`, `detected`, `restored`, `restorationRequired`, `reason`),
 * deriving `restorationRequired` from the fixed CONTROL_RESTORATION_REQUIRED table rather
 * than accepting it as caller input, then validates the assembled record and throws if it is
 * malformed. This never permissively emits `DETECTED_RESTORED` for an unearned input: the
 * validator's field-expectation check means a caller cannot claim `DETECTED_RESTORED` while
 * passing `detected: false`, for example.
 */
function createControlResult(controlName, { state, executed, detected, restored, reason = null }) {
  if (!(controlName in CONTROL_RESTORATION_REQUIRED)) {
    throw new Error(`createControlResult: unknown control name '${controlName}'`);
  }
  const record = {
    state,
    executed,
    detected,
    restored,
    restorationRequired: CONTROL_RESTORATION_REQUIRED[controlName],
    reason,
  };
  const validation = validateControlResult(controlName, record);
  if (!validation.valid) {
    throw new Error(`createControlResult: invalid record for '${controlName}': ${validation.errors.join('; ')}`);
  }
  return record;
}

// ------------------------------------------------------------------------------------------
// §6.3 -- Overall G1 gate verdict (computeOverall)
// ------------------------------------------------------------------------------------------

const F_CHECK_NAMES = Object.freeze(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
const VALID_INTEGRITY_VALUES = new Set(Object.values(INTEGRITY_RESULT));

/**
 * `buildCheckRecord({verdict, reason, fields, evidence})` -- fix wave (final whole-branch
 * review, Important I4). Plan §8's own JSON sketch (line 1199): every `checks.F*` entry is a
 * full `{verdict, reason, fields, evidence}` record, never a bare verdict string. `fields` is
 * each check's own already-observed raw field set (exactly what its `scoreF*`/`observeF*`
 * already returns); `evidence` is execution PROVENANCE ONLY (never a duplicate of `fields`):
 * `{status: 'observed'|'observation-failed'|'not-run', error, blockedBy}` --
 * `status: 'observed'` means the check's own scoring logic actually ran against real observed
 * fields; `'observation-failed'` means the in-page observe call itself returned `ok: false` (or
 * F6's own equivalent), so `fields` is `{}` and `verdict` is fail-closed `BLOCKED`;
 * `'not-run'` means this check's own phase was never reached at all this run (`blockedBy`
 * names why: `'classifier'` for a classifier-stop, `'fatal-error'` for a mid-sequence abort).
 * `error`, when present, has already passed through `describeError` (JSON-safe, secret-
 * redacted) -- never a raw Error/live object.
 *
 * Deliberately does NOT change what `computeOverall` consumes (Stage 1's own frozen, pure,
 * extensively-tested `checks[name] === CHECK_VERDICT.FAIL/PASS` bare-string contract, confirmed
 * unchanged by direct read) -- `runHarness` derives a separate bare-string projection via
 * `projectCheckVerdicts` (below) purely for that one call, and this richer record is what
 * actually gets persisted into the result's own `checks` field. codex-advisor (medium, this fix
 * wave): confirmed this is the correct design -- computeOverall's own documented/implemented
 * string-input contract must never be reopened for this, and a single canonical `checks` object
 * (never two independently-maintained maps) avoids a realistic drift failure between them.
 */
function buildCheckRecord({ verdict, reason = null, fields = {}, evidence = {} }) {
  return {
    verdict,
    reason,
    fields: fields || {},
    evidence: {
      status: evidence.status || 'observed',
      error: evidence.error || null,
      blockedBy: evidence.blockedBy || null,
    },
  };
}

/** `projectCheckVerdicts(checks)` -- the bare-string `{F1: 'PASS', ...}` shape computeOverall's
 * own unchanged contract requires, derived from the canonical rich `checks` records above. */
function projectCheckVerdicts(checks) {
  const out = {};
  for (const name of F_CHECK_NAMES) {
    const record = checks[name];
    out[name] = record && typeof record === 'object' ? record.verdict : record;
  }
  return out;
}

/**
 * computeOverall(input) -- the six-branch precedence function from plan §6.3, evaluated in
 * exact order; first matching branch wins.
 *
 * Input shape (this task's own documented design choice, per the brief -- every later stage
 * must produce data matching this shape):
 * {
 *   fatalErrorObserved: boolean,
 *   cleanupUnresolvedOwnership: boolean,
 *   viewerScriptIntegrity: one of INTEGRITY_RESULT's five values (a missing/null/out-of-enum
 *     value is itself branch 1's fail-closed condition -- never treated as "unconfirmed"),
 *   classifier: one of CLASSIFIER's five values,
 *   checks: { F1: CHECK_VERDICT, F2: CHECK_VERDICT, ..., F8: CHECK_VERDICT },
 *   controls: { 'tree-unavailable': ControlResult, 'wrong-owner': ControlResult, ... } --
 *     keyed by the nine CONTROL_NAMES; a missing entry for a required name is treated
 *     identically to a control whose `state !== DETECTED_RESTORED` (never silently ignored),
 *   cleanupFailures: Array<unknown>,
 * }
 *
 * Branches (plan §6.3, lines 720-796):
 *   1. fatalErrorObserved || cleanupUnresolvedOwnership || viewerScriptIntegrity in
 *      {MISMATCH, FETCH_FAILED} || viewerScriptIntegrity not in the five-value enum → FAIL
 *   2. else classifier != CONFIRMED_SVF2 → BLOCKED
 *   3. else any Fi == FAIL or any mandatory control != DETECTED_RESTORED → FAIL
 *   4. else viewerScriptIntegrity in {CAPTURE_UNAVAILABLE, PROVENANCE_AMBIGUOUS} → BLOCKED
 *   5. else viewerScriptIntegrity == VERIFIED && every Fi == PASS && every control ==
 *      DETECTED_RESTORED && cleanupFailures.length == 0 → PASS
 *   6. else → PARTIAL
 */
function computeOverall(input) {
  const {
    fatalErrorObserved,
    cleanupUnresolvedOwnership,
    viewerScriptIntegrity,
    classifier,
    checks = {},
    controls = {},
    cleanupFailures = [],
  } = input || {};

  // Branch 1 -- harness/runtime fatal conditions, checked before the classifier question so a
  // required-resource failure (or a positively-confirmed byte-identity mismatch) is never
  // mistaken for a merely-unconfirmed classifier state. The fail-closed clause: a missing,
  // null, or out-of-enum viewerScriptIntegrity means the harness's own classification logic is
  // broken, not that identity is merely unconfirmed -- also fatal.
  const integrityIsFailClosed = !VALID_INTEGRITY_VALUES.has(viewerScriptIntegrity);
  const integrityIsHardFail = viewerScriptIntegrity === INTEGRITY_RESULT.MISMATCH
    || viewerScriptIntegrity === INTEGRITY_RESULT.FETCH_FAILED;

  if (fatalErrorObserved === true || cleanupUnresolvedOwnership === true || integrityIsHardFail || integrityIsFailClosed) {
    return OVERALL_VERDICT.FAIL;
  }

  // Branch 2 -- classifier arm only: a clean run that simply never confirmed SVF2.
  if (classifier !== CLASSIFIER.CONFIRMED_SVF2) {
    return OVERALL_VERDICT.BLOCKED;
  }

  // Branch 3 -- any positively-observed Fi/control failure, checked before the
  // identity-unavailable arm so an unresolved identity can never bury a real defect.
  const anyFiFail = F_CHECK_NAMES.some((name) => checks[name] === CHECK_VERDICT.FAIL);
  const anyControlNotRestored = CONTROL_NAMES.some((name) => {
    const control = controls[name];
    return !control || control.state !== CONTROL_STATE.DETECTED_RESTORED;
  });
  if (anyFiFail || anyControlNotRestored) {
    return OVERALL_VERDICT.FAIL;
  }

  // Branch 4 -- identity unavailable/ambiguous; by construction nothing is left to bury here.
  if (viewerScriptIntegrity === INTEGRITY_RESULT.CAPTURE_UNAVAILABLE || viewerScriptIntegrity === INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS) {
    return OVERALL_VERDICT.BLOCKED;
  }

  // Branch 5 -- all-clean PASS.
  const everyFiPass = F_CHECK_NAMES.every((name) => checks[name] === CHECK_VERDICT.PASS);
  const everyControlRestored = CONTROL_NAMES.every((name) => controls[name] && controls[name].state === CONTROL_STATE.DETECTED_RESTORED);
  const cleanupFailuresEmpty = Array.isArray(cleanupFailures) && cleanupFailures.length === 0;
  if (viewerScriptIntegrity === INTEGRITY_RESULT.VERIFIED && everyFiPass && everyControlRestored && cleanupFailuresEmpty) {
    return OVERALL_VERDICT.PASS;
  }

  // Branch 6 -- default: any Fi in {BLOCKED, NOT_EVIDENCED}, or resolved-ownership
  // cleanupFailures -- neither a proven defect nor a clean PASS.
  return OVERALL_VERDICT.PARTIAL;
}

// ============================================================================================
// STAGE 2 -- Async ownership slice: the browser-owned load-record protocol (plan §6.4a),
// Node-side load orchestration (§6.4a/§6.4b), and the 22-step cleanup executor (§4.3).
// Still no live Playwright browser instance anywhere in this stage -- every page-interaction
// dependency below is either (a) an in-page pure function meant to be handed to a REAL
// `page.evaluate`/`page.waitForFunction` call VERBATIM by Stage 3, or (b) a Node-side
// orchestration function that accepts its page-interaction dependency as an INJECTED
// parameter (`pageEvaluate`, `pageWaitForFunction`) so Stage 2's own tests can pass a fake.
// ============================================================================================

// ------------------------------------------------------------------------------------------
// §6.4a -- Load-record / classifier-adjacent enums
// ------------------------------------------------------------------------------------------

/** In-page load record `status` enum (plan §6.4a "The record"). Distinct from Stage 1's
 * TOKEN_STATE: this is the browser-realm record's own richer status vocabulary; the Node-side
 * per-operation Token for a load still only ever uses TOKEN_STATE. */
const LOAD_RECORD_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  TIMED_OUT: 'timed-out',
  SEALED: 'sealed',
  LATE_DISCARDED: 'late-discarded',
  LATE_UNLOADING: 'late-unloading',
  LATE_UNLOADED: 'late-unloaded',
});

/** Which Viewer call a load record belongs to (plan §6.4a "The record": `api`). */
const LOAD_API = Object.freeze({
  DOCUMENT_LOAD: 'Document.load',
  LOAD_DOCUMENT_NODE: 'loadDocumentNode',
});

// Plan-named timing constants (§6.4a): the ONLY two given exact numeric values in the sections
// this stage reads. LOAD_TIMEOUT_MS/CENSUS_TIMEOUT_MS/etc. are per-call values a caller supplies
// (this stage does not fix them), so they are not exported here.
const DRAIN_TIMEOUT_MS = 15_000;
const FINAL_DRAIN_TIMEOUT_MS = 20_000;

// ------------------------------------------------------------------------------------------
// §6.4a -- In-page load-record protocol.
//
// BUNDLING NOTE FOR STAGE 3 (read before wiring these into a real `page.evaluate` call):
// every function in this subsection references ONLY its own arguments and true page globals
// (`window.__g1`, `window.__viewer`, `performance`, `setTimeout`/`clearTimeout`) -- never a
// variable from this outer Node module. That satisfies the hard "reference only its argument
// and page globals" constraint (this repo's own convention, `clashtest-viewer-adapter.
// acceptance.mjs:176`, `INSTALL_T3`'s `t3.errOf`/`t3.patch` pattern). However, several of them
// call SIBLING functions from this same subsection (`onSuccess`/`onError`/`sealLoads` all call
// `pushLoadTransition` and `pageErrOf`; `onSuccess`/`sealLoads`/`readLoadRecordSnapshot` all
// call `isLateModelsAllGone`; `sealLoads` calls `readLoadRecordSnapshot`). Playwright's
// `page.evaluate`/`page.waitForFunction` serialize only the ONE function passed to them (via
// `.toString()`); they do not transitively serialize a function that function calls. Stage 3
// must therefore bundle each real entry point (`START_LOAD`'s own onDeadline/onSuccess/onError
// wiring, `SEAL_LOADS`, `IS_OWNERSHIP_CLEAN`, `READ_LOAD_RECORD`) together with every sibling
// helper it transitively calls when composing the actual `page.evaluate` source -- e.g. by
// attaching them all as methods on `window.__g1` during the page's own bootstrap inline script
// (mirroring `INSTALL_T3` attaching `t3.errOf`/`t3.patch` once, up front), or by inlining their
// source into one composed function per entry point. This stage deliberately keeps them as
// separate top-level functions so each is independently unit-testable right now; Stage 3 owns
// the bundling mechanics, not this stage.
// ------------------------------------------------------------------------------------------

/** In-page. Minimal, JSON-safe error shape for `handlerErrors` entries -- mirrors T3's own
 * `t3.errOf` (`clashtest-viewer-adapter.acceptance.mjs:182-185`). Node re-serializes anything
 * retained from here through the real `describeError` (§4.2) before final retention; this is
 * only the in-page, bounded-effort capture. */
function pageErrOf(e) {
  return e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), code: e.code, reason: e.reason }
    : { primitive: typeof e, value: String(e) };
}

/** In-page. Appends a `{from, to, cause, at}` transition entry and updates `record.status`. */
function pushLoadTransition(record, to, cause) {
  record.transitions.push({ from: record.status, to, cause, at: performance.now() });
  record.status = to;
}

/** In-page. `record.lateModels.every(m => !viewer.getAllModels().includes(m))` -- the
 * `late-unloading -> late-unloaded` gone-check (plan: "T3's own unload-then-poll-gone pattern,
 * `X_GONE`, `clashtest-viewer-adapter.acceptance.mjs:611-612,843-845`"). */
function isLateModelsAllGone(record) {
  const viewer = window.__viewer;
  if (!viewer || record.lateModels.length === 0) return record.lateModels.length === 0;
  const current = viewer.getAllModels();
  return record.lateModels.every((m) => !current.includes(m));
}

/**
 * In-page. `createLoadRecord(tokenId, api, gen, deadline)` -- plan §6.4a "The record" +
 * "Starting a load" step 1. Lazily creates `window.__g1` if the page's own bootstrap inline
 * script has not already done so (defensive; the plan's own design has the page create it
 * before any load), then creates and stores the record. For `api === 'loadDocumentNode'`,
 * captures `preLoadModels` as `new Set(window.__viewer.getAllModels())` at call time (plan:
 * "T3's own reloadBefore pattern, `clashtest-viewer-adapter.acceptance.mjs:816`").
 */
function createLoadRecord(tokenId, api, gen, deadline) {
  const g = (window.__g1 = window.__g1 || { closing: false, nextGen: 1, loads: {}, docs: {}, models: {} });
  const record = {
    tokenId,
    api,
    gen,
    deadline,
    status: 'active',
    outcome: null,
    transitions: [],
    handlerErrors: [],
    timer: null,
    preLoadModels: api === 'loadDocumentNode' && window.__viewer ? new Set(window.__viewer.getAllModels()) : null,
    lateModels: [],
  };
  g.loads[tokenId] = record;
  return record;
}

/**
 * In-page. `onDeadline(tokenId, gen)` -- the timer-driven side of the three-way race (plan
 * §6.4a "One decision, in one realm, by absolute deadline"). Every in-page entry point begins
 * with the record/gen guard; only an `active` record is moved to `timed-out`.
 */
function onDeadline(tokenId, gen) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r || r.gen !== gen) return { ignored: true, reason: 'missing-or-generation-mismatch' };
  if (r.status === 'active') {
    pushLoadTransition(r, 'timed-out', 'deadline');
  }
  return { tokenId, gen, status: r.status };
}

/**
 * In-page. `onSuccess(tokenId, gen, value)` -- plan §6.4a "One decision, in one realm, by
 * absolute deadline" + "Late-arrival disposition". `value` is a `Document` (api ===
 * `'Document.load'`) or a `Model` (api === `'loadDocumentNode'`) in the real Viewer; any plain
 * value works for this stage's own decision-logic tests.
 *
 * Ordering is load-bearing (do not reorder): (1) record/gen guard; (2) the "first" deadline
 * re-check -- `if (status === 'active' && now >= deadline)`, evaluated INSIDE this handler, not
 * only by the timer -- closes the race window where a callback is dispatched after the deadline
 * but before the timer task has run; (3) only if STILL `active` (re-read, never a status cached
 * before step 2) and `closing === false` does this settle as `completed`; (4) otherwise, late-
 * arrival disposition, in this same invocation.
 */
function onSuccess(tokenId, gen, value) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r || r.gen !== gen) return { ignored: true, reason: 'missing-or-generation-mismatch' };

  if (r.status === 'active' && performance.now() >= r.deadline) {
    pushLoadTransition(r, 'timed-out', 'deadline-race-on-success');
  }

  if (r.status === 'active' && g.closing === false) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.outcome = { kind: 'success', error: null };
    pushLoadTransition(r, 'completed', 'success');
    if (r.api === 'Document.load') g.docs[tokenId] = value;
    else g.models[tokenId] = value;
    return { tokenId, gen, status: r.status, outcome: r.outcome };
  }

  return disposeLateArrival(g, r, tokenId, gen, { kind: 'success', value });
}

/**
 * In-page. `onError(tokenId, gen, error)` -- symmetric to `onSuccess`, plan §6.4a. A rejection
 * received before the deadline is still `completed` (plan §6.4b: "a rejection is itself a
 * definite, terminal outcome -- never left pending"); `outcome.kind` distinguishes it. An error
 * is NEVER a `Model`, so its late-arrival disposition is always `late-discarded`, regardless of
 * `api` (see `disposeLateArrival`).
 */
function onError(tokenId, gen, error) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r || r.gen !== gen) return { ignored: true, reason: 'missing-or-generation-mismatch' };

  if (r.status === 'active' && performance.now() >= r.deadline) {
    pushLoadTransition(r, 'timed-out', 'deadline-race-on-error');
  }

  if (r.status === 'active' && g.closing === false) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.outcome = { kind: 'rejected', error: pageErrOf(error) };
    pushLoadTransition(r, 'completed', 'error');
    return { tokenId, gen, status: r.status, outcome: r.outcome };
  }

  return disposeLateArrival(g, r, tokenId, gen, { kind: 'error', error });
}

/**
 * In-page. Late-arrival disposition (plan §6.4a "Late-arrival disposition"), shared by
 * `onSuccess`/`onError`'s "otherwise" branch: a late `Document` success, a late
 * `Document.load` error, or ANY late `loadDocumentNode` rejection (an error never produces a
 * `Model`) is `late-discarded` -- dropped, no reference retained, never passed to
 * `loadDocumentNode`. A late `Model` (a `loadDocumentNode` SUCCESS only) is pushed to
 * `lateModels`, moved to `late-unloading`, unloaded inside its own `try/catch`, and moved to
 * `late-unloaded` once observed gone via `getAllModels()`.
 */
function disposeLateArrival(g, r, tokenId, gen, payload) {
  if (r.api === 'Document.load' || payload.kind === 'error') {
    pushLoadTransition(r, 'late-discarded', payload.kind === 'error' ? 'late-error' : 'late-document-success');
    return { tokenId, gen, status: r.status, outcome: null, lateDiscarded: true };
  }

  const model = payload.value;
  r.lateModels.push(model);
  pushLoadTransition(r, 'late-unloading', 'late-model-success');
  try {
    window.__viewer.unloadModel(model);
  } catch (e) {
    r.handlerErrors.push({ phase: 'late-unload', error: pageErrOf(e) });
  }
  if (isLateModelsAllGone(r)) {
    pushLoadTransition(r, 'late-unloaded', 'late-model-gone');
  }
  return { tokenId, gen, status: r.status, outcome: null, lateModelPending: r.status !== 'late-unloaded' };
}

/**
 * In-page. `sealLoads(claimed)` -- `SEAL_LOADS`, plan §6.4a "Sealing (in-page, Phase 11 step
 * 1a)". `claimed` is the array of tokenIds Node recorded as `completed`. Five things, in order:
 * (1) `window.__g1.closing = true`; (2) every `active`/`timed-out` record -> `sealed`; (3) a
 * record `completed` in-page but absent from `claimed` (Node never received it) is treated as
 * late, via the SAME success/error-shaped disposition `onSuccess`/`onError` use; (4) for every
 * SEALED `loadDocumentNode` record, sweep `viewer.getAllModels()` for models absent from BOTH
 * that record's own `preLoadModels` (identity, not URN) and every claimed/already-late model,
 * unload each (its own `try/catch`, all attempted even if one throws), and move that record to
 * `late-unloading`/`late-unloaded`; (5) return one snapshot per record.
 *
 * Fails closed: a sealed `loadDocumentNode` record whose `preLoadModels` is not a real `Set`
 * (missing/invalid) is SKIPPED by the sweep entirely (recorded as a handler error) rather than
 * treated as an empty set, which would sweep -- and unload -- every currently-present model.
 * `getAllModels()` is snapshotted once before any unload in this pass, since `unloadModel` may
 * mutate the live collection during iteration.
 */
function sealLoads(claimed) {
  const g = window.__g1;
  if (!g) return {};
  g.closing = true;
  const claimedSet = new Set(Array.isArray(claimed) ? claimed : []);
  const claimedModels = new Set();
  for (const tokenId of claimedSet) {
    const r = g.loads[tokenId];
    if (r && r.status === 'completed' && r.api === 'loadDocumentNode') {
      const model = g.models[tokenId];
      if (model) claimedModels.add(model);
    }
  }

  for (const tokenId of Object.keys(g.loads)) {
    const r = g.loads[tokenId];
    if (r.status === 'active' || r.status === 'timed-out') {
      pushLoadTransition(r, 'sealed', 'seal');
    } else if (r.status === 'completed' && !claimedSet.has(tokenId)) {
      if (r.api === 'Document.load') {
        pushLoadTransition(r, 'late-discarded', 'unclaimed-completed-document');
      } else {
        const model = g.models[tokenId];
        if (model) {
          r.lateModels.push(model);
          pushLoadTransition(r, 'late-unloading', 'unclaimed-completed-model');
          try { window.__viewer.unloadModel(model); }
          catch (e) { r.handlerErrors.push({ phase: 'unclaimed-late-unload', error: pageErrOf(e) }); }
          if (isLateModelsAllGone(r)) pushLoadTransition(r, 'late-unloaded', 'unclaimed-model-gone');
        }
      }
    }
  }

  const sealedLoadDocRecords = Object.keys(g.loads)
    .map((tokenId) => g.loads[tokenId])
    .filter((r) => r.status === 'sealed' && r.api === 'loadDocumentNode');

  if (sealedLoadDocRecords.length > 0 && window.__viewer) {
    const snapshot = [...window.__viewer.getAllModels()];
    const alreadyLate = new Set();
    for (const tokenId of Object.keys(g.loads)) for (const m of g.loads[tokenId].lateModels) alreadyLate.add(m);

    for (const r of sealedLoadDocRecords) {
      if (!(r.preLoadModels instanceof Set)) {
        r.handlerErrors.push({ phase: 'seal-sweep', error: { invariant: 'preLoadModels missing or invalid -- sweep skipped, fail closed' } });
        continue;
      }
      const untracked = snapshot.filter((m) => !r.preLoadModels.has(m) && !claimedModels.has(m) && !alreadyLate.has(m));
      for (const model of untracked) {
        r.lateModels.push(model);
        alreadyLate.add(model);
        try { window.__viewer.unloadModel(model); }
        catch (e) { r.handlerErrors.push({ phase: 'seal-sweep-unload', error: pageErrOf(e) }); }
      }
      if (untracked.length > 0) {
        pushLoadTransition(r, 'late-unloading', 'seal-sweep');
        if (isLateModelsAllGone(r)) pushLoadTransition(r, 'late-unloaded', 'seal-sweep-gone');
      }
    }
  }

  const snapshots = {};
  for (const tokenId of Object.keys(g.loads)) snapshots[tokenId] = readLoadRecordSnapshot(tokenId);
  return snapshots;
}

/**
 * In-page (also safe to call Node-side, since it is pure given a record + optional claimed
 * set -- reused by `drainLoadToken` below). `isOwnershipClean(record, { claimedTokenIds })` --
 * plan §6.4a "A record is ownership-clean if and only if its status is one of: `completed` (and
 * claimed by Node), `late-discarded`, or `late-unloaded`; or its status is `sealed` and
 * `api === 'Document.load'`." A missing record is never ownership-clean.
 */
function isOwnershipClean(record, { claimedTokenIds } = {}) {
  if (!record) return false;
  if (record.status === 'completed') {
    if (!claimedTokenIds) return true;
    const claimed = claimedTokenIds instanceof Set ? claimedTokenIds : new Set(claimedTokenIds);
    return claimed.has(record.tokenId);
  }
  if (record.status === 'late-discarded' || record.status === 'late-unloaded') return true;
  if (record.status === 'sealed' && record.api === 'Document.load') return true;
  return false;
}

/**
 * In-page. `readLoadRecordSnapshot(tokenId)` -- `READ_LOAD_RECORD`, plan §6.4a "Drain (Node,
 * value only)": returns `{present, gen, status, transitions, handlerErrors,
 * lateModelsStillPresent}` -- counts and booleans only, never a model.
 */
function readLoadRecordSnapshot(tokenId) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r) return { present: false };
  return {
    present: true,
    gen: r.gen,
    status: r.status,
    transitions: r.transitions,
    handlerErrors: r.handlerErrors,
    lateModelsStillPresent: r.lateModels.length > 0 && !isLateModelsAllGone(r),
  };
}

// ------------------------------------------------------------------------------------------
// §6.4a/§6.4b -- Node-side load orchestration. Every function below accepts its page-
// interaction dependency as an injected parameter (never imports/constructs Playwright
// itself), so this stage's own tests pass a fake and Stage 3 passes `page.evaluate.bind(page)`
// / `page.waitForFunction.bind(page)` unchanged.
// ------------------------------------------------------------------------------------------

/**
 * `startLoad({ pageEvaluate, starter, api, urn, docTokenId, loadTimeoutMs, meta })` -- mints a
 * Stage-1 `Token` for this load operation, calls the in-page starter via the injected
 * `pageEvaluate(fn, arg)` (matching `page.evaluate`'s own two-argument signature, so Stage 3
 * can inject `page.evaluate.bind(page)` unchanged), and reconciles the returned snapshot into
 * the Node-side token per plan §6.4b's outcome table: `status: 'completed'` -> token
 * `completed`; `status: 'timed-out'` -> token `timed-out`; a missing/invalid snapshot, or
 * `pageEvaluate` itself rejecting, is §6.4a Case D (unrecoverable/contaminated) -- the token
 * becomes `timed-out` (never thrown further) and `caseD: true` is returned so the caller can
 * record the specific §6.4b/§6.6 disposition. This stage does not implement the full Case-D
 * Node-side backstop timer (`LOAD_TIMEOUT_MS + LOAD_BACKSTOP_MARGIN_MS` racing a real,
 * possibly-hanging `page.evaluate` call) -- that requires a real, live Playwright call and is
 * Stage 3's job; this function's own contract (never let a rejected/malformed `pageEvaluate`
 * escape as an uncaught rejection, always resolve to a token in a defined state) is what Stage
 * 3 builds the backstop racing on top of.
 *
 * Does NOT itself decide the two-stage `Document.load`/`loadDocumentNode` linkage (plan: "if
 * `Document.load`'s token times out first, `loadDocumentNode`'s token is never minted at all")
 * -- that is the caller's own sequencing, one `startLoad` call per stage.
 */
async function startLoad({ pageEvaluate, starter, api, urn, docTokenId, loadTimeoutMs, meta = {} }) {
  const token = createToken({ operation: 'load', api, urn, docTokenId, ...meta });

  let snapshot = null;
  let caseDReason = null;
  try {
    snapshot = await pageEvaluate(starter, { tokenId: token.id, api, urn, docTokenId, loadTimeoutMs });
  } catch {
    caseDReason = 'page-unresponsive';
  }

  if (!snapshot || typeof snapshot !== 'object') {
    transitionToken(token, TOKEN_STATE.TIMED_OUT);
    return { token, gen: null, snapshot: null, caseD: true, reason: caseDReason || 'load-record-unreadable' };
  }

  if (snapshot.gen == null) {
    transitionToken(token, TOKEN_STATE.TIMED_OUT);
    return { token, gen: null, snapshot: null, caseD: true, reason: 'load-record-generation-mismatch' };
  }

  if (snapshot.status === LOAD_RECORD_STATUS.COMPLETED) {
    transitionToken(token, TOKEN_STATE.COMPLETED);
  } else {
    // 'timed-out' (Case A), or any other status this call could observe this early -- treated
    // identically per §6.4b: the token is timed-out, never left ambiguous.
    transitionToken(token, TOKEN_STATE.TIMED_OUT);
  }

  return { token, gen: snapshot.gen, snapshot, caseD: false };
}

/**
 * In-page. `f11DrainOwnershipCleanPredicate({ tokenId, gen })` -- fix wave (final whole-branch
 * review, Important I3): the `ownershipCleanPredicate` `drainLoadToken` below passes to
 * `pageWaitForFunction`. Playwright's real `page.waitForFunction(pageFunction, arg)`
 * re-stringifies `pageFunction` and evaluates it in-page directly (independent of
 * `buildBootstrapScriptSource`'s `addInitScript` registry), so -- like every other in-page
 * function in this file -- it may reference only its own argument and page globals, never a
 * Node-side sibling such as `isOwnershipClean`. It therefore duplicates `isOwnershipClean`'s
 * exact logic inline, always with an empty claimed set (matching `drainLoadToken`'s own
 * `{claimedTokenIds: []}` call below -- see that function's doc comment for why: every token
 * reaching drain is already Node-side `timed-out`, never `completed`-and-claimed).
 */
function f11DrainOwnershipCleanPredicate({ tokenId, gen }) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r || r.gen !== gen) return false;
  if (r.status === 'late-discarded' || r.status === 'late-unloaded') return true;
  if (r.status === 'sealed' && r.api === 'Document.load') return true;
  return false; // 'completed' (unclaimed here by construction) and every other status: not clean
}

/**
 * `drainLoadToken({ token, pageWaitForFunction, pageEvaluate, ownershipCleanPredicate,
 * readRecordFn, tokenId, gen, drainTimeoutMs })` -- plan §6.4a "Drain (Node, value only --
 * `drainLoadToken`)". Awaits `pageWaitForFunction(ownershipCleanPredicate, {tokenId, gen},
 * {timeout: drainTimeoutMs})` (matching `page.waitForFunction`'s own signature), then makes one
 * `pageEvaluate(readRecordFn, {tokenId})` call. Moves `token` `timed-out -> disposed` ONLY when
 * that snapshot is present, generation-matched, and ownership-clean (via `isOwnershipClean`,
 * shared with the in-page predicate above). An elapsed drain window is NEVER treated as a
 * terminal signal -- on any failure/timeout the token is left exactly as the caller passed it
 * in (still `timed-out`), never force-transitioned.
 *
 * **Never passes an empty/omitted claim context to `isOwnershipClean`** (fix round 1 on this
 * stage's own review): every token `drainLoadToken` is ever asked to drain is, by construction,
 * one whose Node-side state is already `timed-out` -- i.e. never `completed`-and-claimed (a
 * claimed token is disposed of via ordinary drain of a `sealed`/`late-*` status, never observed
 * `completed` here at all). Plan §6.4a "The record": "A record is ownership-clean if and only
 * if its status is one of: `completed` **(and claimed by Node, below)** ...". Explicitly passes
 * `{ claimedTokenIds: [] }` (never `{}`, which would make `isOwnershipClean` treat ANY
 * `completed` status as clean with no claim check at all -- a real gap for exactly plan §6.4a
 * Case D: a transient `pageEvaluate`/`START_LOAD` failure reconciles the Node token to
 * `timed-out` while the in-page record actually settled `completed`, unclaimed. An unclaimed
 * `completed` record must go through sealing's own "treat as late" rule first -- never become
 * clean by direct observation of `completed` alone, since only the late-arrival disposition
 * actually calls `viewer.unloadModel()` for an unclaimed `loadDocumentNode` record's live
 * `Model`).
 */
async function drainLoadToken({ token, pageWaitForFunction, pageEvaluate, ownershipCleanPredicate, readRecordFn, tokenId, gen, drainTimeoutMs = DRAIN_TIMEOUT_MS }) {
  try {
    await pageWaitForFunction(ownershipCleanPredicate, { tokenId, gen }, { timeout: drainTimeoutMs });
  } catch {
    return { token, drained: false, reason: 'drain-timeout' };
  }

  let snapshot;
  try {
    // Fix wave (final whole-branch review, Important I3): `readLoadRecordSnapshot(tokenId)`
    // takes the bare tokenId string directly -- the prior `{ tokenId }` wrapper meant
    // `g.loads[tokenId]` (an object key lookup) always missed, since `g.loads[[object Object]]`
    // is never a real key. Never previously called anywhere in the assembled runHarness, so
    // this went uncaught.
    snapshot = await pageEvaluate(readRecordFn, tokenId);
  } catch {
    return { token, drained: false, reason: 'read-record-failed' };
  }

  const clean = snapshot && snapshot.present && snapshot.gen === gen
    && isOwnershipClean({ status: snapshot.status, tokenId, api: token.meta && token.meta.api }, { claimedTokenIds: [] });

  if (clean) {
    transitionToken(token, TOKEN_STATE.DISPOSED);
    return { token, drained: true, snapshot };
  }
  return { token, drained: false, reason: 'not-ownership-clean', snapshot };
}

/**
 * `sealLoadRecords({ tokens, pageEvaluate, sealFn, claimedTokenIds })` -- plan §4.3 step 1a:
 * Node first moves any load token still `active` to `timed-out` ("cleanup-preempted"), THEN
 * calls `pageEvaluate(sealFn, claimedTokenIds)` (`sealLoads(claimed)`'s own bare-array argument
 * shape -- fix wave, final whole-branch review, Important I3: a prior `{ claimed:
 * claimedTokenIds }` wrapper here silently defeated `sealLoads`'s own `Array.isArray(claimed)`
 * check) and returns the per-record snapshots.
 */
async function sealLoadRecords({ tokens, pageEvaluate, sealFn, claimedTokenIds = [] }) {
  for (const token of tokens) {
    if (token.state === TOKEN_STATE.ACTIVE) {
      transitionToken(token, TOKEN_STATE.TIMED_OUT);
    }
  }
  // Fix wave (final whole-branch review, Important I3): `sealLoads(claimed)` takes the claimed-
  // tokenIds array DIRECTLY (checks `Array.isArray(claimed)` on its own bare argument) -- the
  // prior `{ claimed: claimedTokenIds }` wrapper meant `Array.isArray` always saw a plain object,
  // never the array, so `claimedSet` was always empty regardless of what was actually claimed.
  // Never previously called anywhere in the assembled runHarness, so this went uncaught.
  const snapshots = await pageEvaluate(sealFn, claimedTokenIds);
  return { tokens, snapshots };
}

/**
 * `finalizeLoadTokens({ tokens, pageIsClosed, contextCloseSucceeded, browserCloseSucceeded })`
 * -- plan §4.3 step 20a, Node-only, no page access. Every load token still `timed-out` moves
 * `timed-out -> abandoned` IFF Node confirms the owning realm destroyed (`page.isClosed() ===
 * true`, or context/browser close succeeded); otherwise it is left `timed-out` and returned in
 * `stillTimedOut` for the caller to record in `cleanupFailures`.
 */
function finalizeLoadTokens({ tokens, pageIsClosed, contextCloseSucceeded, browserCloseSucceeded }) {
  const realmDestroyed = pageIsClosed === true || contextCloseSucceeded === true || browserCloseSucceeded === true;
  const stillTimedOut = [];
  for (const token of tokens) {
    if (token.state === TOKEN_STATE.TIMED_OUT) {
      if (realmDestroyed) transitionToken(token, TOKEN_STATE.ABANDONED);
      else stillTimedOut.push(token);
    }
  }
  return { tokens, stillTimedOut, realmDestroyed };
}

// ------------------------------------------------------------------------------------------
// §4.3 -- The 22-step cleanup executor
// ------------------------------------------------------------------------------------------

/** The 22 canonical step names, in the plan's own fixed order (excludes step 20a, which is the
 * separate, Node-only, post-teardown `finalizeLoadTokens` above -- not one of runCleanup's own
 * 22 steps). Exported so a caller/test can assert every name was attempted. */
const CLEANUP_STEP_NAMES = Object.freeze([
  'drainPendingTokens', 'clearOwnedTimers', 'abortOwnedControllers', 'removeF3Listeners',
  'removeF6ProbeListener', 'removeF6ReloadProbeListener', 'disposeF6Wiring',
  'restoreAllControlPatches', 'unloadModelBeforeFromViewer', 'unloadModelAfterFromViewer',
  'unregisterModelBefore', 'unregisterModelAfter', 'evictModelBefore', 'evictModelAfter',
  'disposeEngine', 'disposeWorld', 'verifyViewerModelSetEmpty', 'closePage', 'closeContext',
  'closeBrowser', 'httpServerOwnership', 'evidenceWriterState',
]);

/** Thrown internally by a cleanup step that attempts several independent sub-actions (e.g.
 * clearing N timers) when more than one sub-action fails; carries the sub-failures on `errors`
 * (one of describeError's own structured-walk keys) so they are retained, not summarized away. */
class AggregateCleanupError extends Error {
  constructor(stepName, causes) {
    super(`${stepName}: ${causes.length} sub-action(s) failed`);
    this.name = 'AggregateCleanupError';
    this.errors = causes.map((e) => (e instanceof Error ? { name: e.name, message: e.message } : e));
  }
}

/**
 * `runCleanup(resources, opts)` -- plan §4.3's full 22-step ordered ledger (lines 127-215),
 * generic across stages: this function's OWN step definitions are fixed (mirroring the plan's
 * ledger one-for-one), but the concrete `resources` VALUES differ per stage/run. Runs every
 * step unconditionally in order via the plan's own `step(name, guard, fn)` pattern (T3's
 * already-accepted `H_CLEANUP` convention, `clashtest-viewer-adapter.acceptance.mjs:724-741`):
 * a step's failure is caught, recorded, and NEVER prevents a later step from attempting to run.
 *
 * `resources` shape (this stage's own documented design choice -- a later stage supplies real
 * objects matching this same shape once F6/`world`/`registry` exist):
 * {
 *   tokens: Token[],                     // step 1 -- this stage checks terminal state only;
 *                                         //   real cross-realm draining (sealLoadRecords/
 *                                         //   drainLoadToken/finalizeLoadTokens, above) is
 *                                         //   assumed to have already run before runCleanup
 *   timers: { cleared: boolean, clear(): void }[],                 // step 2
 *   abortControllers: { signal: { aborted: boolean }, abort(): void }[], // step 3
 *   f3Listener: { remove(): void, isRemoved?(): boolean } | null,  // step 4
 *   f6: {
 *     ran: boolean,
 *     probeListener: { remove(): void, isRemoved?(): boolean } | null,       // step 5
 *     reloadProbeListener: { remove(): void, isRemoved?(): boolean } | null, // step 6
 *     wiring: { dispose(): void, isDisposed?(): boolean } | null,           // step 7
 *   },
 *   controlPatches: { restored: boolean, restore(): void }[],      // step 8
 *   viewer: { getAllModels(): unknown[], unloadModel(m): void } | null,
 *   modelBefore: unknown | null,          // steps 9, 11, 13, 17
 *   modelAfter: unknown | null,           // steps 10, 12, 14, 17 (only if f6.ran)
 *   registry: { unregister(model): void, bindingFor(key): unknown } | null, // steps 11, 12
 *   registryKey: unknown,                 // the K bindingFor() is checked against
 *   world: { isModelLive(m): boolean, evictModel(m): void, dispose(): void } | null, // 13,14,16
 *   page: { close(): Promise<void>, confirmStillAlive?(): boolean } | null,    // step 18
 *   context: { close(): Promise<void>, confirmStillAlive?(): boolean } | null, // step 19
 *   browser: { close(): Promise<void>, confirmStillAlive?(): boolean } | null, // step 20
 *   httpServer: { verify(): Promise<void> | void } | null, // step 21, verify-only
 * }
 * `confirmStillAlive` is this stage's own uniform abstraction over Playwright's differently-
 * named liveness checks (`Page.isClosed()`, `Browser.isConnected()`, no direct
 * `BrowserContext` equivalent) -- Stage 3 supplies the real adapter per object
 * (e.g. `() => !page.isClosed()`); its ABSENCE means "cannot confirm", which per the plan's own
 * rule ("cleanupUnresolvedOwnership IF the process handle is confirmed still alive") never by
 * itself sets `cleanupUnresolvedOwnership` -- only a POSITIVE confirmation does.
 *
 * `opts.injectFailureAt`: a step name to force-fail AFTER its real guarded action already ran
 * (T3's own injection discipline -- "no leak"), test-only.
 *
 * Returns `{ cleanupFailures, cleanupUnresolvedOwnership, stepStatus }`. `cleanupFailures` is
 * always an array (possibly empty); `stepStatus` maps every one of the 22 `CLEANUP_STEP_NAMES`
 * to `'skipped' | 'ran' | 'threw'`, so a caller/test can confirm no step was ever skipped over
 * due to an earlier failure (only its own guard can skip it).
 */
async function runCleanup(resources = {}, opts = {}) {
  const cleanupFailures = [];
  const stepStatus = {};
  let cleanupUnresolvedOwnership = false;

  const step = async (name, guard, fn, { checkOwnership } = {}) => {
    let shouldRun;
    try {
      shouldRun = Boolean(guard(resources));
    } catch (e) {
      stepStatus[name] = 'threw';
      cleanupFailures.push({ step: name, error: describeError(e) });
      if (checkOwnership && checkOwnership(resources)) cleanupUnresolvedOwnership = true;
      return;
    }
    if (!shouldRun) { stepStatus[name] = 'skipped'; return; }
    try {
      await fn(resources);
      if (opts.injectFailureAt === name) {
        throw new Error(`runCleanup test injection: forced failure at step '${name}' (after its real action already ran)`);
      }
      stepStatus[name] = 'ran';
    } catch (e) {
      stepStatus[name] = 'threw';
      cleanupFailures.push({ step: name, error: describeError(e) });
      if (checkOwnership && checkOwnership(resources)) cleanupUnresolvedOwnership = true;
    }
  };

  // 1. drainPendingTokens -- simplified for this stage (see resources doc above): confirms
  // every token is already terminal; never itself sets cleanupUnresolvedOwnership (that
  // escalation is the separate, F6-conditional tokenEscalatesToUnresolvedOwnership predicate
  // below, which a later stage applies per-token once real F6 ownership facts exist).
  await step('drainPendingTokens',
    (r) => Array.isArray(r.tokens) && r.tokens.length > 0,
    (r) => {
      const stuck = r.tokens.filter((t) => t.state !== TOKEN_STATE.COMPLETED && t.state !== TOKEN_STATE.DISPOSED);
      if (stuck.length > 0) {
        throw new Error(`drainPendingTokens: ${stuck.length} token(s) not terminal: ${stuck.map((t) => t.id).join(', ')}`);
      }
    });

  await step('clearOwnedTimers',
    (r) => Array.isArray(r.timers) && r.timers.some((t) => !t.cleared),
    (r) => {
      const failures = [];
      for (const t of r.timers) {
        if (t.cleared) continue;
        try { t.clear(); t.cleared = true; } catch (e) { failures.push(e); }
      }
      if (failures.length > 0) throw new AggregateCleanupError('clearOwnedTimers', failures);
    });

  await step('abortOwnedControllers',
    (r) => Array.isArray(r.abortControllers) && r.abortControllers.some((c) => !c.signal.aborted),
    (r) => {
      const failures = [];
      for (const c of r.abortControllers) {
        if (c.signal.aborted) continue;
        try { c.abort(); } catch (e) { failures.push(e); }
      }
      if (failures.length > 0) throw new AggregateCleanupError('abortOwnedControllers', failures);
    });

  await step('removeF3Listeners',
    (r) => Boolean(r.f3Listener),
    (r) => r.f3Listener.remove(),
    { checkOwnership: (r) => Boolean(r.f3Listener && typeof r.f3Listener.isRemoved === 'function' && !r.f3Listener.isRemoved()) });

  await step('removeF6ProbeListener',
    (r) => Boolean(r.f6 && r.f6.ran && r.f6.probeListener),
    (r) => r.f6.probeListener.remove(),
    { checkOwnership: (r) => Boolean(r.f6.probeListener && typeof r.f6.probeListener.isRemoved === 'function' && !r.f6.probeListener.isRemoved()) });

  await step('removeF6ReloadProbeListener',
    (r) => Boolean(r.f6 && r.f6.ran && r.f6.reloadProbeListener),
    (r) => r.f6.reloadProbeListener.remove(),
    { checkOwnership: (r) => Boolean(r.f6.reloadProbeListener && typeof r.f6.reloadProbeListener.isRemoved === 'function' && !r.f6.reloadProbeListener.isRemoved()) });

  await step('disposeF6Wiring',
    (r) => Boolean(r.f6 && r.f6.ran && r.f6.wiring),
    (r) => r.f6.wiring.dispose(),
    { checkOwnership: (r) => Boolean(r.f6.wiring && typeof r.f6.wiring.isDisposed === 'function' && !r.f6.wiring.isDisposed()) });

  // A control already recorded RESTORE_FAILED (§6.3a) keeps that verdict regardless of this
  // fallback's own outcome (plan: "primary verification failure is never masked") -- this step
  // never itself sets cleanupUnresolvedOwnership.
  await step('restoreAllControlPatches',
    (r) => Array.isArray(r.controlPatches) && r.controlPatches.some((p) => !p.restored),
    (r) => {
      const failures = [];
      for (const p of r.controlPatches) {
        if (p.restored) continue;
        try { p.restore(); p.restored = true; } catch (e) { failures.push(e); }
      }
      if (failures.length > 0) throw new AggregateCleanupError('restoreAllControlPatches', failures);
    });

  await step('unloadModelBeforeFromViewer',
    (r) => Boolean(r.viewer && r.modelBefore && r.viewer.getAllModels().includes(r.modelBefore)),
    (r) => r.viewer.unloadModel(r.modelBefore));

  await step('unloadModelAfterFromViewer',
    (r) => Boolean(r.f6 && r.f6.ran && r.viewer && r.modelAfter && r.viewer.getAllModels().includes(r.modelAfter)),
    (r) => r.viewer.unloadModel(r.modelAfter));

  await step('unregisterModelBefore',
    (r) => Boolean(r.registry && r.modelBefore),
    (r) => r.registry.unregister(r.modelBefore),
    { checkOwnership: (r) => Boolean(r.registry && r.registry.bindingFor(r.registryKey) != null) });

  await step('unregisterModelAfter',
    (r) => Boolean(r.f6 && r.f6.ran && r.registry && r.modelAfter),
    (r) => r.registry.unregister(r.modelAfter),
    { checkOwnership: (r) => Boolean(r.registry && r.registry.bindingFor(r.registryKey) != null) });

  await step('evictModelBefore',
    (r) => Boolean(r.world && r.modelBefore && r.world.isModelLive(r.modelBefore)),
    (r) => r.world.evictModel(r.modelBefore),
    { checkOwnership: (r) => Boolean(r.world && r.world.isModelLive(r.modelBefore)) });

  await step('evictModelAfter',
    (r) => Boolean(r.f6 && r.f6.ran && r.world && r.modelAfter && r.world.isModelLive(r.modelAfter)),
    (r) => r.world.evictModel(r.modelAfter),
    { checkOwnership: (r) => Boolean(r.world && r.world.isModelLive(r.modelAfter)) });

  // No engine is ever constructed (§6.1a) -- kept only for shape-parity with T3's own ledger.
  await step('disposeEngine', () => false, () => {});

  // Recorded in cleanupFailures only; the WORLD LIVENESS ownership question is already fully
  // covered by steps 13/14's own postcondition re-checks above.
  await step('disposeWorld',
    (r) => Boolean(r.world),
    (r) => r.world.dispose());

  // The ONE cleanup postcondition that can set cleanupUnresolvedOwnership for model state
  // (plan, resource table): unconditional once reached, since reaching the catch means the
  // postcondition itself already failed (a model is still Viewer-live after its own unload
  // step was attempted).
  await step('verifyViewerModelSetEmpty',
    () => true,
    (r) => {
      const models = r.viewer ? r.viewer.getAllModels() : [];
      const stillHasBefore = r.modelBefore != null && models.includes(r.modelBefore);
      const stillHasAfter = Boolean(r.f6 && r.f6.ran) && r.modelAfter != null && models.includes(r.modelAfter);
      if (stillHasBefore || stillHasAfter) {
        throw new Error(`verifyViewerModelSetEmpty: viewer.getAllModels() still contains ${[stillHasBefore && 'modelBefore', stillHasAfter && 'modelAfter'].filter(Boolean).join(' and ')}`);
      }
    },
    { checkOwnership: () => true });

  await step('closePage',
    (r) => Boolean(r.page),
    (r) => r.page.close(),
    { checkOwnership: (r) => Boolean(r.page && typeof r.page.confirmStillAlive === 'function' && r.page.confirmStillAlive() === true) });

  await step('closeContext',
    (r) => Boolean(r.context),
    (r) => r.context.close(),
    { checkOwnership: (r) => Boolean(r.context && typeof r.context.confirmStillAlive === 'function' && r.context.confirmStillAlive() === true) });

  await step('closeBrowser',
    (r) => Boolean(r.browser),
    (r) => r.browser.close(),
    { checkOwnership: (r) => Boolean(r.browser && typeof r.browser.confirmStillAlive === 'function' && r.browser.confirmStillAlive() === true) });

  // Verify-only; the harness never owned this resource, so a failed verification is recorded
  // but deliberately carries NO checkOwnership -- it can never set cleanupUnresolvedOwnership.
  await step('httpServerOwnership',
    () => true,
    async (r) => { if (r.httpServer && typeof r.httpServer.verify === 'function') await r.httpServer.verify(); });

  // n/a -- the atomic write-temp-then-rename (§8) leaves no writer resource to clean up.
  await step('evidenceWriterState', () => true, () => {});

  return { cleanupFailures, cleanupUnresolvedOwnership, stepStatus };
}

/**
 * `tokenEscalatesToUnresolvedOwnership({ tokenState, ownsF6MutableResource })` -- the per-
 * operation-token cleanup-failure escalation rule from plan §4.3's resource-ownership table
 * ("per-operation tokens/generations" row): a token not `completed`/`disposed` after cleanup is
 * ALWAYS recorded in `cleanupFailures` (by `runCleanup`'s own `drainPendingTokens` step,
 * above), but only escalates to `cleanupUnresolvedOwnership` for a token whose lingering
 * execution could still mutate `registry`/`world`/the Viewer's live model set during a phase
 * whose evidence reads them -- i.e. only F6's own unload/reload-wait tokens, never an initial-
 * load token, and never a census loop. `ownsF6MutableResource` is a caller-supplied fact (true
 * only for an F6 unload/reload-wait token); this stage has no F6 machinery yet, so it is tested
 * here as a standalone predicate. A later stage (which introduces F6) wires this into
 * `runCleanup`'s own per-token accounting for real.
 */
function tokenEscalatesToUnresolvedOwnership({ tokenState, ownsF6MutableResource }) {
  const isTerminal = tokenState === TOKEN_STATE.COMPLETED || tokenState === TOKEN_STATE.DISPOSED;
  return !isTerminal && ownsF6MutableResource === true;
}

// ============================================================================================
// STAGE 3 -- Runtime-shell slice: page routing, the served-module manifest, Viewer response-
// body identity capture, the error ledger, F3's listener install/finalize, the
// tree-unavailable control, and Phase 0-3 orchestration (plan §5, §6.1/§6.1a, §6.3,
// §6.3a/§6.5's tree-unavailable row, §6.6, §7.3, §4.4, §8).
//
// AUTHORIZATION BOUNDARY (binding for this stage, second-opinion-confirmed): no real Chromium
// is launched anywhere in this stage's own code or tests, for any reason. Every function below
// that would eventually receive a real Playwright route/request/response/page object accepts
// that object (or the specific methods it calls) as an injected parameter, exactly like Stage
// 2's pageEvaluate/pageWaitForFunction pattern -- so a plain fake stands in for it here, and a
// LATER, separately-authorized stage wires the real Playwright objects through unchanged.
// ============================================================================================

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLASHTEST_DIR = path.join(REPO_ROOT, 'clashtest');

// The plan's own named value, plan §6.4 line 508's timeout table ("Each single-shot read-only
// Fi (F1/F2/F5) | CHECK_TIMEOUT_MS = 30_000 per check") -- corrected citation (fix round 1,
// Stage 3 review: this comment previously implied no plan section specifies it; §6.4 does).
// Overridable per call.
const CHECK_TIMEOUT_MS = 30_000;

// Stage 5's own named value: plan §7.4's own text ("F4's full geometry-buffer census runs
// under CENSUS_TIMEOUT_MS (120s), not the generic 30s CHECK_TIMEOUT_MS") and the plan's §6.4
// timeout table row ("F4/F7/F8 full-census work... CENSUS_TIMEOUT_MS = 120_000 per check").
// Named/exported for a later, live-run-wiring stage's own chunked deadline-check-and-yield
// discipline (§6.4a) -- this stage's own observeF4 does not itself implement that chunking
// loop (a documented, deliberate simplification; see observeF4's own doc comment).
const CENSUS_TIMEOUT_MS = 120_000;

// ------------------------------------------------------------------------------------------
// §5 harness architecture -- /clashtest/** route resolution (matches T3's own accepted
// pattern exactly, clashtest-viewer-adapter.acceptance.mjs:925-938: resolve the request path
// against CLASHTEST_DIR, confirm the resolved absolute path stays inside that directory AND
// ends in .js, 404 otherwise). server.js already serves /collision statically and does NOT
// serve /clashtest (confirmed by reading server.js directly), so this route only ever needs to
// handle /clashtest/**; /collision/** reaches the real running server unmodified, same as T3.
// ------------------------------------------------------------------------------------------

/**
 * `resolveClashtestModulePath(requestPath, clashtestDir = CLASHTEST_DIR)` -- pure, no
 * Playwright/filesystem I/O (never reads the file itself; a thin adapter does that, below).
 * `requestPath` is a URL pathname (e.g. `/clashtest/viewer/index.js`), exactly what
 * `new URL(route.request().url()).pathname` would give T3's own handler. Returns
 * `{ ok: true, absolutePath }` or `{ ok: false, status: 404, reason }`. `clashtestDir` is
 * injectable so tests never depend on this repo's own real `clashtest/` contents.
 */
function resolveClashtestModulePath(requestPath, clashtestDir = CLASHTEST_DIR) {
  const rel = decodeURIComponent(requestPath).replace(/^\/clashtest\//, '');
  const abs = path.resolve(clashtestDir, rel);
  if (!abs.startsWith(clashtestDir + path.sep) || !abs.endsWith('.js')) {
    return { ok: false, status: 404, reason: 'path-traversal-or-invalid-extension' };
  }
  return { ok: true, absolutePath: abs };
}

/**
 * `handleClashtestRoute(route, { clashtestDir, statFn, baseUrl } = {})` -- the thin Playwright
 * adapter around `resolveClashtestModulePath`. Per the authorization boundary above, this is
 * fine to leave UNTESTED against a real `route` object in this stage; it accepts `route` as a
 * parameter (never constructs one) so a later, separately-authorized stage's real
 * `page.route('**\/clashtest/**', handleClashtestRoute)` call needs no changes here.
 * `statFn` mirrors T3's own existence check (`fs.promises.stat`), injectable for the same
 * reason as `readFileFn` elsewhere in this file.
 *
 * `baseUrl` -- fix wave (final whole-branch review, Minor M1), the origin check this doc
 * comment previously deferred: T3's own handler additionally checks the request's origin
 * against the harness's own `BASE_URL` before resolving the path
 * (`clashtest-viewer-adapter.acceptance.mjs:933`, `if (url.origin !== new URL(BASE_URL).origin)
 * return route.continue();`), so a cross-origin request matching the `**\/clashtest/**` glob is
 * passed through rather than served by this handler, matching T3's own guard exactly. Omitting
 * `baseUrl` skips the check (this stage's own existing offline tests never pass one, and never
 * need to -- they construct `route` fakes directly, never a real cross-origin request).
 */
async function handleClashtestRoute(route, { clashtestDir = CLASHTEST_DIR, statFn, baseUrl } = {}) {
  const url = new URL(route.request().url());
  if (baseUrl && url.origin !== new URL(baseUrl).origin) {
    return route.continue();
  }
  const resolved = resolveClashtestModulePath(url.pathname, clashtestDir);
  if (!resolved.ok) {
    return route.fulfill({ status: resolved.status, body: 'not served by g1-svf2-f1-f8-verification' });
  }
  try {
    await (statFn || defaultStat)(resolved.absolutePath);
  } catch {
    return route.fulfill({ status: 404, body: 'not found' });
  }
  return route.fulfill({ path: resolved.absolutePath, contentType: 'text/javascript' });
}

async function defaultStat(absPath) {
  const { stat } = await import('node:fs/promises');
  return stat(absPath);
}

// ------------------------------------------------------------------------------------------
// §8 servedModuleManifest -- a deterministic, generated manifest built by walking the
// harness's own actual import graph at run time (never a fixed, hand-maintained list).
// ------------------------------------------------------------------------------------------

// The plan's §5 "reused, not duplicated" module list -- the entry points this manifest starts
// walking from. Repo-relative paths, leading slash, matching the plan's own listing exactly.
const SERVED_MODULE_ENTRY_POINTS = Object.freeze([
  '/clashtest/viewer/index.js',
  '/clashtest/index.js',
  '/collision/viewer/ViewerModelAdapter.js',
  '/collision/viewer/ViewerGeometryAdapter.js',
  '/clashtest/planning/scopeDigest.js',
  '/collision/index.js',
  '/collision/constants.js',
  // Stage 8 fix: F7's own observeF7 (line ~3577) reads `mod['/clashpanel/viewer/viewerApi.js']`
  // (createViewerApi) via window.__g1.mod -- omitted from Stage 6's own entry-point list, which
  // meant a real run would never have served this module nor hashed it into
  // harnessIntegrity.servedModuleManifest, silently defeating the manifest's own H5 byte-
  // comparison purpose for exactly the module F7 depends on. Caught during Stage 8 assembly.
  '/clashpanel/viewer/viewerApi.js',
]);

// Matches `... from '<specifier>'` -- covers `import X from '...'`, `import {a,b} from '...'`,
// `import * as ns from '...'`, `export {a} from '...'`, `export * from '...'`.
const IMPORT_EXPORT_FROM_SPECIFIER_RE = /\bfrom\s*['"]([^'"]+)['"]/g;
// Matches a bare side-effect import: `import '<specifier>';` (no `from`).
const BARE_IMPORT_SPECIFIER_RE = /(?:^|[^.\w])import\s*['"]([^'"]+)['"]/g;

/**
 * `buildServedModuleManifest(entrySpecifiers, { rootDir, readFileFn })` -- plan §8's
 * `servedModuleManifest`: walks the *static* `import`/`export ... from` specifiers of each
 * module transitively, starting from `entrySpecifiers` (repo-relative paths, leading slash),
 * and returns `{ [repoRelativePath]: sha256Hex }` for every module discovered.
 *
 * Approach, honestly documented (never a full JS parser): two regexes scan each module's raw
 * source text for `from '<spec>'` (covers every named/default/namespace/re-export form) and
 * bare `import '<spec>';` (side-effect only, no `from`). Only RELATIVE specifiers (starting
 * `./` or `../`) are followed -- a bare package specifier (e.g. `'three'`) is skipped, since
 * it resolves into `node_modules`, not a repository-relative file this manifest can/should
 * hash. This does NOT understand dynamic `import()` calls (a later stage's concern, listed
 * separately in plan §6.6's own required-resource-failure list, not this manifest), does NOT
 * understand conditional/computed specifiers, and can be fooled by a specifier-shaped string
 * inside a comment or an unrelated string literal (accepted false-positive risk for a
 * test-only evidence manifest over known, well-formed repository ES modules under our own
 * control -- not a production security boundary).
 *
 * `readFileFn` defaults to `node:fs/promises`'s `readFile`, overridable in tests so this
 * stage's own tests never depend on production file contents (brief's own instruction) --
 * exercised only against small fixture files under a scratch/temp directory. `rootDir`
 * defaults to `REPO_ROOT` and MUST be supplied in tests (never the real repo root) for the
 * same reason.
 *
 * A specifier discovered but unreadable (the file does not exist, or `readFileFn` rejects) is
 * treated as a genuine defect in the manifest's own completeness guarantee -- this function
 * THROWS rather than silently omitting it, since a manifest that's supposed to make "every
 * repository module actually served" byte-comparable can never afford a silent gap.
 */
async function buildServedModuleManifest(entrySpecifiers, { rootDir = REPO_ROOT, readFileFn = nodeReadFile } = {}) {
  const manifest = {};
  const visited = new Set();
  const queue = [...entrySpecifiers];

  const toRepoRelative = (absPath) => `/${path.relative(rootDir, absPath).split(path.sep).join('/')}`;

  while (queue.length > 0) {
    const specifier = queue.shift();
    const absPath = path.resolve(rootDir, specifier.replace(/^\//, ''));
    const repoRelative = toRepoRelative(absPath);
    if (visited.has(repoRelative)) continue;
    visited.add(repoRelative);

    let contents;
    try {
      contents = await readFileFn(absPath, 'utf8');
    } catch (e) {
      throw new Error(`buildServedModuleManifest: cannot read discovered module '${repoRelative}' (from specifier '${specifier}'): ${e && e.message}`);
    }
    manifest[repoRelative] = createHash('sha256').update(contents, 'utf8').digest('hex');

    const discovered = new Set();
    for (const match of contents.matchAll(IMPORT_EXPORT_FROM_SPECIFIER_RE)) discovered.add(match[1]);
    for (const match of contents.matchAll(BARE_IMPORT_SPECIFIER_RE)) discovered.add(match[1]);

    for (const spec of discovered) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue; // skip bare package specifiers
      const resolvedAbs = path.resolve(path.dirname(absPath), spec);
      const resolvedRepoRelative = toRepoRelative(resolvedAbs);
      if (!visited.has(resolvedRepoRelative)) queue.push(resolvedRepoRelative);
    }
  }

  return manifest;
}

// ------------------------------------------------------------------------------------------
// §6.3 Viewer response-body identity classification
// ------------------------------------------------------------------------------------------

// Source: plan line 1169 / docs/research/2026-09-26-viewer-clash-panel-viewer-api-evidence.md
// (the decoded-bundle digest for the pinned Viewer 7.124.2 viewer3D.js, 10,948,159 decoded
// bytes).
const EXPECTED_VIEWER_SHA256 = '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e';

// Fix wave (final whole-branch review, Critical C1): main()'s own Phase 0 constants -- pinned
// Viewer version/URLs matching EXPECTED_VIEWER_SHA256 above and test/acceptance/
// g1-svf2-initializer-diagnostic.mjs's own already-reviewed values exactly (confirmed by direct
// read of that file), PORT/BASE_URL matching that same script's own convention. codex-advisor
// (medium, this fix wave): hardcoding the reviewed fixture URN here (rather than importing it
// from the diagnostic script) is correct -- that script statically imports 'playwright' at
// module scope, which this harness must never do before its own activation interlock runs.
const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;
const VIEWER_VERSION = '7.124.2';
const VIEWER_SCRIPT_URL = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}/viewer3D.js`;
const VIEWER_STYLE_URL = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}/style.css`;
// Same fixture as g1-svf2-initializer-diagnostic.mjs:49 (Room Locator model, single SVF2 3D
// derivative, already-reviewed) -- copied, not imported, per the codex-advisor note above.
const MODEL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ';

// Fix wave (C1): the bare synthetic page main() serves at Phase 0 -- mirrors
// g1-svf2-initializer-diagnostic.mjs's own DIAGNOSTIC_HTML exactly (viewer3D.js script tag,
// getAccessToken fetching the existing, unmodified GET /api/auth/token endpoint, Initializer
// with the corrected env:'AutodeskProduction2'/api:'streamingV2' options, GuiViewer3D
// construction + viewer.start(), window.__viewer = viewer) -- WITHOUT that script's own
// window.__loadModel helper, since this harness's own documentLoadStarter/loadDocumentNodeStarter
// (already built, installed via buildBootstrapScriptSource()'s addInitScript) do that job
// instead, dispatched through the real pageEvaluate wrapper, never a bespoke in-HTML helper.
// `window.__g1Bootstrap.ready` is this page's own readiness flag, analogous to the diagnostic
// script's `window.__diag.ready`.
// Bounded completion pass, Part A: the import map required by SERVED_MODULE_ENTRY_POINTS's own
// transitive module graph (several modules -- e.g. collision/CollisionWorld.js, reached via the
// '/collision/index.js' entry point -- import the bare specifiers 'three'/'three-mesh-bvh',
// which a browser cannot resolve without one). Copied VERBATIM from the already-accepted
// production page, wwwroot/index.html:47-53 (read-only source; that file is never modified) --
// exactly these three entries, no more, no fewer. Placed in <head>, before the Viewer <script>
// tag's textual position (the tag itself is in <body>, but an import map anywhere earlier in
// document order than the first module-resolving <script> still satisfies the spec's "must
// appear before any module script" requirement, and <head> is the safe, conventional place).
const BARE_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="${VIEWER_STYLE_URL}">
<style>html,body,#preview{margin:0;height:100%;width:100%}</style>
<script type="importmap">
{ "imports": {
  "three": "/vendor/three/build/three.module.js",
  "three-mesh-bvh": "/vendor/three-mesh-bvh/src/index.js",
  "three/addons/utils/BufferGeometryUtils.js": "/vendor/three/examples/jsm/utils/BufferGeometryUtils.js"
} }
</script>
</head><body>
<div id="preview"></div>
<script src="${VIEWER_SCRIPT_URL}"></script>
<script>
async function getAccessToken(callback) {
  const resp = await fetch('/api/auth/token');
  if (!resp.ok) throw new Error(await resp.text());
  const { access_token, expires_in } = await resp.json();
  callback(access_token, expires_in);
}
window.__g1Bootstrap = { ready: false, error: null };
try {
  Autodesk.Viewing.Initializer(
    { env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken },
    function () {
      const viewer = new Autodesk.Viewing.GuiViewer3D(document.getElementById('preview'), {});
      viewer.start();
      window.__viewer = viewer;
      window.__g1Bootstrap.ready = true;
    },
  );
} catch (e) {
  window.__g1Bootstrap.error = String(e && e.message || e);
}
</script>
</body></html>`;

/**
 * `walkRedirectRootUrl(request)` -- fix wave (C1), Node-side, real-Playwright-`Request`-shaped
 * (never itself imports playwright). Walks a real Playwright `Request`'s own
 * `redirectedFrom()` chain back to its origin and returns that origin's `url()`. Used by
 * `main()`'s own Viewer-script response/requestfailed attribution (below) to identify which
 * hop of a possible redirect chain a given response/failure belongs to, per codex-advisor's
 * own finding (this fix wave): filtering by exact URL equality alone misses a redirected final
 * response (Playwright mints a NEW `Request` per redirect hop, each with its own `url()`).
 */
function walkRedirectRootUrl(request) {
  let r = request;
  while (r.redirectedFrom()) r = r.redirectedFrom();
  return r.url();
}

/**
 * `classifyViewerScriptIntegrity(captureRecord)` -- plan §6.3's 5-row `integrityResult` table
 * (lines 702-712), classified exactly once, first matching row wins in the table's own order:
 * `FETCH_FAILED`, `MISMATCH`, `PROVENANCE_AMBIGUOUS`, `CAPTURE_UNAVAILABLE`, `VERIFIED`.
 *
 * `captureRecord` shape (this stage's own documented design; a later, separately-authorized
 * stage's real `page.on('response')` listener builds this from Playwright's own
 * Request/Response objects -- attributing a final response by `resourceType() === 'script'`
 * plus a `request().redirectedFrom()` chain, per plan §8's "Capture:" paragraph):
 * {
 *   requestFailed: boolean,           // a `requestfailed` event fired for the Viewer script request
 *   autodeskViewingDefined: boolean,  // whether `Autodesk.Viewing` became defined in-page at all
 *   attributableResponses: [{
 *     status: number,
 *     redirectChainComplete: boolean, // this response's own chain fully reconstructed to requestedUrl
 *     fromServiceWorker: boolean,
 *     bodyOutcome: 'captured' | 'capture-failed' | 'empty' | 'pending-at-close',
 *     decodedByteLength: number | null,
 *     sha256: string | null,          // SHA-256 of the decoded body, only when bodyOutcome === 'captured'
 *   }],
 * }
 *
 * Returns `{ integrityResult, reason }` -- `reason` is a short diagnostic string, never used
 * for gating (only `integrityResult`, fed into Stage 1's `computeOverall`, gates anything).
 */
function classifyViewerScriptIntegrity(captureRecord) {
  const record = captureRecord || {};
  const responses = Array.isArray(record.attributableResponses) ? record.attributableResponses : [];

  // FETCH_FAILED: a requestfailed event; or a final status >= 400; or no response ever
  // observed AND Autodesk.Viewing never became defined.
  if (record.requestFailed === true
      || responses.some((r) => r.status >= 400)
      || (responses.length === 0 && record.autodeskViewingDefined !== true)) {
    return { integrityResult: INTEGRITY_RESULT.FETCH_FAILED, reason: 'fetch-failed' };
  }

  // MISMATCH: at least one attributable final response's body captured non-empty and its
  // SHA-256 != expected.
  const mismatched = responses.find((r) => r.bodyOutcome === 'captured' && r.decodedByteLength > 0 && r.sha256 !== EXPECTED_VIEWER_SHA256);
  if (mismatched) {
    return { integrityResult: INTEGRITY_RESULT.MISMATCH, reason: 'decoded-body-sha256-mismatch' };
  }

  // PROVENANCE_AMBIGUOUS: the script executed but no attributable response was observed; or a
  // redirect chain could not be fully reconstructed; or more than one attributable response
  // exists and not every one was captured and matched.
  const noAttributableButExecuted = responses.length === 0 && record.autodeskViewingDefined === true;
  const chainIncomplete = responses.some((r) => r.redirectChainComplete !== true);
  const multipleNotAllMatched = responses.length > 1
    && !responses.every((r) => r.bodyOutcome === 'captured' && r.sha256 === EXPECTED_VIEWER_SHA256);
  if (noAttributableButExecuted || chainIncomplete || multipleNotAllMatched) {
    return {
      integrityResult: INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS,
      reason: noAttributableButExecuted ? 'no-attributable-response' : chainIncomplete ? 'redirect-chain-incomplete' : 'multiple-responses-not-all-matched',
    };
  }

  // CAPTURE_UNAVAILABLE: attributable response(s) exist, but the body was not captured
  // (rejected/empty/still-pending-at-close), or the final status is non-200 below 400 (e.g.
  // 304/206) -- status >= 400 was already claimed by FETCH_FAILED above, so any remaining
  // non-200 here is necessarily below 400.
  const captureIssue = responses.some((r) => r.bodyOutcome !== 'captured' || r.status !== 200);
  if (captureIssue) {
    return { integrityResult: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE, reason: 'body-not-captured-or-non-200' };
  }

  // VERIFIED: every attributable final response is status 200, a fully reconstructed redirect
  // chain, a captured non-empty decoded body, and SHA-256 === expected.
  const allVerified = responses.length > 0 && responses.every((r) => r.status === 200
    && r.redirectChainComplete === true && r.bodyOutcome === 'captured'
    && r.decodedByteLength > 0 && r.sha256 === EXPECTED_VIEWER_SHA256);
  if (allVerified) {
    return { integrityResult: INTEGRITY_RESULT.VERIFIED, reason: null };
  }

  // Defensive fallback -- the five rows above are exhaustive over this captureRecord shape, so
  // this should be unreachable; fail closed to the weaker BLOCKED-class value rather than ever
  // return something out of INTEGRITY_RESULT's enum (computeOverall's own fail-closed clause,
  // Stage 1, already treats a missing/out-of-enum value as fatal -- this avoids handing it
  // anything worse than CAPTURE_UNAVAILABLE).
  return { integrityResult: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE, reason: 'unclassified-fallback' };
}

// ------------------------------------------------------------------------------------------
// §6.6 Console/page/runtime error ledger
// ------------------------------------------------------------------------------------------

// No allow-listed console.error fingerprint exists at plan time (plan §6.6's own text) --
// deliberately empty, extensible only by an exact string/regex fingerprint tied to phase,
// source, and Viewer version, each with a one-line justification recorded alongside it. Never
// pre-populate this with a guess.
const CONSOLE_ERROR_ALLOWLIST = [];

function matchesConsoleErrorAllowlistEntry(entry, event) {
  if (entry.pattern instanceof RegExp) return entry.pattern.test(event.message || '');
  return entry.pattern === event.message;
}

/**
 * `classifyLedgerEvent(event, { closeIntent })` -- plan §6.6's always-fatal list and the
 * `closeIntent`-gated crash/close exception.
 *
 * `event` shape (this stage's own documented design; a later stage's real `page.on(...)`/
 * `context.on(...)`/`browser.on(...)` listeners build these): `{ kind: 'pageerror' |
 * 'unhandledrejection' | 'required-resource-failure' | 'webglcontextlost' | 'crash' | 'close' |
 * 'console', level?, message? }`. `level` (`'error'|'warn'|'info'|'log'`) and `message` apply
 * only to `kind: 'console'`.
 *
 * `closeIntent` -- `undefined`/`null` (its initial, unset value) or `'cleanup'` (set
 * immediately before each of `page.close()`/`context.close()`/`browser.close()`, per §6.6).
 * Only meaningful for `crash`/`close` events.
 *
 * Returns `{ fatal: boolean, reason }`. Never throws for a recognized `kind`; throws for an
 * unrecognized one (a harness-side programming error, not a runtime event, so failing loudly
 * here is correct -- fail-closed classification logic must never silently pass an event kind
 * it doesn't understand).
 */
function classifyLedgerEvent(event, { closeIntent } = {}) {
  switch (event && event.kind) {
    case 'pageerror':
      return { fatal: true, reason: 'pageerror' };
    case 'unhandledrejection':
      return { fatal: true, reason: 'unhandledrejection' };
    case 'required-resource-failure':
      return { fatal: true, reason: 'required-resource-failure' };
    case 'webglcontextlost':
      return { fatal: true, reason: 'webglcontextlost' };
    case 'crash':
    case 'close': {
      const expectedTeardown = closeIntent === 'cleanup';
      return { fatal: !expectedTeardown, reason: expectedTeardown ? 'expected-teardown' : `${event.kind}-while-closeIntent-unset` };
    }
    case 'console': {
      if (event.level !== 'error') return { fatal: false, reason: `console-${event.level}-never-fatal` };
      const allowed = CONSOLE_ERROR_ALLOWLIST.some((entry) => matchesConsoleErrorAllowlistEntry(entry, event));
      return { fatal: !allowed, reason: allowed ? 'allow-listed' : 'console-error-not-allow-listed' };
    }
    default:
      throw new Error(`classifyLedgerEvent: unrecognized event kind '${event && event.kind}'`);
  }
}

// ------------------------------------------------------------------------------------------
// §7.3 F3 readiness scoring
// ------------------------------------------------------------------------------------------

/**
 * `scoreF3Readiness(timeline)` -- plan §7.3's exact success/failure criteria, pure.
 *
 * `timeline` shape (this stage's own documented design; the real in-page F3 probe -- listener
 * install + the throwaway-binding `resolveRoots` call it issues at `MODEL_ADDED_EVENT` time --
 * is an INJECTED, opaque dependency per this stage's authorization boundary, not built here;
 * `finalizeF3Probe()` in `runSetupThroughClassification`'s `deps` is what produces this shape):
 * {
 *   modelAddedObserved: boolean,
 *   tModelAdded: number | null,
 *   atInvocation: { isObjectTreeCreated, instanceTreeInData, isLoadDone } | null,
 *   resolveRootsOutcome: 'resolved' | 'rejected' | 'timed-out' | null,
 *   atSettlement: { isObjectTreeCreated, instanceTreeInData, isLoadDone } | null,
 *   elapsedMs: number | null,
 *   rejectionError: unknown | null,   // raw error; this function passes it through describeError
 * }
 *
 * Returns `{ verdict, reason, fields, error? }` -- `verdict` is one of Stage 1's `CHECK_VERDICT`
 * values.
 */
function scoreF3Readiness(timeline) {
  const t = timeline || {};
  if (t.modelAddedObserved !== true) {
    return { verdict: CHECK_VERDICT.FAIL, reason: 'model-added-never-observed', fields: t };
  }
  if (t.resolveRootsOutcome === 'timed-out') {
    return { verdict: CHECK_VERDICT.FAIL, reason: 'readiness-never-settled', fields: t };
  }
  if (t.resolveRootsOutcome === 'rejected') {
    return { verdict: CHECK_VERDICT.FAIL, reason: 'resolve-roots-rejected', fields: t, error: t.rejectionError ? describeError(t.rejectionError) : null };
  }
  if (t.resolveRootsOutcome === 'resolved') {
    return { verdict: CHECK_VERDICT.PASS, reason: null, fields: t, readinessGateSufficient: true };
  }
  // Any other/missing outcome is fail-closed -- never a silent PASS for an unrecognized state.
  return { verdict: CHECK_VERDICT.FAIL, reason: 'unrecognized-resolveRootsOutcome', fields: t };
}

// ------------------------------------------------------------------------------------------
// §4.1 -- in-page format-signal capture, and the Node-side shim readFormat runs against.
//
// Per codex-advisor consult (this stage's design boundary): the live Model this needs to call
// isOTG()/isSVF2() on only ever exists at window.__g1.models[tokenId] (Stage 2's own "no live
// object crosses realms" rule). This in-page function captures the RAW signals once each,
// JSON-safe; the CLASSIFICATION decision itself still runs entirely in Node, via Stage 1's
// real, unmodified readFormat(), against a plain shim object built from this capture --
// readFormat is never handed the live Model, and is never itself run in-page.
// ------------------------------------------------------------------------------------------

/**
 * In-page. `captureModelFormatSignals({ tokenId, gen })` -- references only its own argument
 * and `window.__g1`. Requires a matching token id AND generation, and a `loadDocumentNode`
 * record that reached `'completed'` (anything else means there is no trustworthy live Model to
 * read). Invokes `isOTG()`/`isSVF2()` at most once each. Distinguishes "the method is absent"
 * (`'UNAVAILABLE'`, matching `readFormat`'s own sentinel) from "the method is present but
 * threw" (`null`, plus a `captureErrors` entry) -- a throw is NEVER silently downgraded to
 * `'UNAVAILABLE'`, since that would change `readFormat(realModel)`'s own semantics (where
 * `'UNAVAILABLE'` specifically means "the API is absent from this Viewer version", not "the
 * API is broken"). A caller must route a capture error (`isOTG`/`isSVF2 === null`) through its
 * own fatal-error handling, never through the classifier.
 */
function captureModelFormatSignals({ tokenId, gen }) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r || r.gen !== gen) return { ok: false, reason: 'missing-or-generation-mismatch' };
  if (r.status !== 'completed' || r.api !== 'loadDocumentNode') {
    return { ok: false, reason: 'no-completed-loadDocumentNode-record' };
  }
  const model = g.models[tokenId];
  if (!model) return { ok: false, reason: 'model-not-found' };

  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), code: e.code, reason: e.reason }
    : { primitive: typeof e, value: String(e) });

  const result = { ok: true, isOTG: 'UNAVAILABLE', isSVF2: 'UNAVAILABLE', captureErrors: [] };
  if (typeof model.isOTG === 'function') {
    try { result.isOTG = model.isOTG(); } catch (e) { result.isOTG = null; result.captureErrors.push({ signal: 'isOTG', error: errOf(e) }); }
  }
  if (typeof model.isSVF2 === 'function') {
    try { result.isSVF2 = model.isSVF2(); } catch (e) { result.isSVF2 = null; result.captureErrors.push({ signal: 'isSVF2', error: errOf(e) }); }
  }
  return result;
}

/**
 * Node-side. `buildFormatSignalShim(snapshot)` -- builds a plain object from
 * `captureModelFormatSignals`'s JSON-safe snapshot for Stage 1's `readFormat(model)` to run
 * against. A signal of `'UNAVAILABLE'` omits that method entirely (mirroring a real absent
 * API); a captured boolean becomes a method returning exactly that value once. Throws --
 * rather than silently building a shim `readFormat` would misreport as `'UNAVAILABLE'` -- if
 * the capture itself failed (`snapshot.ok !== true`) or either signal is `null` (a genuine
 * in-page capture error, not an absence); the caller must handle that case before ever calling
 * this.
 */
function buildFormatSignalShim(snapshot) {
  if (!snapshot || snapshot.ok !== true) {
    throw new Error(`buildFormatSignalShim: cannot build a shim from an unsuccessful capture (reason: ${snapshot && snapshot.reason})`);
  }
  if (snapshot.isOTG === null || snapshot.isSVF2 === null) {
    throw new Error('buildFormatSignalShim: a format-signal capture error occurred in-page (isOTG/isSVF2 threw) -- route this through fatal-error handling, never silently treat it as UNAVAILABLE');
  }
  const shim = {};
  if (snapshot.isOTG !== 'UNAVAILABLE') shim.isOTG = () => snapshot.isOTG;
  if (snapshot.isSVF2 !== 'UNAVAILABLE') shim.isSVF2 = () => snapshot.isSVF2;
  return shim;
}

// ------------------------------------------------------------------------------------------
// §6.5/§6.3a -- the `tree-unavailable` control
// ------------------------------------------------------------------------------------------

function withControlTimeout(promiseLike, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`control timed out after ${ms}ms`);
      err.controlTimeout = true;
      reject(err);
    }, ms);
    Promise.resolve(promiseLike).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * `runTreeUnavailableControl({ modelBefore, world, registry, registryKey, checkReadiness,
 * controlTimeoutMs })` -- plan §6.5's `tree-unavailable` row + §6.3a's classification (run at
 * Phase 3c, right after F3). Patches `modelBefore.isObjectTreeCreated`/`getObjectTree` to fail,
 * confirms `checkReadiness` (an injected stand-in for F3's real readiness gate -- see
 * `scoreF3Readiness`'s own doc for why the real gate is out of this stage's scope) classifies
 * this as a readiness failure rather than a silent pass, restores in `finally`, then verifies
 * restoration via the plan's own oracle: each patched member re-read and confirmed identical
 * to its pre-patch original, plus `world.isModelLive(modelBefore)` and
 * `registry.bindingFor(registryKey).model === modelBefore`.
 *
 * `restorationRequired` is taken from Stage 1's own `CONTROL_RESTORATION_REQUIRED['tree-
 * unavailable']` via `createControlResult` -- never hardcoded here, so this control can never
 * silently drift from Stage 1's already-committed, plan-line-843-cross-checked value (`true`).
 */
async function runTreeUnavailableControl({ modelBefore, world, registry, registryKey, checkReadiness, controlTimeoutMs = CHECK_TIMEOUT_MS }) {
  if (!modelBefore || typeof modelBefore !== 'object' || typeof checkReadiness !== 'function') {
    return createControlResult('tree-unavailable', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  const hasOwnIsObjectTreeCreated = Object.prototype.hasOwnProperty.call(modelBefore, 'isObjectTreeCreated');
  const hasOwnGetObjectTree = Object.prototype.hasOwnProperty.call(modelBefore, 'getObjectTree');
  const originalIsObjectTreeCreated = modelBefore.isObjectTreeCreated;
  const originalGetObjectTree = modelBefore.getObjectTree;

  let detected = null;
  let timedOut = false;
  let reason = null;

  try {
    modelBefore.isObjectTreeCreated = () => false;
    modelBefore.getObjectTree = (onSuccess, onError) => { if (onError) onError(new Error('tree-unavailable control: simulated failure')); };

    const gateResult = await withControlTimeout(checkReadiness(modelBefore), controlTimeoutMs);
    detected = Boolean(gateResult && gateResult.ready === false);
    if (!detected) reason = 'not-detected';
  } catch (e) {
    if (e && e.controlTimeout) {
      timedOut = true;
      reason = 'perturbation-timeout';
    } else {
      detected = false;
      reason = 'checkReadiness-threw';
    }
  } finally {
    if (hasOwnIsObjectTreeCreated) modelBefore.isObjectTreeCreated = originalIsObjectTreeCreated;
    else delete modelBefore.isObjectTreeCreated;
    if (hasOwnGetObjectTree) modelBefore.getObjectTree = originalGetObjectTree;
    else delete modelBefore.getObjectTree;
  }

  if (timedOut) {
    return createControlResult('tree-unavailable', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const membersRestored = modelBefore.isObjectTreeCreated === originalIsObjectTreeCreated
    && modelBefore.getObjectTree === originalGetObjectTree;
  const worldLiveOk = !world || world.isModelLive(modelBefore) === true;
  const bindingOk = !registry || Boolean(registry.bindingFor(registryKey) && registry.bindingFor(registryKey).model === modelBefore);
  const restored = membersRestored && worldLiveOk && bindingOk;

  if (!detected) {
    return createControlResult('tree-unavailable', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('tree-unavailable', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: reason || 'restore-assertion-failed' });
  }
  return createControlResult('tree-unavailable', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

// ------------------------------------------------------------------------------------------
// §6.1/§6.1a -- Phase 0-3 orchestration
// ------------------------------------------------------------------------------------------

/**
 * `runSetupThroughClassification(deps)` -- Phase 0-3 (plan §6.1's phase table, through Phase 3
 * only; see the EXTENSION POINT comment at the bottom of this function for Phase 4/F1 onward).
 * Every page-interaction dependency is injected -- reusing Stage 2's own `pageEvaluate`/
 * `pageWaitForFunction` shape plus three stage-3-specific opaque contracts, per the
 * codex-advisor consult: real F3-probe wiring (listener install + the real, throwaway-binding
 * `resolveRoots` call §7.3 requires) and real Phase 2.5 session construction (`world`/
 * `registry`/`binding`, requiring the real repo modules running against a live Viewer) are
 * both out of this stage's authorization/scope -- their REAL implementations are a later,
 * separately-authorized stage's job. This function owns only the ORCHESTRATION SEQUENCE and
 * how it interprets each dependency's result.
 *
 * `deps` shape:
 * {
 *   installF3Probe: () => Promise<void>,        // Phase 1 (§4.4) -- BEFORE Document.load. Real
 *                                                 // contract: install the MODEL_ADDED_EVENT
 *                                                 // listener AND issue the real
 *                                                 // resolveRoots(throwawayBinding, 'whole', ctx)
 *                                                 // call at MODEL_ADDED_EVENT time (§7.3) --
 *                                                 // page-owned state, nothing returned to Node.
 *   finalizeF3Probe: () => Promise<F3Timeline>,  // Phase 3 -- removes the listener, returns the
 *                                                 // timeline scoreF3Readiness reads (its own doc).
 *   pageEvaluate, pageWaitForFunction,            // Stage 2's own injected shape, reused verbatim.
 *   loadStarter: { documentLoad, loadDocumentNode }, // opaque in-page starter fn references
 *                                                 // Stage 2's startLoad() itself takes as `starter`.
 *   captureFormatSignalsFn = captureModelFormatSignals, // overridable for testing only.
 *   loadTimeoutMs: number,
 *   urn: string,
 *   setupSharedSessionResources: (tokenId) => Promise<{
 *     ok: boolean, sessionId: string | null,
 *     postconditions: { registryWorldMatches, bindingModelMatches, worldModelIsLive } | null,
 *     error: unknown | null,
 *   }>,   // Phase 2.5 (§6.1a) -- injected/opaque per the codex-advisor consult: the real
 *         // implementation stores world/registry/binding/model under page-owned state (e.g.
 *         // window.__g1.session) and returns only this JSON-safe receipt; Node owns just
 *         // `sessionId` plus the receipt, never a live resource reference.
 * }
 *
 * Returns `{ phaseReached, docLoad, loadDocumentNode, classifier, formatSignals, phase25,
 * checks, fatalErrorObserved? }`. `phaseReached` is one of `'load' | 'classifier-stop' |
 * 'phase2.5-setup-failed' | 'phase3'`, telling a caller/test exactly how far the sequence got.
 * `checks` only ever contains `F3` this stage (F1/F2/F4-F8 are later stages' own additions).
 */
async function runSetupThroughClassification(deps) {
  const {
    installF3Probe, finalizeF3Probe, pageEvaluate, pageWaitForFunction,
    loadStarter, captureFormatSignalsFn = captureModelFormatSignals,
    loadTimeoutMs, urn, setupSharedSessionResources,
  } = deps;

  // Phase 1 -- F3 probe install, strictly before Phase 2's load call (§4.4).
  await installF3Probe();

  // Phase 2 -- load: Document.load, then (only if that token completed) loadDocumentNode. The
  // two-stage linkage (loadDocumentNode's token is only minted once Document.load's own token
  // reaches 'completed') is this function's own sequencing -- Stage 2's startLoad() itself
  // handles a single call's reconciliation, not the linkage between two calls.
  const docLoad = await startLoad({
    pageEvaluate, starter: loadStarter.documentLoad, api: LOAD_API.DOCUMENT_LOAD, urn, loadTimeoutMs,
  });
  if (docLoad.token.state !== TOKEN_STATE.COMPLETED) {
    return { phaseReached: 'load', docLoad, loadDocumentNode: null, classifier: null, formatSignals: null, phase25: null, checks: {} };
  }

  const loadDocumentNodeResult = await startLoad({
    pageEvaluate, starter: loadStarter.loadDocumentNode, api: LOAD_API.LOAD_DOCUMENT_NODE,
    docTokenId: docLoad.token.id, loadTimeoutMs,
  });
  if (loadDocumentNodeResult.token.state !== TOKEN_STATE.COMPLETED) {
    return { phaseReached: 'load', docLoad, loadDocumentNode: loadDocumentNodeResult, classifier: null, formatSignals: null, phase25: null, checks: {} };
  }

  // Classifier -- run once, immediately after load-done, before any F1-F8 check (§4.1). Only
  // the raw signal CAPTURE happens in-page (captureFormatSignalsFn); the classification
  // decision itself runs here, in Node, through Stage 1's real readFormat().
  const signalSnapshot = await pageEvaluate(captureFormatSignalsFn, { tokenId: loadDocumentNodeResult.token.id, gen: loadDocumentNodeResult.gen });
  let classifierResult;
  if (!signalSnapshot || signalSnapshot.ok !== true || signalSnapshot.isOTG === null || signalSnapshot.isSVF2 === null) {
    // A capture failure (never silently treated as UNAVAILABLE, per buildFormatSignalShim's/
    // captureModelFormatSignals' own documented contract) is a genuinely broken/throwing
    // isOTG()/isSVF2() -- a harness/runtime malfunction, not a benign "never confirmed SVF2"
    // outcome. Fixed round-1 correction (Stage 3 review): this must set fatalErrorObserved,
    // exactly like the structurally analogous Phase 2.5 postcondition-failure branch below --
    // without it, a thrown isOTG()/isSVF2() was indistinguishable by shape from an ordinary,
    // benign classifier-stop (CONFIRMED_NON_SVF2/CONTRADICTORY/INDETERMINATE_*), aside from the
    // undocumented `captureFailure: true` marker, contradicting captureModelFormatSignals' own
    // doc-comment: "A caller must route a capture error ... through its own fatal-error
    // handling, never through the classifier."
    return {
      phaseReached: 'classifier-stop', docLoad, loadDocumentNode: loadDocumentNodeResult,
      classifier: null, formatSignals: signalSnapshot, phase25: null, checks: {},
      captureFailure: true,
      fatalErrorObserved: true,
    };
  }
  classifierResult = readFormat(buildFormatSignalShim(signalSnapshot));

  if (classifierResult.classifier !== CLASSIFIER.CONFIRMED_SVF2) {
    return {
      phaseReached: 'classifier-stop', docLoad, loadDocumentNode: loadDocumentNodeResult,
      classifier: classifierResult, formatSignals: signalSnapshot, phase25: null, checks: {},
    };
  }

  // Phase 2.5 -- shared session resources + setup postconditions (§6.1a). Injected/opaque --
  // see this function's own doc for why.
  const phase25 = await setupSharedSessionResources(loadDocumentNodeResult.token.id);
  if (!phase25 || phase25.ok !== true) {
    return {
      phaseReached: 'phase2.5-setup-failed', docLoad, loadDocumentNode: loadDocumentNodeResult,
      classifier: classifierResult, formatSignals: signalSnapshot, phase25, checks: {},
      // A Phase-2.5 setup-postcondition failure is fatal (§6.1a: "a failure here is a
      // Phase-2.5 setup failure ... fatal per §6.6"), never an individual Fi's BLOCKED.
      fatalErrorObserved: true,
    };
  }

  // Phase 3 -- F3 finalize: remove the listener NOW (not at final cleanup, fixes I3), read out
  // the timeline, score F3.
  const f3Timeline = await finalizeF3Probe();
  const f3Score = scoreF3Readiness(f3Timeline);

  return {
    phaseReached: 'phase3', docLoad, loadDocumentNode: loadDocumentNodeResult,
    classifier: classifierResult, formatSignals: signalSnapshot, phase25,
    checks: { F3: f3Score },
    // ==== EXTENSION POINT for later stages ====
    // A later stage inserts Phase 3c (the tree-unavailable control, via
    // runTreeUnavailableControl above) and Phase 4 (F1) onward HERE, immediately after this
    // return point, reusing this same `deps`-style injection pattern and the `phase25`
    // session receipt already built above -- it must not rebuild Phase 0-3 to add Phase 4.
  };
}

// ============================================================================================
// STAGE 4 -- Canonical-observation slice: Phase 2.5's real construction (the FROZEN shared
// session-state contract F4/F5/F7/F8/F6 all reuse verbatim), F1, F2, and their two immediate
// mandatory controls (plan §6.1a, §6.1 Phase 4/4c/5/5c, §7.1, §7.2, §6.5/§6.3a's wrong-owner
// and hidden-fragment rows).
//
// Per codex-advisor consult (medium, before implementation -- this stage's own explicit
// invitation, given how foundational this contract is): (1) test the real in-page construction
// function via the SAME node:vm reconstruction Stage 2 established (createPageRealm-style),
// not a plain globalThis.window fake -- a plain fake would not catch an accidental Node-module
// closure reference the way reconstructing the function from its own source text does; (2)
// window.__g1.mod[specifier] is the correct way to reference dynamically-imported repo modules
// from an in-page function (matches this repo's own accepted INSTALL_T3 precedent,
// clashtest-viewer-adapter.acceptance.mjs:181-185) -- never pass a module namespace/class as a
// page.evaluate argument, since functions are not structured-cloneable across that boundary;
// (3) CRITICAL, confirmed by reading clashtest/identity/ModelRegistry.js:143,225-236 directly:
// `registry.bindingFor(K)` LAZILY calls `world.admitModel(model)` the first time it is read --
// so by the time a Phase-2.5 postcondition is even checked, the model may already be admitted
// into the world. "Never store a partial session on failure" is therefore insufficient by
// itself; every failure path (after `world` exists) must ALSO best-effort
// `registry.unregister(model)` / `world.evictModel(model)` / `world.dispose()` before
// returning, since Node never learns about this in-page-only world/registry otherwise (Stage
// 2's own 22-step cleanup executor only ever sees `resources.world`/`resources.registry` if a
// later stage's real wiring populates them from a SUCCESSFUL Phase 2.5 receipt) -- adopted
// verbatim; (4) the receipt's JSON shape must normalize every field explicitly (no `undefined`,
// which disappears during serialization) and use `registry.registrySessionId` (a real,
// already-validated non-empty string getter, `ModelRegistry.js:58`) as the session id rather
// than inventing one -- adopted verbatim; (5) the page-owned artifacts slot F8 will need
// (`f1FragmentMapsByRoot`) must be a real `Map`, not a plain object frozen to string-keyed
// semantics before F1 (this same stage) even exists -- adopted verbatim.
// ============================================================================================

const SESSION_K = 'g1-f1f8-verification';
const SESSION_MODEL_VERSION = 'g1-live-1';

/** In-page. Small, self-contained error shape, mirrors the pattern used throughout this file's
 * other in-page functions (pageErrOf, captureModelFormatSignals' own inline errOf). Duplicated
 * intentionally rather than shared, per this file's own documented bundling-note discipline
 * (Stage 2) -- each in-page function stays independently reconstructable from its own source. */
function sessionErrOf(e) {
  return e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), reason: e.reason ?? null }
    : { primitive: typeof e, value: String(e) };
}

/**
 * In-page. `setupSharedSessionResources(tokenId)` -- plan §6.1a's real construction sequence,
 * the FROZEN shared session-state contract every later stage (F4/F5/F7/F8, and F6 last) reuses
 * verbatim without renegotiation. This is the real implementation of the dependency Stage 3's
 * `runSetupThroughClassification` already names and calls as an injected `deps.
 * setupSharedSessionResources(tokenId)` -- a later, separately-authorized live-run stage wires
 * `deps.setupSharedSessionResources = (tokenId) => pageEvaluate(setupSharedSessionResources,
 * {tokenId})` unchanged.
 *
 * References only its own argument and window.__g1/window.__viewer. Reads the already-
 * dynamically-imported repo modules it needs from `window.__g1.mod[specifier]` (a later stage's
 * own separate import-installation page.evaluate call populates this, mirroring INSTALL_T3 --
 * this function does not perform those imports itself).
 *
 * Construction sequence (plan §6.1a): `world = await CollisionWorld.fromViewer(viewer, {})`;
 * `registry = createModelRegistry({world})`; `enumerator = createViewerElementEnumerator()`;
 * `registry.register(K, model, {modelVersion})` then `binding = registry.bindingFor(K)`;
 * setup postconditions `registry.world === world`, `binding.model === model`,
 * `world.isModelLive(model) === true`. `K`/`modelVersion` are the plan's own fixed, harness-
 * local values (`SESSION_K`/`SESSION_MODEL_VERSION`), never fed into any other derivation.
 *
 * On ANY failure after `world` exists, best-effort cleans up whatever was actually constructed
 * (`registry.unregister(model)`, `world.evictModel(model)`, `world.dispose()`, each in its own
 * try/catch, never masking the original error) before returning -- see the codex-advisor
 * section above for why this is required, not optional.
 *
 * On success, stores `{tokenId, world, registry, enumerator, binding, model, K, modelVersion,
 * artifacts: {f1FragmentMapsByRoot: new Map()}}` under `window.__g1.sessions[sessionId]`
 * (page-owned, NEVER returned to Node) and returns the JSON-safe receipt `{ok: true, sessionId,
 * postconditions, error: null, cleanup: null}`. `sessionId` is `registry.registrySessionId`
 * (already a validated non-empty string the registry itself generates) -- rejects (and cleans
 * up) rather than overwriting an existing key of the same id.
 *
 * On failure, returns `{ok: false, sessionId: null, postconditions: <partial|null>,
 * error: {phase, name, message, reason}, cleanup: {attempted, failures} | null}`. `phase` is
 * one of `'precondition' | 'world' | 'registry' | 'enumerator' | 'register' | 'postconditions'
 * | 'publish'`.
 */
async function setupSharedSessionResources(tokenId) {
  const g = window.__g1;
  const r = g && g.loads[tokenId];
  if (!r || r.status !== 'completed' || r.api !== 'loadDocumentNode') {
    return { ok: false, sessionId: null, postconditions: null, error: { phase: 'precondition', name: null, message: 'no-completed-loadDocumentNode-record', reason: null }, cleanup: null };
  }
  const model = g.models[tokenId];
  if (!model) {
    return { ok: false, sessionId: null, postconditions: null, error: { phase: 'precondition', name: null, message: 'model-not-found', reason: null }, cleanup: null };
  }

  const mod = g.mod || {};
  let world = null;
  let registry = null;
  let enumerator = null;
  let binding = null;

  const cleanup = { attempted: [], failures: [] };
  const bestEffortCleanup = () => {
    if (registry && model) {
      try { registry.unregister(model); cleanup.attempted.push('registry.unregister'); }
      catch (e) { cleanup.failures.push({ step: 'registry.unregister', error: sessionErrOf(e) }); }
    }
    if (world && model) {
      try { world.evictModel(model); cleanup.attempted.push('world.evictModel'); }
      catch (e) { cleanup.failures.push({ step: 'world.evictModel', error: sessionErrOf(e) }); }
    }
    if (world) {
      try { world.dispose(); cleanup.attempted.push('world.dispose'); }
      catch (e) { cleanup.failures.push({ step: 'world.dispose', error: sessionErrOf(e) }); }
    }
  };

  try {
    const { CollisionWorld } = mod['/collision/index.js'];
    world = await CollisionWorld.fromViewer(window.__viewer, {});
  } catch (e) {
    return { ok: false, sessionId: null, postconditions: null, error: { phase: 'world', ...sessionErrOf(e) }, cleanup: null };
  }

  try {
    const { createModelRegistry } = mod['/clashtest/index.js'];
    registry = createModelRegistry({ world });
  } catch (e) {
    bestEffortCleanup();
    return { ok: false, sessionId: null, postconditions: null, error: { phase: 'registry', ...sessionErrOf(e) }, cleanup };
  }

  try {
    const { createViewerElementEnumerator } = mod['/clashtest/viewer/index.js'];
    enumerator = createViewerElementEnumerator();
  } catch (e) {
    bestEffortCleanup();
    return { ok: false, sessionId: null, postconditions: null, error: { phase: 'enumerator', ...sessionErrOf(e) }, cleanup };
  }

  try {
    // Literal strings, not the module-level SESSION_K/SESSION_MODEL_VERSION constants -- this
    // is an in-page function and may reference only its own argument and page globals (Stage 2's
    // established constraint; a module-level constant is neither). Fix-round correction, caught
    // by the node:vm test harness exactly as designed: MUST stay byte-identical to SESSION_K/
    // SESSION_MODEL_VERSION above -- a dedicated test asserts both the literal values here AND
    // that a published session's own K/modelVersion fields equal the exported constants.
    registry.register('g1-f1f8-verification', model, { modelVersion: 'g1-live-1' });
    binding = registry.bindingFor('g1-f1f8-verification');
  } catch (e) {
    bestEffortCleanup();
    return { ok: false, sessionId: null, postconditions: null, error: { phase: 'register', ...sessionErrOf(e) }, cleanup };
  }

  const postconditions = {
    registryWorldMatches: registry.world === world,
    bindingModelMatches: Boolean(binding) && binding.model === model,
    worldModelIsLive: (() => { try { return world.isModelLive(model) === true; } catch { return false; } })(),
  };
  const ok = postconditions.registryWorldMatches && postconditions.bindingModelMatches && postconditions.worldModelIsLive;

  if (!ok) {
    bestEffortCleanup();
    return { ok: false, sessionId: null, postconditions, error: { phase: 'postconditions', name: null, message: 'setup-postcondition-failed', reason: null }, cleanup };
  }

  const sessionId = registry.registrySessionId;
  g.sessions = g.sessions || {};
  if (g.sessions[sessionId]) {
    bestEffortCleanup();
    return { ok: false, sessionId: null, postconditions, error: { phase: 'publish', name: null, message: 'session-id-already-exists', reason: null }, cleanup };
  }

  g.sessions[sessionId] = {
    tokenId, world, registry, enumerator, binding, model,
    K: 'g1-f1f8-verification', modelVersion: 'g1-live-1',
    // Task 10 (bounded completion pass, area 3 shared foundation) addition: the load record's
    // own `gen` (`r.gen`, already read above), retained on the session itself -- strictly
    // additive, no existing field renamed/removed. `acquireControlLease` (below) needs this to
    // validate a control command's own `{tokenId, gen}` claim against what the session was
    // ACTUALLY constructed from, never trusting the command's own say-so alone.
    tokenGen: r.gen,
    artifacts: { f1FragmentMapsByRoot: new Map() },
    // Task 10 addition: no control has ever acquired this session's lease yet -- see
    // `acquireControlLease`/`releaseControlLease`, below.
    activeControl: null,
  };

  return { ok: true, sessionId, postconditions, error: null, cleanup: null };
}

// ============================================================================================
// Bounded completion pass, area 3 -- control-bridging SHARED FOUNDATION (this file's own Task
// 10; the six mandatory controls' own mutation/detection logic is Tasks 11/12, not built here).
//
// Why this exists (see `.superpowers/sdd/g1-f1-f8-harness/briefs/task-10-brief.md` for the full
// reasoning -- transcribed from a codex-advisor consult, request 20260928-170455-5002-1315, plus
// a second design-sanity-check consult for this task specifically, request
// 20260928-180527-75769-27344): the six existing `run*Control` functions below (
// `runTreeUnavailableControl`, `runWrongOwnerControl`, `runHiddenFragmentControl`,
// `runCapacityBreachControl`, `runInvalidBoundsControl`, `runBoundsBeyondToleranceControl`) were
// written assuming DIRECT Node-side access to `modelBefore`/`world`/`registry` as live JS object
// references -- impossible for a real run, since those objects live only in the browser page
// (`window.__g1.sessions[sessionId]`, this file's own `setupSharedSessionResources`). This
// section builds the shared, generic, artifact-key-driven, control-agnostic machinery every one
// of the six controls will use to bridge across the realm boundary safely: an exclusive
// page-owned lease (so an outer-watchdog-timed-out control can never race a later step against
// the same shared session state), an isolated scratch-artifact namespace (so a control's own
// detection re-observation, e.g. re-running observeF1's logic for wrong-owner, can never corrupt
// the RETAINED F1/F2/F4/F7 evidence later checks consume), and a generic Node-side two-tier-
// timeout wrapper (`runBridgedControl`, below `withControlTimeout`) plus the `sessionTainted`
// short-circuit `runHarness` itself needs when that OUTER watchdog (never the in-page one) fires.
// ============================================================================================

/**
 * In-page. `recordControlPatch(session, {target, property, originalDescriptor})` -- deliverable
 * 1 (Task 10 brief). Appends one patch-rollback record onto `session.activeControl.patches`.
 * Throws if `session.activeControl` does not exist (a control must `acquireControlLease` before
 * it may ever call this) or if `target`/`property` are missing -- a control forgetting to
 * acquire its lease first is a genuine bug, never silently tolerated here.
 *
 * `target`/`property` identify WHAT was patched. `originalDescriptor` is the result of
 * `Object.getOwnPropertyDescriptor(target, property)` taken BEFORE the patch was installed, or
 * `null` if the property did not exist as an own property before patching -- matching the six
 * existing controls' own `hasOwnProperty` + delete-vs-restore convention, preserved here via a
 * full descriptor rather than a separately-tracked boolean (the six existing controls' own
 * `hasOwn*`/`original*` pair, e.g. `runWrongOwnerControl`, this file, ~line 3171).
 *
 * Per the second (task-sanity-check) codex-advisor consult's finding 4: this ALSO captures
 * `installedDescriptor` -- `Object.getOwnPropertyDescriptor(target, property)` read AGAIN, right
 * NOW (i.e. the patch is assumed already installed by the time a control calls this) -- so
 * Phase 11's own fallback restoration (`restoreAllControlPatches`, `runInPageResourceCleanup`,
 * below) can verify the CURRENT property is still the exact patch this record describes before
 * ever overwriting it, never blindly clobbering a legitimate external change made after this
 * patch was installed (e.g. a later control's own patch to the SAME property, however unlikely
 * given the exclusive lease -- defense in depth, not assumed impossible).
 *
 * Returns the appended record (never required by callers).
 */
function recordControlPatch(session, { target, property, originalDescriptor } = {}) {
  if (!session || !session.activeControl) {
    throw new Error('recordControlPatch: no active control lease on this session');
  }
  if (!target || typeof property !== 'string' || property === '') {
    throw new Error('recordControlPatch: target/property required');
  }
  const installedDescriptor = Object.getOwnPropertyDescriptor(target, property) || null;
  const record = {
    target, property,
    originalDescriptor: originalDescriptor || null,
    installedDescriptor,
  };
  session.activeControl.patches.push(record);
  return record;
}

/**
 * In-page. `acquireControlLease({sessionId, tokenId, gen, controlId})` -- deliverable 1 (Task 10
 * brief). Validates the four preconditions from the original consult's finding 5, IN THIS EXACT
 * ORDER, returning the FIRST failure's own reason (never a generic failure):
 *
 * 1. `no-session` -- `window.__g1.sessions[sessionId]` does not exist.
 * 2. `load-record-mismatch` -- EITHER the session's own retained `{tokenId, tokenGen}` (set at
 *    Phase 2.5 construction time, `setupSharedSessionResources`) disagrees with the command's own
 *    `{tokenId, gen}` claim, OR `window.__g1.loads[tokenId]` is no longer the matching completed
 *    `loadDocumentNode` record for that same `gen` (mirrors `onDeadline`/`onSuccess`/`onError`'s
 *    own `r.gen !== gen` convention, this file, ~line 992/1015/1042 -- exact equality, never a
 *    truthy/loose comparison) -- folded into ONE reason since both describe the same underlying
 *    concern (the load/session identity this command claims to operate against is no longer
 *    valid), per the original consult's own finding 5 bullet list.
 * 3. `model-mismatch` -- `window.__g1.models[tokenId] !== session.model`.
 * 4. `lease-already-held` -- `session.activeControl` is already set (mutual exclusion: an outer
 *    watchdog timeout is EXACTLY the condition that could otherwise leave an earlier control's
 *    mutation "in flight" while a later step starts -- original consult's own finding 5).
 *
 * On success, sets `session.activeControl = {controlId, tokenId, gen, acquiredAt: Date.now(),
 * patches: []}` and returns `{ok: true}`. `patches` is an array the control itself appends to via
 * `recordControlPatch` (above) -- one entry per property it patches, so a control that patches
 * more than one member (none of the six currently do) is still fully recoverable.
 */
function acquireControlLease({ sessionId, tokenId, gen, controlId } = {}) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'no-session' };

  const sessionIdentityMatches = session.tokenId === tokenId && session.tokenGen === gen;
  const r = g.loads && g.loads[tokenId];
  const loadRecordMatches = Boolean(r) && r.status === 'completed' && r.api === 'loadDocumentNode' && r.gen === gen;
  if (!sessionIdentityMatches || !loadRecordMatches) return { ok: false, reason: 'load-record-mismatch' };

  const model = g.models && g.models[tokenId];
  if (!model || model !== session.model) return { ok: false, reason: 'model-mismatch' };

  if (session.activeControl) return { ok: false, reason: 'lease-already-held' };

  session.activeControl = { controlId, tokenId, gen, acquiredAt: Date.now(), patches: [] };
  return { ok: true };
}

/**
 * In-page. `releaseControlLease({sessionId, controlId})` -- deliverable 1 (Task 10 brief). Clears
 * `session.activeControl` ONLY if its `controlId` matches -- never clears a DIFFERENT control's
 * lease. Returns `{ok: false, reason: 'no-active-lease'}` if there is no session or no active
 * lease at all, `{ok: false, reason: 'controlId-mismatch'}` if a DIFFERENT control currently holds
 * it, `{ok: true}` on success.
 */
function releaseControlLease({ sessionId, controlId } = {}) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.activeControl) return { ok: false, reason: 'no-active-lease' };
  if (session.activeControl.controlId !== controlId) return { ok: false, reason: 'controlId-mismatch' };
  session.activeControl = null;
  return { ok: true };
}

/**
 * In-page. `createControlScratchSession(sessionId, {controlId, copyArtifactKeys})` -- deliverable
 * 2 (Task 10 brief). Publishes a NEW session under a fresh, collision-proof key,
 * `` `${sessionId}::control-scratch::${controlId}` `` (`sessionId` is `registry.registrySessionId`,
 * `controlId` is always one of the fixed `CONTROL_NAMES` strings -- neither ever contains `::`),
 * whose `model`/`world`/`registry`/`binding`/`K`/`modelVersion`/`tokenId` are the SAME live
 * references as the real session (these stay live -- a control needs to mutate/read the actual
 * model), but whose `artifacts` is a FRESH object containing ONLY the keys named in
 * `copyArtifactKeys`, each independently copied from the real session's own `artifacts[key]`.
 *
 * Copy strategy (generic, artifact-shape-driven, per key): a `Map` is copied via
 * `new Map(value.entries())` -- an INDEPENDENT top-level Map whose OWN entries (add/delete/
 * reassign a top-level key) can never affect the original, though a value stored at an existing
 * key that is ITSELF a further mutable object/Map is not independently deep-copied (documented,
 * not silently assumed -- Tasks 11/12 must account for this per-control, e.g. for
 * `f1FragmentMapsByRoot`'s own nested-Map-of-Map shape, if they ever need to mutate a value
 * in place rather than replace a top-level entry). Anything else (plain object, array, primitive)
 * is copied via `structuredClone` -- a genuine deep copy. `undefined`/absent keys are silently
 * skipped (nothing to copy). Picking exactly which `copyArtifactKeys` each control needs, and
 * whatever finer-grained copy strategy a specific key's own shape might require beyond this
 * generic mechanism, is explicitly Tasks 11/12's own job, NOT this task's.
 *
 * Returns `{ok: true, scratchSessionId}` or `{ok: false, scratchSessionId: null, reason}`.
 */
function createControlScratchSession(sessionId, { controlId, copyArtifactKeys = [] } = {}) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, scratchSessionId: null, reason: 'no-session' };

  const scratchSessionId = `${sessionId}::control-scratch::${controlId}`;
  g.sessions = g.sessions || {};
  if (g.sessions[scratchSessionId]) {
    return { ok: false, scratchSessionId: null, reason: 'scratch-session-already-exists' };
  }

  const artifacts = {};
  for (const key of copyArtifactKeys) {
    const value = session.artifacts ? session.artifacts[key] : undefined;
    if (value === undefined) continue;
    artifacts[key] = value instanceof Map ? new Map(value.entries()) : structuredClone(value);
  }

  g.sessions[scratchSessionId] = {
    tokenId: session.tokenId, tokenGen: session.tokenGen,
    world: session.world, registry: session.registry, enumerator: session.enumerator,
    binding: session.binding, model: session.model,
    K: session.K, modelVersion: session.modelVersion,
    artifacts, activeControl: null,
  };

  return { ok: true, scratchSessionId };
}

/**
 * In-page. `disposeControlScratchSession(scratchSessionId)` -- deliverable 2 (Task 10 brief).
 * Deletes `window.__g1.sessions[scratchSessionId]`. Safe to call even if the key does not exist
 * (a control's own `finally` calls this unconditionally) -- never throws.
 */
function disposeControlScratchSession(scratchSessionId) {
  const g = window.__g1;
  if (g && g.sessions && g.sessions[scratchSessionId]) {
    delete g.sessions[scratchSessionId];
  }
  return { ok: true };
}

// ------------------------------------------------------------------------------------------
// §7.1 F1 -- fragment->owner mapping
// ------------------------------------------------------------------------------------------

/**
 * In-page. `observeF1(sessionId)` -- plan §7.1's exact observation sequence, run against the
 * shared Phase 2.5 session -- "F1 is the first consumer of the shared session resources" (plan
 * line 893), never a separately-fabricated binding. References only its own argument and
 * window.__g1/window.THREE. Reads `extractFragments`/`extractAllFragments`
 * (`/collision/viewer/ViewerModelAdapter.js`) and `digestSubtree`/`digestPopulation`
 * (`/clashtest/planning/scopeDigest.js`) from `window.__g1.mod`, same convention as
 * `setupSharedSessionResources`.
 *
 * Sequence: `resolveRoots(binding, 'whole', ctx)` -> for each root, `extractFragments(model,
 * [root.dbId], 0, {THREE})`, compared against the root's own `fragmentCount`/`ownerDbIds`/
 * `subtreeDigest` (mirrors T3's own `MEASURE_ADAPTER` §(a)/(b) exactly,
 * `clashtest-viewer-adapter.acceptance.mjs:268-330`) -> one whole-population
 * `extractAllFragments` vs `resolveRoots`'s own population digest.
 *
 * Plan's own "reuse, never recompute" rule starts here: stores each root's own `extractFragments`
 * `Map` into `session.artifacts.f1FragmentMapsByRoot` (keyed by root `dbId`) for F8 (a later
 * stage) to reuse verbatim, and stores the population's L/N/U classification rows plus
 * `roots.length` into `session.artifacts.f1PopulationClasses`/`f1RootsLength` for F2 (this same
 * stage) to reuse rather than re-walking `extractAllFragments` a second time.
 *
 * Returns a JSON-safe `{ok, fields, first20Mismatches}` (or `{ok:false, reason}`) -- never a
 * `Map`, never a live object. `fields` names every machine-readable field plan §7.1 lists.
 *
 * Known, documented simplification: uses a plain `ctx = {checkpoint(){}}`, not the operation-
 * scoped, token-aware checkpoint plan §6.1a names for F1's own primary operation -- wiring a
 * live per-operation token (§6.4a) into this in-page call is a later stage's own concern (this
 * stage's deliverables do not ask for it), and this plain ctx already matches Phase 2.5's own
 * documented carve-out shape for every OTHER call.
 */
async function observeF1(sessionId) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'session-not-found' };

  // `session.binding` is frozen at Phase-2.5 registration (setupSharedSessionResources) and is
  // never updated by F6's own re-registration (F6 always re-fetches registry.bindingFor(K)
  // fresh instead, per its own doc comment) -- safe here only because the plan's own strict
  // phase order runs every other check, including this one, strictly BEFORE F6 (the harness's
  // one mutating check, required to run last); noted explicitly per Stage 7 review (Minor).
  const { binding, model, enumerator } = session;
  const mod = g.mod || {};
  const { extractFragments, extractAllFragments } = mod['/collision/viewer/ViewerModelAdapter.js'] || {};
  const { digestSubtree, digestPopulation } = mod['/clashtest/planning/scopeDigest.js'] || {};
  const THREE = window.THREE;
  const ctx = { checkpoint() {} };
  const ascending = (a, b) => a - b;

  let rr;
  try {
    rr = await enumerator.resolveRoots(binding, 'whole', ctx);
  } catch (e) {
    // Stage 5 addition: F5 (§7.5's corrected dependency) reads a typed CapacityExceededError/
    // EnumerationBoundExceededError's own limit/requested fields directly -- sessionErrOf's own
    // {name, message, reason} shape drops them, so they are captured here explicitly (additive,
    // never changes sessionErrOf itself, which stays shared with setupSharedSessionResources).
    // CapacityExceededError: Object.assign(this, {limit, requested, ...}) (collision/errors.js) --
    // `limit`/`requested` read directly. EnumerationBoundExceededError: `bound` names WHICH limit
    // (`'maxFragmentsPerDbId'|'maxChildrenPerNode'`), `detail` carries context
    // ({dbId,tally}|{dbId,root,count}) -- no literal limit/requested pair on the error itself;
    // both are retained raw here, F5's own scoreF5 maps them to {limit, requested} per error kind.
    return {
      ok: false,
      reason: 'resolveRoots-threw',
      error: {
        ...sessionErrOf(e),
        kind: e && e.kind !== undefined ? e.kind : null,
        limit: e && e.limit !== undefined ? e.limit : null,
        requested: e && e.requested !== undefined ? e.requested : null,
        bound: e && e.bound !== undefined ? e.bound : null,
        detail: e && e.detail !== undefined ? e.detail : null,
      },
    };
  }

  const first20Mismatches = [];
  let rootsCompared = 0;
  let sizeMismatch = 0;
  let ownersMismatch = 0;
  let subtreeDigestMismatch = 0;

  for (const root of rr.roots) {
    rootsCompared += 1;
    let lib;
    try {
      lib = await extractFragments(model, [root.dbId], 0, { THREE });
    } catch (e) {
      // extractFragments itself throwing is never silently skipped -- counted as a mismatch
      // (nothing to compare) and recorded in the bounded evidence.
      sizeMismatch += 1;
      if (first20Mismatches.length < 20) first20Mismatches.push({ dbId: root.dbId, extractFragmentsThrew: sessionErrOf(e) });
      continue;
    }
    session.artifacts.f1FragmentMapsByRoot.set(root.dbId, lib);
    const owners = [...new Set([...lib.values()].map((rec) => rec.ownerDbId))].sort(ascending);
    const rows = [...lib.values()].map((rec) => ({ fragId: rec.fragmentId, ownerDbId: rec.ownerDbId }));
    let libDigest = null;
    try { libDigest = (await digestSubtree(rows)).digest; } catch { /* libDigest stays null -> digestOk below is false */ }
    const sizeOk = lib.size === root.fragmentCount;
    const ownersOk = JSON.stringify(owners) === JSON.stringify(root.ownerDbIds);
    const digestOk = libDigest !== null && libDigest === root.subtreeDigest;
    if (!sizeOk) sizeMismatch += 1;
    if (!ownersOk) ownersMismatch += 1;
    if (!digestOk) subtreeDigestMismatch += 1;
    if ((!sizeOk || !ownersOk || !digestOk) && first20Mismatches.length < 20) {
      first20Mismatches.push({ dbId: root.dbId, adapter: { fragmentCount: root.fragmentCount, ownerDbIds: root.ownerDbIds }, library: { size: lib.size, owners } });
    }
  }

  let populationDigestEqual = false;
  const populationClasses = [];
  try {
    const { records, diagnostics } = await extractAllFragments(model, 0, { THREE });
    const dropped = new Map(diagnostics.map((d) => [d.fragment.fragId, d.reason === 'fragment-not-loaded' ? 'N' : 'U']));
    const fragList = model.getFragmentList();
    const rows = [];
    for (let f = 0; f < fragList.getCount(); f += 1) {
      if (dropped.has(f)) {
        const cls = dropped.get(f);
        rows.push({ fragId: f, cls });
        populationClasses.push({ fragId: f, cls });
      } else {
        const rec = records.get(f);
        rows.push({ fragId: f, cls: 'L', ownerDbId: rec.ownerDbId });
        populationClasses.push({ fragId: f, cls: 'L' });
      }
    }
    const expected = await digestPopulation({ count: fragList.getCount(), records: rows });
    populationDigestEqual = expected.digest === rr.population.digest;
    // Stage 5 addition: retain the FULL extractAllFragments records Map -- each
    // ExtractedFragmentRecord already carries {fragmentId, geometryIdentity, worldMatrix,
    // worldBounds, ownerDbId} for every loaded (class-L) fragment in the WHOLE tested
    // population (collision/viewer/ViewerModelAdapter.js:253-268), and worldMatrix/worldBounds
    // are already plain, copied-out owned data (never a live THREE object -- confirmed by this
    // repo's own accepted test convention, test/geometry/activeRangeCompaction.test.mjs's
    // "Item A" cases). F4 (this same stage) reuses this verbatim for its own per-geometry-id
    // grouping and per-fragment world matrices -- never re-extracting or re-calling
    // getGeometryId()/readWorldMatrix() a second time.
    session.artifacts.f1PopulationRecords = records;
  } catch {
    populationDigestEqual = false;
  }

  session.artifacts.f1PopulationClasses = populationClasses;
  session.artifacts.f1RootsLength = rr.roots.length;

  // Stage 5 addition: F5 (§7.5) needs max(roots[].fragmentCount)/sum(...) and
  // max(per-dbId fragment count) -- computed here, from data F1 already has in scope, rather
  // than F5 re-deriving them from a second pass.
  let maxRootFragmentCount = 0;
  let sumRootFragmentCount = 0;
  for (const root of rr.roots) {
    if (root.fragmentCount > maxRootFragmentCount) maxRootFragmentCount = root.fragmentCount;
    sumRootFragmentCount += root.fragmentCount;
  }
  const perDbIdCounts = new Map();
  for (const row of populationClasses) {
    if (row.cls !== 'L') continue;
    perDbIdCounts.set(row.ownerDbId, (perDbIdCounts.get(row.ownerDbId) || 0) + 1);
  }
  let maxPerDbIdFragmentCount = 0;
  for (const count of perDbIdCounts.values()) {
    if (count > maxPerDbIdFragmentCount) maxPerDbIdFragmentCount = count;
  }

  return {
    ok: true,
    fields: {
      ownerMismatchCount: rr.ownerMismatch.count,
      unreachableCount: rr.unreachable.count,
      populationCount: rr.population.count,
      rootsLength: rr.roots.length,
      rootsCompared,
      sizeMismatch,
      ownersMismatch,
      subtreeDigestMismatch,
      populationDigestEqual,
      maxRootFragmentCount,
      sumRootFragmentCount,
      maxPerDbIdFragmentCount,
    },
    first20Mismatches,
  };
}

/**
 * `scoreF1(fields)` -- plan §7.1's exact success/failure criteria, pure. Success:
 * `ownerMismatchCount === 0`, `unreachableCount === 0`, every compared root's size/owners/digest
 * match, and the population digest is equal. Any of those violated is `FAIL` -- never a silent
 * PASS for a missing/malformed field (fail-closed on `undefined`/non-zero-looking values too,
 * since a strict `> 0`/`!== true` comparison already treats `undefined` as failing).
 */
function scoreF1(fields) {
  const f = fields || {};
  const failed = f.ownerMismatchCount > 0 || f.unreachableCount > 0
    || f.sizeMismatch > 0 || f.ownersMismatch > 0 || f.subtreeDigestMismatch > 0
    || f.populationDigestEqual !== true;
  return { verdict: failed ? CHECK_VERDICT.FAIL : CHECK_VERDICT.PASS, reason: failed ? 'f1-mismatch-or-digest-disagreement' : null, fields: f };
}

// ------------------------------------------------------------------------------------------
// §7.2 F2 -- tree/fragment population and whole-model roots
// ------------------------------------------------------------------------------------------

/**
 * In-page. `observeF2(sessionId)` -- plan §7.2's corrected reconciliation (never a raw-count-
 * compare). MUST run after `observeF1` for the same session (reuses F1's already-computed
 * population classification and `roots.length` from `session.artifacts` -- "reuse, don't
 * recompute" -- never re-calls `extractAllFragments`/`resolveRoots` itself).
 *
 * Confirms `model.isObjectTreeCreated()`; walks the tree once via a bounded, non-recursive
 * stack walk starting at `tree.getRootId()` (mirrors T3's own `RECORD_WHOLE` walk style,
 * `clashtest-viewer-adapter.acceptance.mjs:494-513`, but from the tree's actual root rather
 * than per-declared-root, since F2 characterizes the WHOLE tree) to collect tree-reachable
 * fragment ids; reconciles against F1's L/N/U classes: every tree-reachable id must be in `L`
 * (a violation here is what actually breaks `accountingBalanced` -- not merely present N/U
 * classes, which are legitimately excluded); every `L` id not tree-reachable is bucketed as
 * `loadedButUnreachableCount` (a named, visible count, never a failure by itself).
 *
 * Returns a JSON-safe `{ok, fields}` (or `{ok:false, reason}` if F1 hasn't run for this session
 * yet). `fields` names every machine-readable field plan §7.2 lists.
 */
function observeF2(sessionId) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'session-not-found' };
  if (!session.artifacts || !Array.isArray(session.artifacts.f1PopulationClasses)) {
    return { ok: false, reason: 'f1-population-classes-not-available-run-observeF1-first' };
  }

  const { model } = session;
  const fragListCount = model.getFragmentList().getCount();
  const rootsLength = session.artifacts.f1RootsLength;

  let isObjectTreeCreated;
  try {
    isObjectTreeCreated = model.isObjectTreeCreated() === true;
  } catch {
    isObjectTreeCreated = false;
  }

  if (!isObjectTreeCreated) {
    return {
      ok: true,
      fields: {
        isObjectTreeCreated: false, treeReachableCount: 0,
        classL: 0, classN: 0, classU: 0, loadedButUnreachableCount: 0,
        fragListCount, rootsLength, accountingBalanced: false, maxChildrenPerNode: 0,
      },
    };
  }

  let tree;
  try {
    tree = model.getObjectTree();
  } catch {
    return {
      ok: true,
      fields: {
        isObjectTreeCreated: true, treeReachableCount: 0,
        classL: 0, classN: 0, classU: 0, loadedButUnreachableCount: 0,
        fragListCount, rootsLength, accountingBalanced: false, maxChildrenPerNode: 0,
      },
    };
  }

  const reachable = new Set();
  const seen = new Set();
  const stack = [tree.getRootId()];
  // Stage 5 addition: F5 (§7.5) needs max(children per node) -- tracked during this SAME tree
  // walk (never a second pass).
  let maxChildrenPerNode = 0;
  // Stage 7 addition (F8's own R2 relationship, §7.8): retains WHICH tree node (dbId)
  // enumerated each fragment -- F2's own walk previously only tracked membership (`reachable`),
  // discarding the owning node. Zero new Viewer API calls, zero change to F2's own existing
  // fields/behavior/traversal order (this repo's own frozen-artifact discipline: an additive
  // capture during the SAME existing walk, never a second pass, never a reordering -- matching
  // the precedent already set for maxChildrenPerNode above and F1's own f1PopulationRecords).
  // codex-advisor consult (Stage 7, before implementing F8): flagged that a fragment could in
  // principle be enumerated under more than one tree node during a single walk (the repository
  // does not establish that a real Viewer InstanceTree always assigns exactly one owner per
  // fragment) -- a plain `Map<fragId, dbId>` overwrite would silently lose that ambiguity. Fixed:
  // first-discovered-wins (in whatever order THIS walk already visits nodes -- order-independent
  // correctness, since a genuine multi-owner conflict is flagged regardless of which owner is
  // "first"), with any later disagreement recorded as `conflictingOwnerDbId` rather than
  // silently overwritten or silently dropped.
  const f2TreeOwnerByFragId = new Map();
  while (stack.length > 0) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    tree.enumNodeFragments(n, (f) => {
      reachable.add(f);
      const existing = f2TreeOwnerByFragId.get(f);
      if (!existing) {
        f2TreeOwnerByFragId.set(f, { ownerDbId: n, conflictingOwnerDbId: null });
      } else if (existing.ownerDbId !== n && existing.conflictingOwnerDbId === null) {
        existing.conflictingOwnerDbId = n;
      }
    }, false);
    let childCount = 0;
    tree.enumNodeChildren(n, (ch) => { childCount += 1; stack.push(ch); return false; }, false);
    if (childCount > maxChildrenPerNode) maxChildrenPerNode = childCount;
  }
  session.artifacts.f2TreeOwnerByFragId = f2TreeOwnerByFragId;

  const classLRows = session.artifacts.f1PopulationClasses.filter((row) => row.cls === 'L');
  const classN = session.artifacts.f1PopulationClasses.filter((row) => row.cls === 'N').length;
  const classU = session.artifacts.f1PopulationClasses.filter((row) => row.cls === 'U').length;
  const classLIds = new Set(classLRows.map((row) => row.fragId));

  let loadedButUnreachableCount = 0;
  for (const row of classLRows) {
    if (!reachable.has(row.fragId)) loadedButUnreachableCount += 1;
  }

  let unaccountedReachable = 0;
  for (const id of reachable) {
    if (!classLIds.has(id)) unaccountedReachable += 1;
  }

  const treeReachableCount = reachable.size;
  const sumBalanced = (treeReachableCount + classN + classU + loadedButUnreachableCount) === fragListCount;
  const accountingBalanced = unaccountedReachable === 0 && sumBalanced;

  return {
    ok: true,
    fields: {
      isObjectTreeCreated: true,
      treeReachableCount,
      classL: classLRows.length,
      classN,
      classU,
      loadedButUnreachableCount,
      fragListCount,
      rootsLength,
      accountingBalanced,
      maxChildrenPerNode,
    },
  };
}

/**
 * `scoreF2(fields)` -- plan §7.2's exact success/failure criteria, pure. Success: tree
 * accessible AND the reconciliation accounting balances. Failure: tree not accessible after
 * load-done, OR the accounting does not balance (a fragment id unaccounted for or double-
 * counted) -- never a raw size mismatch.
 */
function scoreF2(fields) {
  const f = fields || {};
  const failed = f.isObjectTreeCreated !== true || f.accountingBalanced !== true;
  const reason = !failed ? null : (f.isObjectTreeCreated !== true ? 'tree-not-accessible' : 'accounting-not-balanced');
  return { verdict: failed ? CHECK_VERDICT.FAIL : CHECK_VERDICT.PASS, reason, fields: f };
}

// ------------------------------------------------------------------------------------------
// §7.8 F8 -- dbId consistency across SVF2 data surfaces (read-only, built entirely from F1/F2's
// already-frozen data)
// ------------------------------------------------------------------------------------------

/**
 * In-page. `observeF8(sessionId, {f1Fields, f2Fields})` -- plan §7.8's corrected R1/R2/R3
 * relationships and all five coverage/exclusion equations, built ENTIRELY from F1/F2's already-
 * frozen data -- no new Viewer/Adapter calls beyond `model.getFragmentList().getDbIds(fragId)`
 * (R1's own required fresh read, explicitly named by the plan's evidence-source text) and one
 * `session.artifacts` read. `f1Fields`/`f2Fields` are F1/F2's own already-computed `.fields`
 * (the caller's own copies of their scalar outputs, e.g. `rootsLength`/`classL`/`classN`/
 * `classU`/`treeReachableCount`/`loadedButUnreachableCount`/`fragListCount`) -- an in-page
 * function may reference only its own argument and page globals (this file's own established
 * constraint), and F1/F2's scalar fields are never themselves persisted into `session.artifacts`
 * (only their `Map`-shaped retained data is), so the caller must copy them in explicitly. This
 * is exactly "F8 checks each [equation] from its own copied values, never by trusting F2's
 * `accountingBalanced` flag blindly" (plan line 1124) -- copied here, at the boundary, not
 * re-derived.
 *
 * **R1/R2 census domain (codex-advisor-confirmed, Stage 7 consult):** the deduplicated union of
 * every key across ALL of F1's own per-root `extractFragments` maps
 * (`session.artifacts.f1FragmentMapsByRoot`) -- the concrete realization of "the set of
 * fragments for which an F1 `extractFragments` call retained an ownership mapping, i.e.
 * `treeReachableCount`" (plan line 1107). `censusedFragmentCount` is this union's own size,
 * checked against `treeReachableReference` by equation 3 below -- never merely assumed equal;
 * a missing per-root map (a caught F1 extraction failure) legitimately shrinks the union and
 * correctly fails that equation, never silently passing.
 *
 * **R1** (fragment ownership): a FRESH `model.getFragmentList().getDbIds(fragId)` read compared
 * against F1's own already-recorded `ownerDbId` for that fragment (never `resolveRoots`'s
 * aggregate output, never F4/Stage-5's independent geometry-id re-verification -- a different
 * check, not conflated here per this stage's own brief).
 *
 * **R2** (tree agreement): `session.artifacts.f2TreeOwnerByFragId` (this stage's own additive
 * extension to `observeF2`, see its own comment there) compared against the SAME F1-recorded
 * `ownerDbId` -- a missing entry OR a recorded `conflictingOwnerDbId` both count as an R2
 * divergence (never silently resolved to "the first one wins").
 *
 * **R3** (root coverage): `censusedRootCount` (`f1FragmentMapsByRoot.size`) vs. `rootsLength`
 * (`f1Fields.rootsLength`).
 *
 * A loaded-but-unreachable class-L fragment is a NAMED EXCLUSION for both R1 and R2 (plan line
 * 1110) -- it is never discovered by any F1 root's `extractFragments` walk (by definition of
 * "unreachable"), so it never appears in the census domain above at all, never a false
 * divergence and never silently dropped (its count is already retained via the copied
 * `loadedButUnreachableReference` field and cross-checked by equation 2).
 *
 * Returns a JSON-safe `{ok, fields, firstDivergences}` (or `{ok:false, reason}` if F1/F2 haven't
 * run for this session yet, or `f1Fields`/`f2Fields` weren't supplied).
 */
// Fix wave (final whole-branch review, Important I1): single combined argument object, matching
// every other in-page function's own established convention (observeF1/observeF2/observeF4/
// observeF7 all take `sessionId` alone; F6's own multi-value in-page functions all take one
// combined object) -- Playwright's real `page.evaluate(fn, arg)` forwards exactly ONE
// serializable argument. `pageEvaluate(observeF8, sessionId, {f1Fields, f2Fields})` (three
// arguments to `pageEvaluate` itself) silently dropped the third argument against the REAL
// `buildRealPageDeps` wrapper (which only ever forwards `(fn, arg)`), making F8 always BLOCKED
// live -- caught only by the final whole-branch review, since the offline `stage8.test.mjs` fake
// ignored the extra argument instead of enforcing Playwright's real one-argument contract.
function observeF8({ sessionId, f1Fields, f2Fields } = {}) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'session-not-found' };
  if (!session.artifacts || !session.artifacts.f1FragmentMapsByRoot || session.artifacts.f1FragmentMapsByRoot.size === 0) {
    return { ok: false, reason: 'f1-fragment-maps-by-root-not-available-run-observeF1-first' };
  }
  if (!session.artifacts.f2TreeOwnerByFragId) {
    return { ok: false, reason: 'f2-tree-owner-by-frag-id-not-available-run-observeF2-first' };
  }
  if (!f1Fields || !f2Fields) {
    return { ok: false, reason: 'f1Fields-and-f2Fields-required' };
  }

  const { model } = session;
  const fragList = model.getFragmentList();
  const { f1FragmentMapsByRoot, f2TreeOwnerByFragId } = session.artifacts;
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), reason: e.reason ?? null }
    : { primitive: typeof e, value: String(e) });

  const censusFragIds = new Map(); // fragId -> F1's own recorded ownerDbId
  for (const [, fragMap] of f1FragmentMapsByRoot) {
    for (const [fragId, record] of fragMap) {
      if (!censusFragIds.has(fragId)) censusFragIds.set(fragId, record.ownerDbId);
    }
  }

  let ownershipDivergenceCount = 0;
  let treeDivergenceCount = 0;
  const divergentFragIds = new Set();
  const firstDivergences = [];

  for (const [fragId, f1OwnerDbId] of censusFragIds) {
    let freshOwnerDbId;
    let r1Diverged;
    try {
      freshOwnerDbId = fragList.getDbIds(fragId);
      r1Diverged = freshOwnerDbId !== f1OwnerDbId;
    } catch (e) {
      r1Diverged = true;
      freshOwnerDbId = { getDbIdsThrew: errOf(e) };
    }
    if (r1Diverged) {
      ownershipDivergenceCount += 1;
      divergentFragIds.add(fragId);
      if (firstDivergences.length < 20) firstDivergences.push({ relation: 'R1', fragId, f1OwnerDbId, freshOwnerDbId });
    }

    const treeOwnerEntry = f2TreeOwnerByFragId.get(fragId);
    const treeDbId = treeOwnerEntry ? treeOwnerEntry.ownerDbId : null;
    const treeConflict = treeOwnerEntry ? treeOwnerEntry.conflictingOwnerDbId : null;
    const r2Diverged = !treeOwnerEntry || treeDbId !== f1OwnerDbId || treeConflict !== null;
    if (r2Diverged) {
      treeDivergenceCount += 1;
      divergentFragIds.add(fragId);
      if (firstDivergences.length < 20) firstDivergences.push({ relation: 'R2', fragId, f1OwnerDbId, treeDbId, treeConflict });
    }
  }

  const censusedFragmentCount = censusFragIds.size;
  // Same iterated domain for both relationships (plan's own R1/R2 table: identical denominator,
  // treeReachableCount) -- never a second, separately-derived count.
  const treeCheckedFragmentCount = censusedFragmentCount;
  const censusedRootCount = f1FragmentMapsByRoot.size;

  const fragListCountReference = f2Fields.fragListCount;
  const classLReference = f2Fields.classL;
  const classNExcluded = f2Fields.classN;
  const classUExcluded = f2Fields.classU;
  const treeReachableReference = f2Fields.treeReachableCount;
  const loadedButUnreachableReference = f2Fields.loadedButUnreachableCount;
  const rootsLengthReference = f1Fields.rootsLength;

  const eq1 = (classLReference + classNExcluded + classUExcluded) === fragListCountReference;
  const eq2 = (treeReachableReference + loadedButUnreachableReference) === classLReference;
  const eq3 = censusedFragmentCount === treeReachableReference;
  const eq4 = treeCheckedFragmentCount === treeReachableReference;
  const eq5 = censusedRootCount === rootsLengthReference;
  const coverageEquationsClosed = eq1 && eq2 && eq3 && eq4 && eq5;

  return {
    ok: true,
    fields: {
      censusedRootCount,
      censusedFragmentCount,
      treeCheckedFragmentCount,
      ownershipDivergenceCount,
      treeDivergenceCount,
      divergenceCount: divergentFragIds.size,
      fragListCountReference,
      classLReference,
      classNExcluded,
      classUExcluded,
      treeReachableReference,
      loadedButUnreachableReference,
      rootsLengthReference,
      coverageEquationsClosed,
    },
    firstDivergences,
  };
}

/**
 * `scoreF8(fields)` -- plan §7.8's exact success/failure criteria, pure. `FAIL` iff any
 * divergence exists (R1 or R2, recorded with the exact dbId/fragment pair via
 * `firstDivergences`, never silently reconciled) OR `coverageEquationsClosed !== true` (a silent
 * population drop or double-count, distinct from a data-value divergence) -- both are named,
 * independent failure triggers per the plan's own flat Failure criteria.
 */
function scoreF8(fields) {
  const f = fields || {};
  const anyDivergence = f.ownershipDivergenceCount > 0 || f.treeDivergenceCount > 0;
  const failed = anyDivergence || f.coverageEquationsClosed !== true;
  const reason = !failed ? null : (anyDivergence ? 'f8-dbid-divergence' : 'f8-coverage-equations-not-closed');
  return { verdict: failed ? CHECK_VERDICT.FAIL : CHECK_VERDICT.PASS, reason, fields: f };
}

// ------------------------------------------------------------------------------------------
// §6.5/§6.3a -- `wrong-owner` (4c, right after F1) and `hidden-fragment` (5c, right after F2)
// ------------------------------------------------------------------------------------------

/**
 * `runWrongOwnerControl({modelBefore, world, registry, registryKey, checkF1, controlTimeoutMs})`
 * -- plan §6.5's `wrong-owner` row, run immediately after F1 (phase 4c), against the SAME
 * `modelBefore` instance F1 just used. Patches `modelBefore.fragList.getDbIds` so fragment 0
 * reports a bogus owner dbId, confirms `checkF1` (an injected stand-in for re-running F1's own
 * detection -- a later live-run stage implements it as `(m) => pageEvaluate(observeF1,
 * {sessionId}).then((r) => ({ownerMismatchDetected: r.fields.ownerMismatchCount > 0}))`)
 * reports the mismatch, restores in `finally`, verifies restoration via the same oracle as
 * `runTreeUnavailableControl` (member identity + `world.isModelLive`/`registry.bindingFor`
 * liveness). `restorationRequired` comes from Stage 1's `CONTROL_RESTORATION_REQUIRED['wrong-
 * owner']` via `createControlResult` (plan line 844: `true`, cross-checked, never hardcoded).
 */
async function runWrongOwnerControl({ modelBefore, world, registry, registryKey, checkF1, controlTimeoutMs = CHECK_TIMEOUT_MS }) {
  if (!modelBefore || !modelBefore.fragList || typeof checkF1 !== 'function') {
    return createControlResult('wrong-owner', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  const fragList = modelBefore.fragList;
  const hasOwnGetDbIds = Object.prototype.hasOwnProperty.call(fragList, 'getDbIds');
  const originalGetDbIds = fragList.getDbIds;

  let detected = null;
  let timedOut = false;
  let reason = null;

  try {
    fragList.getDbIds = (fragId) => (fragId === 0 ? -999999 : originalGetDbIds.call(fragList, fragId));
    const checkResult = await withControlTimeout(checkF1(modelBefore), controlTimeoutMs);
    detected = Boolean(checkResult && checkResult.ownerMismatchDetected === true);
    if (!detected) reason = 'not-detected';
  } catch (e) {
    if (e && e.controlTimeout) { timedOut = true; reason = 'perturbation-timeout'; }
    else { detected = false; reason = 'checkF1-threw'; }
  } finally {
    if (hasOwnGetDbIds) fragList.getDbIds = originalGetDbIds;
    else delete fragList.getDbIds;
  }

  if (timedOut) {
    return createControlResult('wrong-owner', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const membersRestored = fragList.getDbIds === originalGetDbIds;
  const worldLiveOk = !world || world.isModelLive(modelBefore) === true;
  const bindingOk = !registry || Boolean(registry.bindingFor(registryKey) && registry.bindingFor(registryKey).model === modelBefore);
  const restored = membersRestored && worldLiveOk && bindingOk;

  if (!detected) {
    return createControlResult('wrong-owner', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('wrong-owner', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: reason || 'restore-assertion-failed' });
  }
  return createControlResult('wrong-owner', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

/**
 * `runLateCompletionAfterTimeoutControl({f1SnapshotBefore, readCurrentF1})` -- plan §6.5's
 * `late-completion-after-timeout` row (4c, immediately after `wrong-owner`), Stage 8's own
 * implementation (no prior stage built a runner for this control; only
 * `CONTROL_RESTORATION_REQUIRED['late-completion-after-timeout'] = false`, Stage 1, existed
 * before now). Entirely Node-side and harness-local -- unlike every shared-state control, it
 * never touches `modelBefore`/`world`/`registry`/the page at all, exactly like
 * `invalid-geometry-consumer` (whose `f4SnapshotBefore`/`readCurrentF4` non-interference-oracle
 * pattern this control's own doc comments (this file, 4432) already named as its own precedent).
 *
 * Realizes plan §6.4a's per-operation-token quarantine directly against Stage 1's own
 * `createToken`/`transitionToken`/`TOKEN_STATE`/`isTokenLive` machinery, deterministically (no
 * real timer/clock dependency, so this is fast and non-flaky offline): mints a token for a
 * synthetic operation, transitions it `active -> timed-out` (the operation is *by construction*
 * held open past its own budget -- there is nothing to actually wait for; a real elapsed-time
 * measurement would only reproduce the same decision non-deterministically), THEN releases the
 * late completion by invoking its own continuation. The continuation begins
 * `if (!isTokenLive(token)) return` -- its first statement, exactly like every real in-page/
 * Node-side continuation this file's other operations already use (plan §6.4a) -- so releasing
 * it only after the timed-out transition is what actually exercises the drop path; releasing it
 * before would trivially "pass" without proving anything. `detected` requires the continuation
 * to have genuinely taken the drop branch (never the live branch, which would indicate the
 * quarantine failed to protect a live operation) AND `f1SnapshotBefore` (a deep copy of
 * `checks.F1`, captured by the CALLER before this control runs) to `jsonDeepEqual` whatever
 * `readCurrentF1()` (an injected callable, re-reading the current `checks.F1` AFTER the late
 * completion has been fully processed) returns -- proving the late arrival never leaked into any
 * shared result field. Only once both hold does the token move `timed-out -> disposed`
 * (confirmed terminal before reporting success), matching the control's own restoration
 * discipline despite `restorationRequired: false` (nothing to reverse; this is the non-
 * interference oracle per §6.3a, cross-checked via `createControlResult`, never hardcoded).
 * ANY failure (the continuation took the live branch instead of dropping, or `checks.F1` leaked)
 * is `RESTORE_FAILED`, per §6.3a's per-control table for this control.
 */
async function runLateCompletionAfterTimeoutControl({ f1SnapshotBefore, readCurrentF1 } = {}) {
  if (typeof readCurrentF1 !== 'function') {
    return createControlResult('late-completion-after-timeout', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  const token = createToken({ operation: 'late-completion-after-timeout-synthetic' });
  transitionToken(token, TOKEN_STATE.TIMED_OUT);

  // The continuation's own first statement is the quarantine check every real continuation in
  // this file uses (§6.4a) -- `isTokenLive(token)` is false immediately after the transition
  // above, so a correctly-behaving continuation can only take the drop branch here. Both
  // branches are still recorded (never assumed) so a hypothetical future regression in
  // isTokenLive/transitionToken itself would be caught, not silently passed.
  let continuationTookDropBranch = false;
  const continuation = () => {
    if (!isTokenLive(token)) { continuationTookDropBranch = true; return; }
  };
  continuation();
  const detected = continuationTookDropBranch;
  const reason = detected ? null : 'continuation-not-dropped';

  let f1After;
  let readCurrentF1Threw = false;
  try {
    f1After = readCurrentF1();
  } catch {
    readCurrentF1Threw = true;
  }
  const noLeak = !readCurrentF1Threw && jsonDeepEqual(f1SnapshotBefore, f1After);

  if (detected) transitionToken(token, TOKEN_STATE.DISPOSED);
  const restored = detected && noLeak && token.state === TOKEN_STATE.DISPOSED;

  if (!detected) {
    return createControlResult('late-completion-after-timeout', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('late-completion-after-timeout', {
      state: CONTROL_STATE.RESTORE_FAILED,
      executed: true,
      detected: true,
      restored: false,
      reason: !noLeak ? (readCurrentF1Threw ? 'readCurrentF1-threw' : 'f1-snapshot-leaked') : 'token-not-disposed',
    });
  }
  return createControlResult('late-completion-after-timeout', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

/**
 * `runHiddenFragmentControl({modelBefore, world, registry, registryKey, checkF2,
 * controlTimeoutMs})` -- plan §6.5's `hidden-fragment` row, run immediately after F2 (phase
 * 5c), against the SAME `modelBefore` instance F2 just used. Patches `modelBefore.tree.
 * enumNodeFragments` to drop exactly one fragment id (`1`) from whichever node reports it,
 * confirms `checkF2` (an injected stand-in for re-running F2's own reconciliation -- a later
 * live-run stage implements it as `(m) => pageEvaluate(observeF2, {sessionId}).then((r) =>
 * ({hiddenFragmentDetected: r.fields.loadedButUnreachableCount > 0}))`, per `observeF2`'s own
 * doc: hiding a fragment moves it from "reachable" to "loaded-but-unreachable", a visible,
 * named count -- NOT itself an `accountingBalanced` failure) reports the fragment as noticed,
 * restores in `finally`, same restoration discipline as `wrong-owner`.
 * `restorationRequired` comes from Stage 1's `CONTROL_RESTORATION_REQUIRED['hidden-fragment']`
 * (plan line 845: `true`).
 */
async function runHiddenFragmentControl({ modelBefore, world, registry, registryKey, checkF2, controlTimeoutMs = CHECK_TIMEOUT_MS }) {
  if (!modelBefore || !modelBefore.tree || typeof checkF2 !== 'function') {
    return createControlResult('hidden-fragment', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  const tree = modelBefore.tree;
  const hasOwnEnumNodeFragments = Object.prototype.hasOwnProperty.call(tree, 'enumNodeFragments');
  const originalEnumNodeFragments = tree.enumNodeFragments;

  let detected = null;
  let timedOut = false;
  let reason = null;

  try {
    tree.enumNodeFragments = function patchedEnumNodeFragments(node, callback, recursive) {
      return originalEnumNodeFragments.call(this, node, (fragId) => { if (fragId !== 1) callback(fragId); }, recursive);
    };
    const checkResult = await withControlTimeout(checkF2(modelBefore), controlTimeoutMs);
    detected = Boolean(checkResult && checkResult.hiddenFragmentDetected === true);
    if (!detected) reason = 'not-detected';
  } catch (e) {
    if (e && e.controlTimeout) { timedOut = true; reason = 'perturbation-timeout'; }
    else { detected = false; reason = 'checkF2-threw'; }
  } finally {
    if (hasOwnEnumNodeFragments) tree.enumNodeFragments = originalEnumNodeFragments;
    else delete tree.enumNodeFragments;
  }

  if (timedOut) {
    return createControlResult('hidden-fragment', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const membersRestored = tree.enumNodeFragments === originalEnumNodeFragments;
  const worldLiveOk = !world || world.isModelLive(modelBefore) === true;
  const bindingOk = !registry || Boolean(registry.bindingFor(registryKey) && registry.bindingFor(registryKey).model === modelBefore);
  const restored = membersRestored && worldLiveOk && bindingOk;

  if (!detected) {
    return createControlResult('hidden-fragment', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('hidden-fragment', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: reason || 'restore-assertion-failed' });
  }
  return createControlResult('hidden-fragment', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

// ============================================================================================
// Bounded completion pass, area 3, Task 12 -- shared in-page helpers extracted from Task 11's
// own three bridged control functions (below), used by ALL SIX bridged controls (Task 11's
// three, retrofitted onto these below, plus Task 12's own three). Task 11's reviewer (approved,
// no blocking findings) flagged that an ~11-line inner-timeout race closure (`raceInner`) and
// the post-restore liveness check (`worldLiveOk`/`bindingOk`) were duplicated VERBATIM across
// all three of Task 11's functions -- extracted here ONCE rather than adding three more copies
// for this task's own three controls. Both added to `IN_PAGE_FUNCTION_REGISTRY` (below) so they
// share the same bootstrap IIFE scope as every in-page function that calls them by free
// identifier, exactly like `recordControlPatch`/`observeF1`/`observeF2` already do for their own
// callers.
// ============================================================================================

/**
 * In-page. `raceWithInnerTimeout(promiseLike, ms)` -- Task 12 extraction of Task 11's own
 * `raceInner` closure (byte-for-byte identical logic, previously duplicated once per bridged
 * control function). Races `promiseLike` against an in-page `setTimeout(ms)`; on timeout,
 * rejects with an `Error` tagged `{innerControlTimeout: true}` -- the SAME tag every bridged
 * control's own `catch` block already checks for (`e && e.innerControlTimeout`) to distinguish a
 * legitimate in-page timeout (restoration still runs in `finally`) from every other rejection
 * shape. Never cancels `promiseLike` itself (JS promises are not cancellable) -- exactly the
 * same "the timer fires, the original work may still be running" property `runBridgedControl`'s
 * own OUTER timeout has, one layer up.
 */
function raceWithInnerTimeout(promiseLike, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`control timed out after ${ms}ms`);
      err.innerControlTimeout = true;
      reject(err);
    }, ms);
    Promise.resolve(promiseLike).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * In-page. `checkSessionLiveness(session, model)` -- Task 12 extraction of Task 11's own
 * duplicated `worldLiveOk`/`bindingOk` post-restore liveness check (byte-for-byte identical
 * logic, previously duplicated once per bridged control function's own `finally` block). Returns
 * `{worldLiveOk, bindingOk}` -- the SAME two booleans every bridged control ANDs together with
 * its own `membersRestored` to derive its final `restored` verdict. `session.world`/
 * `session.registry`/`session.K` are read from the SAME session object every bridged control
 * already has in scope (never re-derived) -- `model` is passed explicitly (never read off
 * `session.model`) because a control's own patch target is sometimes a nested member
 * (`model.fragList`/`model.tree`), not `session.model` itself, so the caller's own already-
 * resolved `model` reference is always used, matching each control's own pre-extraction inline
 * check exactly.
 */
function checkSessionLiveness(session, model) {
  const worldLiveOk = !session.world || session.world.isModelLive(model) === true;
  const bindingOk = !session.registry || Boolean(session.registry.bindingFor(session.K) && session.registry.bindingFor(session.K).model === model);
  return { worldLiveOk, bindingOk };
}

// ============================================================================================
// Bounded completion pass, area 3 -- Task 11: bridged tree-unavailable/wrong-owner/hidden-
// fragment controls, IN-PAGE half. Ports `runTreeUnavailableControl`/`runWrongOwnerControl`/
// `runHiddenFragmentControl` (above -- unmodified, still the de facto behavioral spec: same
// perturbation, same detection field, same restoration/liveness oracle) across the realm
// boundary using Task 10's shared foundation (`acquireControlLease`/`releaseControlLease`/
// `recordControlPatch`, `createControlScratchSession`/`disposeControlScratchSession`). See
// `.superpowers/sdd/g1-f1-f8-harness/briefs/task-11-brief.md` for the full design.
//
// Task 12 retrofit: the inner-timeout race and post-restore liveness check below now call the
// shared `raceWithInnerTimeout`/`checkSessionLiveness` helpers (just above) instead of each
// function's own previously-local `raceInner` closure / inline `worldLiveOk`/`bindingOk` --
// pure dedup, no behavioral change (see this task's own report for the retrofit verification).
//
// Lease-lost-mid-flight discipline (Task 10 review's own new hard requirement, adopted for this
// task and Task 12): an OUTER Node-side watchdog timeout only stops NODE from waiting on
// `pageEvaluate` -- it does NOT cancel this in-page continuation. After the ONE `await` each of
// these three functions has (the raced detection call), and BEFORE doing anything else
// (restoring a patch, deriving `detected` from the check result, releasing the lease, disposing
// the scratch session), each function re-checks `session.activeControl && session.activeControl.
// controlId === controlId` via a small `stillMine()` closure. If that is no longer true (Phase
// 11's own `restoreAllControlPatches` fallback already ran, or is running concurrently on this
// same single-threaded page realm), this continuation abandons: it never restores anything
// itself, never releases a lease it no longer holds, and returns `{ok: true, detected: false,
// restored: false, timedOut: false, reason: 'lease-lost-mid-flight'}`. That shape is a
// DELIBERATE choice, not the brief's own literal `detected: null, restored: null` suggestion --
// `runBridgedControl` (Task 10, unmodified) strictly requires `detected`/`restored`/`timedOut`
// to be REAL booleans before ever calling `mapControlAttemptOutcome`; a `null` value would be
// rejected by that check as `'malformed-in-page-result'` (still PASS-blocking, but bypassing
// `mapControlAttemptOutcome` entirely, which the brief explicitly asks this task to confirm
// through). Real `false` values pass that check and flow into `mapControlAttemptOutcome`
// (`!detected` -> `NOT_DETECTED`), producing a well-formed, schema-valid, PASS-blocking
// `ControlResult` whose `reason` still names the real cause -- confirmed by direct read of both
// `runBridgedControl` and `mapControlAttemptOutcome`, not guessed.
//
// Own-`finally` restore-failure discipline (this task's own design decision, beyond what the
// brief states explicitly): if this control's OWN restoration attempt (patch-descriptor
// restore + `world.isModelLive`/`registry.bindingFor` liveness check) does NOT fully succeed,
// the lease is deliberately left HELD (never released) so Phase 11's `restoreAllControlPatches`
// fallback still sees `session.activeControl` and gets a real chance to retry/flag it via its
// own `cleanupFailures`/`cleanupUnresolvedOwnership` machinery -- releasing the lease on a
// failed restore would silently hide a genuinely broken page/model from that fallback and from
// `cleanupUnresolvedOwnership` entirely. The lease is released ONLY on a fully-verified restore.
// ============================================================================================

/**
 * In-page. `treeUnavailableControlInPage({sessionId, tokenId, gen, controlId, innerTimeoutMs})`
 * -- bridged port of `runTreeUnavailableControl` (above), Phase 3c. No scratch session (per the
 * brief: this control never touches `session.artifacts`, so nothing needs isolating -- see the
 * non-interference test for this control, which proves exactly that).
 *
 * Patches `session.model.isObjectTreeCreated`/`getObjectTree` (two independent patches, both
 * recorded via `recordControlPatch` so Task 10's Phase 11 fallback can restore either one
 * independently if this control's own `finally` never runs). Detection oracle: a small, LOCAL
 * readiness-check kernel (`checkReadinessKernel`, this function's own nested closure -- per the
 * brief, deliberately NOT `clashtest/viewer/readiness.js`'s own `awaitObjectTree`, which needs a
 * cancellation `ctx` this harness's F3 doesn't have) -- mirrors the same "fast path else
 * `getObjectTree(onSuccess, onError)`" shape used in `collision/CollisionWorld.js`/
 * `clashtest/viewer/readiness.js`.
 *
 * Non-interference proof (this control's own required oracle, since it has no scratch session):
 * `checks.F3` (Node-side, computed by `runHarness` strictly BEFORE Phase 3c ever runs) has no
 * page-owned counterpart in `session.artifacts` at all -- F3's own timeline/result never crosses
 * into `window.__g1` in the first place, so the only way this control could possibly corrupt
 * F3's retained result is if it touched `session.artifacts` (it does not -- confirmed by direct
 * read of this function's own body, which references only `session.model`/`session.world`/
 * `session.registry`/`session.K`) or `session` identity itself (it does not replace `session`,
 * only two `model` members). Proven at the in-page-function level (this file's own dedicated
 * test file, Task 11): `session.artifacts` is snapshotted before/after and asserted unchanged.
 */
async function treeUnavailableControlInPage(arg) {
  const { sessionId, tokenId, gen, controlId, innerTimeoutMs } = arg || {};
  const acquire = acquireControlLease({ sessionId, tokenId, gen, controlId });
  if (!acquire.ok) return { ok: false, reason: acquire.reason };

  const g = window.__g1;
  const session = g.sessions[sessionId];
  const stillMine = () => Boolean(session.activeControl) && session.activeControl.controlId === controlId;

  const model = session.model;
  const isObjectTreeCreatedDescriptor = Object.getOwnPropertyDescriptor(model, 'isObjectTreeCreated') || null;
  const getObjectTreeDescriptor = Object.getOwnPropertyDescriptor(model, 'getObjectTree') || null;
  const originalIsObjectTreeCreated = model.isObjectTreeCreated;
  const originalGetObjectTree = model.getObjectTree;

  function checkReadinessKernel(m) {
    return new Promise((resolve) => {
      try {
        if (typeof m.isObjectTreeCreated === 'function' && m.isObjectTreeCreated() === true) {
          resolve({ ready: true });
          return;
        }
      } catch {
        resolve({ ready: false });
        return;
      }
      try {
        let settled = false;
        m.getObjectTree(
          () => { if (!settled) { settled = true; resolve({ ready: true }); } },
          () => { if (!settled) { settled = true; resolve({ ready: false }); } },
        );
      } catch {
        resolve({ ready: false });
      }
    });
  }

  let detected = null;
  let timedOut = false;
  let reason = null;
  let restored = null;
  let leaseLost = false;

  try {
    model.isObjectTreeCreated = () => false;
    recordControlPatch(session, { target: model, property: 'isObjectTreeCreated', originalDescriptor: isObjectTreeCreatedDescriptor });
    model.getObjectTree = (onSuccess, onError) => { if (onError) onError(new Error('tree-unavailable control: simulated failure')); };
    recordControlPatch(session, { target: model, property: 'getObjectTree', originalDescriptor: getObjectTreeDescriptor });

    try {
      const gateResult = await raceWithInnerTimeout(checkReadinessKernel(model), innerTimeoutMs);
      if (!stillMine()) { leaseLost = true; } else {
        detected = Boolean(gateResult && gateResult.ready === false);
        if (!detected) reason = 'not-detected';
      }
    } catch (e) {
      if (!stillMine()) { leaseLost = true; } else if (e && e.innerControlTimeout) {
        timedOut = true;
        reason = 'perturbation-timeout';
      } else {
        detected = false;
        reason = 'checkReadiness-threw';
      }
    }
  } finally {
    if (stillMine()) {
      let membersRestored = false;
      try {
        if (getObjectTreeDescriptor) Object.defineProperty(model, 'getObjectTree', getObjectTreeDescriptor);
        else delete model.getObjectTree;
        if (isObjectTreeCreatedDescriptor) Object.defineProperty(model, 'isObjectTreeCreated', isObjectTreeCreatedDescriptor);
        else delete model.isObjectTreeCreated;
        membersRestored = model.isObjectTreeCreated === originalIsObjectTreeCreated && model.getObjectTree === originalGetObjectTree;
      } catch {
        membersRestored = false;
      }
      const { worldLiveOk, bindingOk } = checkSessionLiveness(session, model);
      restored = membersRestored && worldLiveOk && bindingOk;
      if (restored) releaseControlLease({ sessionId, controlId });
    }
  }

  if (leaseLost) return { ok: true, detected: false, restored: false, timedOut: false, reason: 'lease-lost-mid-flight' };
  if (timedOut) return { ok: true, detected: false, restored: false, timedOut: true, reason };
  if (!detected) return { ok: true, detected: false, restored: Boolean(restored), timedOut: false, reason };
  if (!restored) return { ok: true, detected: true, restored: false, timedOut: false, reason: reason || 'restore-assertion-failed' };
  return { ok: true, detected: true, restored: true, timedOut: false, reason: null };
}

/**
 * In-page. `wrongOwnerControlInPage({sessionId, tokenId, gen, controlId, innerTimeoutMs})` --
 * bridged port of `runWrongOwnerControl` (above), Phase 4c. Scratch session with NO
 * `copyArtifactKeys` (`observeF1` is the first writer of `session.artifacts` and has no
 * precondition beyond a valid session -- confirmed by direct read: `observeF1`'s only guard is
 * `if (!session) return {ok:false, reason:'session-not-found'}`). Patches
 * `session.model.fragList.getDbIds`. Detection: `r.fields.ownerMismatchCount > 0` (confirmed
 * against `observeF1`'s current real `fields` shape, this file, `ownerMismatchCount:
 * rr.ownerMismatch.count` -- matches the brief's own transcription exactly).
 *
 * codex-review (code, high effort, this task's own pre-commit review pass) Critical #1, fixed:
 * `createControlScratchSession`'s generic mechanism (Task 10, unchanged) only seeds
 * `artifacts` with the keys named in `copyArtifactKeys` -- an empty array (as above) yields a
 * genuinely EMPTY `artifacts` object, `{}`. `observeF1` (this file, its own per-root loop)
 * unconditionally calls `session.artifacts.f1FragmentMapsByRoot.set(root.dbId, lib)` for every
 * root `resolveRoots` returns -- on any real model with at least one root, this threw
 * `TypeError: Cannot read properties of undefined (reading 'set')`, caught by this function's
 * own try/catch and misreported as `NOT_DETECTED` (`reason: 'observeF1-threw'`) rather than a
 * genuine detection outcome -- reproduced directly by the review with a one-root fixture; this
 * task's own original fixture used `roots: []`, which never entered the loop and hid the bug.
 * `f1FragmentMapsByRoot` is purely a WRITE-target for `observeF1` (confirmed by direct re-read:
 * nothing in `observeF1` ever READS it as an input), so it needs no copied data from the real
 * session -- a fresh, empty `Map` seeded directly onto the scratch session's own `artifacts`
 * (below) is both correct and the smallest fix, matching exactly what
 * `setupSharedSessionResources` itself seeds for a brand-new real session.
 *
 * Task 13 (bounded completion pass, area 3 final integration) codex-review fix, High: this
 * function used to read `model.fragList[property]`/`Object.getOwnPropertyDescriptor(fragList,
 * property)` UNGUARDED, before entering the `try`/`finally` that owns lease release and scratch-
 * session disposal -- a model exposing only `getFragmentList()` (no bare `.fragList` own
 * property, the SAME production-realistic shape `capacityBreachControlInPage`'s own doc comment
 * already documents and guards against, Task 12) threw a `TypeError` OUTSIDE any cleanup path,
 * leaking the just-acquired lease (so every later control in the same run permanently fails with
 * `lease-already-held`) and the just-created scratch session -- reproduced directly by codex-
 * review's own accessor-only-model fixture. Fixed identically to `capacityBreachControlInPage`'s
 * own already-approved fix: validate BEFORE touching the descriptor, and on failure, dispose the
 * scratch session and release the lease before returning `ok:false`.
 *
 * Task 14 fix wave (H1, REQUIRED, final bounded-pass review): the original Stage 4-6 Node-side
 * `runWrongOwnerControl` (below, unmodified, still historical/dead reference code per L1) patches
 * a bare `model.fragList` property. This function used to do the same. The final reviewer
 * verified against the actual pinned Viewer 7.124.2 bundle (SHA-256-confirmed identical to
 * `EXPECTED_VIEWER_SHA256`) that no real Model class exposes `.fragList` as an own or prototype
 * property at all -- fragments live in a private field only reachable via `getFragmentList()`.
 * Against a real model, the bare-property read above was always `undefined`, so this control's
 * own guard (below) always returned `NOT_EXECUTABLE`, making PASS structurally unreachable on any
 * live run. This is a deliberate, VERIFIED deviation from the original Node-side function's own
 * pattern, not an inconsistency: `fragList` is now resolved via `model.getFragmentList()` --
 * `RenderModel`'s real accessor, confirmed to return the SAME stored object on every call (a
 * simple field accessor, not a constructor), so the existing descriptor-capture/restore/identity-
 * check logic below is unaffected -- it still patches a METHOD (`getDbIds`) on the object
 * `getFragmentList()` returns, never the property holding the reference to it. The original
 * Node-side `runWrongOwnerControl` is intentionally left unchanged (L1, not this fix wave's scope).
 */
async function wrongOwnerControlInPage(arg) {
  const { sessionId, tokenId, gen, controlId, innerTimeoutMs } = arg || {};
  const acquire = acquireControlLease({ sessionId, tokenId, gen, controlId });
  if (!acquire.ok) return { ok: false, reason: acquire.reason };

  const g = window.__g1;
  const session = g.sessions[sessionId];
  const stillMine = () => Boolean(session.activeControl) && session.activeControl.controlId === controlId;

  const scratch = createControlScratchSession(sessionId, { controlId, copyArtifactKeys: [] });
  if (!scratch.ok) {
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: `scratch-session-failed:${scratch.reason}` };
  }
  const scratchSessionId = scratch.scratchSessionId;
  // codex-review Critical #1 (see doc comment above): observeF1 needs this Map to already exist
  // as an own artifact, purely as a write-target -- never copied from the real session.
  g.sessions[scratchSessionId].artifacts.f1FragmentMapsByRoot = new Map();

  const model = session.model;
  // Task 14 fix wave (H1, see this function's own doc comment above): resolved via
  // getFragmentList() -- a real Viewer 7.124.2 Model has no bare `.fragList` own property.
  // Wrapped in try/catch, mirroring invalidBoundsControlInPage's own tree-resolution pattern --
  // never let a hostile accessor throw outside the guard below.
  let fragList;
  try {
    fragList = typeof model.getFragmentList === 'function' ? model.getFragmentList() : null;
  } catch { fragList = null; }
  const property = 'getDbIds';
  // Task 13 codex-review fix (see doc comment above): validate BEFORE touching the descriptor --
  // never let an absent/malformed fragList throw outside the try/finally that owns cleanup.
  if (!fragList || typeof fragList[property] !== 'function') {
    disposeControlScratchSession(scratchSessionId);
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: 'no-fragList-getDbIds' };
  }
  const originalDescriptor = Object.getOwnPropertyDescriptor(fragList, property) || null;
  const originalGetDbIds = fragList[property];

  let detected = null;
  let timedOut = false;
  let reason = null;
  let restored = null;
  let leaseLost = false;

  try {
    fragList[property] = (fragId) => (fragId === 0 ? -999999 : originalGetDbIds.call(fragList, fragId));
    recordControlPatch(session, { target: fragList, property, originalDescriptor });

    try {
      const r = await raceWithInnerTimeout(observeF1(scratchSessionId), innerTimeoutMs);
      if (!stillMine()) { leaseLost = true; } else {
        detected = Boolean(r && r.ok === true && r.fields && r.fields.ownerMismatchCount > 0);
        if (!detected) reason = 'not-detected';
      }
    } catch (e) {
      if (!stillMine()) { leaseLost = true; } else if (e && e.innerControlTimeout) {
        timedOut = true;
        reason = 'perturbation-timeout';
      } else {
        detected = false;
        reason = 'observeF1-threw';
      }
    }
  } finally {
    if (stillMine()) {
      let membersRestored = false;
      try {
        if (originalDescriptor) Object.defineProperty(fragList, property, originalDescriptor);
        else delete fragList[property];
        membersRestored = fragList[property] === originalGetDbIds;
      } catch {
        membersRestored = false;
      }
      const { worldLiveOk, bindingOk } = checkSessionLiveness(session, model);
      restored = membersRestored && worldLiveOk && bindingOk;
      if (restored) releaseControlLease({ sessionId, controlId });
      // codex-review (code, high effort, this task's own pre-commit review pass) Important #2,
      // fixed: disposal must be gated on `stillMine()` too, exactly like restore/release --
      // moved inside this block (was previously unconditional). An abandoned (lease-lost)
      // continuation must never delete ANYTHING keyed by this control's own deterministic
      // scratch-session id, since it can no longer prove it still owns that key (per the hard
      // requirement's own "touch nothing you don't provably still own" discipline, extended here
      // from patch-restore/lease-release to scratch-session disposal). This is a real, if
      // currently unreachable-in-practice, gap given `runHarness` never retries a control -- see
      // this function's own report for the disclosed residual (an abandoned scratch session is
      // then never disposed by anyone, since Phase 11's own `restoreAllControlPatches` has no
      // scratch-session-awareness either -- a pre-existing gap Task 10's own report already
      // flagged as "explicitly undecided," not newly introduced here).
      disposeControlScratchSession(scratchSessionId);
    }
  }

  if (leaseLost) return { ok: true, detected: false, restored: false, timedOut: false, reason: 'lease-lost-mid-flight' };
  if (timedOut) return { ok: true, detected: false, restored: false, timedOut: true, reason };
  if (!detected) return { ok: true, detected: false, restored: Boolean(restored), timedOut: false, reason };
  if (!restored) return { ok: true, detected: true, restored: false, timedOut: false, reason: reason || 'restore-assertion-failed' };
  return { ok: true, detected: true, restored: true, timedOut: false, reason: null };
}

/**
 * In-page. `hiddenFragmentControlInPage({sessionId, tokenId, gen, controlId, innerTimeoutMs})`
 * -- bridged port of `runHiddenFragmentControl` (above), Phase 5c. Scratch session WITH
 * `copyArtifactKeys: ['f1PopulationClasses', 'f1RootsLength']` -- `observeF2` has a hard
 * precondition on `session.artifacts.f1PopulationClasses` being an array (confirmed by direct
 * read: `if (!session.artifacts || !Array.isArray(session.artifacts.f1PopulationClasses))
 * return {ok:false, reason:'f1-population-classes-not-available-run-observeF1-first'}`) and also
 * reads `session.artifacts.f1RootsLength` for its own `rootsLength` output field (not a hard
 * precondition check, but still required for a correct, non-`undefined` result) -- both copied
 * from the REAL session's own already-computed F1 result, a read-only baseline snapshot; this
 * confirms the brief's own transcription of the exact and complete key set. Patches
 * `session.model.tree.enumNodeFragments`. Detection: `r.fields.loadedButUnreachableCount > 0`
 * (confirmed against `observeF2`'s current real `fields` shape, this file).
 *
 * Task 13 (bounded completion pass, area 3 final integration) codex-review fix, High: same class
 * of bug as `wrongOwnerControlInPage`'s own fix above -- `model.tree[property]`/
 * `Object.getOwnPropertyDescriptor(tree, property)` used to be read UNGUARDED, before the
 * `try`/`finally` that owns lease release and scratch-session disposal, so a model exposing only
 * `getObjectTree()` (no bare `.tree` own property) threw a `TypeError` outside any cleanup path
 * and leaked both. Fixed identically: validate BEFORE touching the descriptor.
 *
 * Task 14 fix wave (H1, REQUIRED, final bounded-pass review): the original Stage 4-6 Node-side
 * `runHiddenFragmentControl` (below, unmodified, still historical/dead reference code per L1)
 * patches a bare `model.tree` property. This function used to do the same. The final reviewer
 * verified against the actual pinned Viewer 7.124.2 bundle (SHA-256-confirmed identical to
 * `EXPECTED_VIEWER_SHA256`) that no real Model class defines a `.tree` property at all. Against a
 * real model, the bare-property read above was always `undefined`, so this control's own guard
 * (below) always returned `NOT_EXECUTABLE`, making PASS structurally unreachable on any live run.
 * This is a deliberate, VERIFIED deviation from the original Node-side function's own pattern, not
 * an inconsistency: `tree` is now resolved through the SAME `getObjectTree()`/`getInstanceTree()`
 * fallback sequence `invalidBoundsControlInPage` (below) already uses -- the still-correct patch
 * target (`enumNodeFragments`, confirmed against the original Node-side `runHiddenFragmentControl`)
 * is unaffected; only how the tree object itself is obtained changed. The original Node-side
 * `runHiddenFragmentControl` is intentionally left unchanged (L1, not this fix wave's scope).
 */
async function hiddenFragmentControlInPage(arg) {
  const { sessionId, tokenId, gen, controlId, innerTimeoutMs } = arg || {};
  const acquire = acquireControlLease({ sessionId, tokenId, gen, controlId });
  if (!acquire.ok) return { ok: false, reason: acquire.reason };

  const g = window.__g1;
  const session = g.sessions[sessionId];
  const stillMine = () => Boolean(session.activeControl) && session.activeControl.controlId === controlId;

  const scratch = createControlScratchSession(sessionId, { controlId, copyArtifactKeys: ['f1PopulationClasses', 'f1RootsLength'] });
  if (!scratch.ok) {
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: `scratch-session-failed:${scratch.reason}` };
  }
  const scratchSessionId = scratch.scratchSessionId;

  const model = session.model;
  // Task 14 fix wave (H1, see this function's own doc comment above): resolved via
  // getObjectTree()/getInstanceTree() fallback, mirroring invalidBoundsControlInPage's own
  // already-correct pattern exactly -- a real Viewer 7.124.2 Model has no bare `.tree` own
  // property.
  let tree;
  try {
    tree = typeof model.getObjectTree === 'function' ? model.getObjectTree() : null;
    if (!tree || typeof tree.enumNodeFragments !== 'function') tree = typeof model.getInstanceTree === 'function' ? model.getInstanceTree() : null;
  } catch { tree = null; }
  const property = 'enumNodeFragments';
  // Task 13 codex-review fix (see doc comment above): validate BEFORE touching the descriptor --
  // never let an absent/malformed tree throw outside the try/finally that owns cleanup.
  if (!tree || typeof tree[property] !== 'function') {
    disposeControlScratchSession(scratchSessionId);
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: 'no-tree-enumNodeFragments' };
  }
  const originalDescriptor = Object.getOwnPropertyDescriptor(tree, property) || null;
  const originalEnumNodeFragments = tree[property];

  let detected = null;
  let timedOut = false;
  let reason = null;
  let restored = null;
  let leaseLost = false;

  try {
    tree[property] = function patchedEnumNodeFragments(node, callback, recursive) {
      return originalEnumNodeFragments.call(this, node, (fragId) => { if (fragId !== 1) callback(fragId); }, recursive);
    };
    recordControlPatch(session, { target: tree, property, originalDescriptor });

    try {
      const r = await raceWithInnerTimeout(observeF2(scratchSessionId), innerTimeoutMs);
      if (!stillMine()) { leaseLost = true; } else {
        detected = Boolean(r && r.ok === true && r.fields && r.fields.loadedButUnreachableCount > 0);
        if (!detected) reason = 'not-detected';
      }
    } catch (e) {
      if (!stillMine()) { leaseLost = true; } else if (e && e.innerControlTimeout) {
        timedOut = true;
        reason = 'perturbation-timeout';
      } else {
        detected = false;
        reason = 'observeF2-threw';
      }
    }
  } finally {
    if (stillMine()) {
      let membersRestored = false;
      try {
        if (originalDescriptor) Object.defineProperty(tree, property, originalDescriptor);
        else delete tree[property];
        membersRestored = tree[property] === originalEnumNodeFragments;
      } catch {
        membersRestored = false;
      }
      const { worldLiveOk, bindingOk } = checkSessionLiveness(session, model);
      restored = membersRestored && worldLiveOk && bindingOk;
      if (restored) releaseControlLease({ sessionId, controlId });
      // codex-review Important #2 (see wrongOwnerControlInPage's own doc comment above for the
      // full reasoning): disposal gated on `stillMine()`, moved inside this block.
      disposeControlScratchSession(scratchSessionId);
    }
  }

  if (leaseLost) return { ok: true, detected: false, restored: false, timedOut: false, reason: 'lease-lost-mid-flight' };
  if (timedOut) return { ok: true, detected: false, restored: false, timedOut: true, reason };
  if (!detected) return { ok: true, detected: false, restored: Boolean(restored), timedOut: false, reason };
  if (!restored) return { ok: true, detected: true, restored: false, timedOut: false, reason: reason || 'restore-assertion-failed' };
  return { ok: true, detected: true, restored: true, timedOut: false, reason: null };
}

// ============================================================================================
// Bounded completion pass, area 3 -- Task 12: bridged capacity-breach/invalid-bounds/bounds-
// beyond-tolerance controls, IN-PAGE half. Ports `runCapacityBreachControl`/
// `runInvalidBoundsControl`/`runBoundsBeyondToleranceControl` (below -- unmodified, still the de
// facto behavioral spec) across the realm boundary using Task 10's shared foundation, mirroring
// Task 11's own three functions (above) pattern-for-pattern -- including the lease-lost-mid-
// flight discipline (re-check `stillMine()` immediately after the one `await`, before doing
// anything else) and the two shared helpers extracted just above Task 11's own functions
// (`raceWithInnerTimeout`/`checkSessionLiveness`), used here from the start. See
// `.superpowers/sdd/g1-f1-f8-harness/briefs/task-12-brief.md` for the full design.
// ============================================================================================

/**
 * In-page. `capacityBreachControlInPage({sessionId, tokenId, gen, controlId, innerTimeoutMs,
 * capacityLimit})` -- bridged port of `runCapacityBreachControl` (below), Phase 7c. Scratch
 * session with NO `copyArtifactKeys` -- structurally identical to `wrongOwnerControlInPage`'s
 * own usage: `observeF1` is the first writer of `session.artifacts` and has no precondition
 * beyond a valid session. Patches `session.model.fragList.getCount` to report a count over
 * `capacityLimit`, the same perturbation `runCapacityBreachControl` (below) uses. Detection:
 * re-run F1's own detection via `observeF1(scratchSessionId)`, expecting a
 * `CapacityExceededError` -- confirmed by direct source read of `observeF1`'s own `resolveRoots`
 * error handling (above): caught and returned as `{ok: false, error: {name:
 * 'CapacityExceededError', ...}, reason: 'resolveRoots-threw'}`, NEVER thrown out of `observeF1`
 * itself. `detected = Boolean(!r.ok && r.error && r.error.name === 'CapacityExceededError')`
 * (mirroring `runCapacityBreachControl`'s own doc comment).
 *
 * `capacityLimit` is a plain, JSON-safe number, passed in by `buildCapacityBreachControlDep`
 * (below), sourced from the REAL, imported `maxCollisionInstancesPerEpoch` Node-side constant --
 * codex-review (code, high effort, this task's own pre-commit review pass) Medium finding: an
 * earlier version of this function inlined a hardcoded `20_000` duplicate (the SAME
 * Node-side-constant-cannot-cross-the-realm-as-a-free-variable constraint `observeF7`'s own
 * `TOLERANCE_CONSTANTS` duplicate works around) -- since `maxCollisionInstancesPerEpoch` is
 * explicitly documented as PROVISIONAL (`collision/constants.js`'s own comment: "value not yet
 * chosen"), a hardcoded duplicate would silently drift out of sync with the real constant if it
 * is ever changed, and this control would then breach the WRONG threshold. Passing it as a
 * command-payload argument (a single plain number, no realm-crossing issue at all -- unlike
 * `TOLERANCE_CONSTANTS`, which is a whole object of derived math constants `observeF7` itself
 * needs to CONSTRUCT in-page from raw inputs, this is just one already-known Node-side number)
 * removes the manual-lockstep residual entirely.
 *
 * codex-review Critical finding, fixed: an earlier version of this function read
 * `model.fragList` UNGUARDED, immediately after scratch-session creation and BEFORE the
 * try/finally that owns cleanup -- against a model shape exposing only `getFragmentList()` (no
 * bare `.fragList` own property), `Object.getOwnPropertyDescriptor(undefined, 'getCount')`
 * throws `TypeError` OUTSIDE the try/finally entirely, leaking the just-acquired lease
 * (`session.activeControl` left set, zero recorded patches -- Phase 11's own fallback restore
 * has nothing to restore, so it can never clear it) and the just-created scratch session
 * (never disposed). Fixed by validating `fragList`/`fragList.getCount` BEFORE touching its
 * descriptor, mirroring `invalidBoundsControlInPage`'s/`boundsBeyondToleranceControlInPage`'s
 * own already-established tree-resolution-failure guard exactly (dispose scratch, release
 * lease, return `{ok:false, reason}` -- never leak). This does NOT resolve the separate,
 * already-disclosed `model.fragList` vs `model.getFragmentList()` accessor-fidelity question
 * (Task 11's own review flagged the identical concern for `wrongOwnerControlInPage`'s
 * `model.fragList.getDbIds`/`hiddenFragmentControlInPage`'s `model.tree.enumNodeFragments`,
 * explicitly deferred to Task 13 as outside any single bounded task's own authorization to
 * redesign the original Stage 4-6 perturbation target) -- it only ensures this control fails
 * safely (NOT_EXECUTABLE, no leak) rather than leaking a lease when that pre-existing fidelity
 * gap manifests as a genuinely absent `model.fragList`.
 *
 * codex-review-shaped fix applied FROM THE START (Task 11's own review found this exact gap in
 * `wrongOwnerControlInPage` and fixed it after the fact -- applied here proactively rather than
 * re-discovered): `observeF1`'s per-root loop unconditionally calls
 * `session.artifacts.f1FragmentMapsByRoot.set(...)` for every root `resolveRoots` returns on the
 * NOT-DETECTED path (the perturbation fails to actually breach capacity) -- so the scratch
 * session's own `f1FragmentMapsByRoot` Map must be seeded as an empty, fresh write-target BEFORE
 * calling `observeF1`, never left absent.
 *
 * Task 14 fix wave (H1, REQUIRED, final bounded-pass review): the original Stage 4-6 Node-side
 * `runCapacityBreachControl` (below, unmodified, still historical/dead reference code per L1)
 * patches a bare `model.fragList` property. This function used to do the same -- the exact same
 * "already-disclosed accessor-fidelity question" this doc comment's own earlier paragraphs
 * (above) referred to as deferred. The final reviewer verified against the actual pinned Viewer
 * 7.124.2 bundle (SHA-256-confirmed identical to `EXPECTED_VIEWER_SHA256`) that no real Model
 * class exposes `.fragList` as an own or prototype property at all. Against a real model, the
 * bare-property read above was always `undefined`, so this control's own guard (below) always
 * returned `NOT_EXECUTABLE`, making PASS structurally unreachable on any live run. This is a
 * deliberate, VERIFIED deviation from the original Node-side function's own pattern, not an
 * inconsistency: `fragList` is now resolved via `model.getFragmentList()`, identically to
 * `wrongOwnerControlInPage`'s own Task 14 fix (same accessor, same stability guarantee, same
 * unaffected descriptor-capture/restore logic below -- only `getCount` is patched, a method on
 * the returned object, never the property holding the reference to it). The original Node-side
 * `runCapacityBreachControl` is intentionally left unchanged (L1, not this fix wave's scope).
 */
async function capacityBreachControlInPage(arg) {
  const { sessionId, tokenId, gen, controlId, innerTimeoutMs, capacityLimit } = arg || {};
  const acquire = acquireControlLease({ sessionId, tokenId, gen, controlId });
  if (!acquire.ok) return { ok: false, reason: acquire.reason };

  const g = window.__g1;
  const session = g.sessions[sessionId];
  const stillMine = () => Boolean(session.activeControl) && session.activeControl.controlId === controlId;

  const scratch = createControlScratchSession(sessionId, { controlId, copyArtifactKeys: [] });
  if (!scratch.ok) {
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: `scratch-session-failed:${scratch.reason}` };
  }
  const scratchSessionId = scratch.scratchSessionId;
  // See doc comment above: observeF1 needs this Map to already exist as an own artifact, purely
  // as a write-target -- never copied from the real session (matches wrongOwnerControlInPage's
  // own established fix for the identical gap).
  g.sessions[scratchSessionId].artifacts.f1FragmentMapsByRoot = new Map();

  const model = session.model;
  // Task 14 fix wave (H1, see this function's own doc comment above): resolved via
  // getFragmentList() -- a real Viewer 7.124.2 Model has no bare `.fragList` own property.
  // Wrapped in try/catch, mirroring invalidBoundsControlInPage's own tree-resolution pattern --
  // never let a hostile accessor throw outside the guard below.
  let fragList;
  try {
    fragList = typeof model.getFragmentList === 'function' ? model.getFragmentList() : null;
  } catch { fragList = null; }
  const property = 'getCount';
  // codex-review Critical fix (see doc comment above): validate BEFORE touching the descriptor --
  // never let an absent/malformed fragList throw outside the try/finally that owns cleanup.
  if (!fragList || typeof fragList[property] !== 'function' || typeof capacityLimit !== 'number' || !Number.isFinite(capacityLimit)) {
    disposeControlScratchSession(scratchSessionId);
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: 'no-fragList-getCount' };
  }
  const originalDescriptor = Object.getOwnPropertyDescriptor(fragList, property) || null;
  const originalGetCount = fragList[property];

  let detected = null;
  let timedOut = false;
  let reason = null;
  let restored = null;
  let leaseLost = false;

  try {
    fragList[property] = () => capacityLimit + 1;
    recordControlPatch(session, { target: fragList, property, originalDescriptor });

    try {
      const r = await raceWithInnerTimeout(observeF1(scratchSessionId), innerTimeoutMs);
      if (!stillMine()) { leaseLost = true; } else {
        detected = Boolean(r && r.ok === false && r.error && r.error.name === 'CapacityExceededError');
        if (!detected) reason = 'not-detected';
      }
    } catch (e) {
      if (!stillMine()) { leaseLost = true; } else if (e && e.innerControlTimeout) {
        timedOut = true;
        reason = 'perturbation-timeout';
      } else {
        detected = false;
        reason = 'observeF1-threw';
      }
    }
  } finally {
    if (stillMine()) {
      let membersRestored = false;
      try {
        if (originalDescriptor) Object.defineProperty(fragList, property, originalDescriptor);
        else delete fragList[property];
        membersRestored = fragList[property] === originalGetCount;
      } catch {
        membersRestored = false;
      }
      const { worldLiveOk, bindingOk } = checkSessionLiveness(session, model);
      restored = membersRestored && worldLiveOk && bindingOk;
      if (restored) releaseControlLease({ sessionId, controlId });
      disposeControlScratchSession(scratchSessionId);
    }
  }

  if (leaseLost) return { ok: true, detected: false, restored: false, timedOut: false, reason: 'lease-lost-mid-flight' };
  if (timedOut) return { ok: true, detected: false, restored: false, timedOut: true, reason };
  if (!detected) return { ok: true, detected: false, restored: Boolean(restored), timedOut: false, reason };
  if (!restored) return { ok: true, detected: true, restored: false, timedOut: false, reason: reason || 'restore-assertion-failed' };
  return { ok: true, detected: true, restored: true, timedOut: false, reason: null };
}

/**
 * In-page. `invalidBoundsControlInPage({sessionId, tokenId, gen, controlId, innerTimeoutMs,
 * targetDbId})` -- bridged port of `runInvalidBoundsControl` (below), Phase 8c (right after F7).
 * `targetDbId` is selected ENTIRELY Node-side (`buildInvalidBoundsControlDep`, below, from the
 * real, already-computed F7 result's own `censusedDbIds` -- "any censused dbId qualifies" per
 * the original's own doc comment) and passed in as a plain number; this function never selects
 * its own target.
 *
 * Scratch session WITH `copyArtifactKeys: ['f1FragmentMapsByRoot', 'f4Geometry',
 * 'f4FragmentGeometryId', 'f4WorldMatricesByFragId']` -- `observeF7`'s own confirmed hard
 * precondition (direct read, above: rejects with
 * `f1-fragment-maps-by-root-not-available-run-observeF1-first` /
 * `f4-artifacts-not-available-run-observeF4-first` if missing), all four copied read-only from
 * the real session's own already-computed F1/F4 results (both already ran earlier in
 * `runHarness`, this control runs strictly after both). `f1FragmentMapsByRoot` is a
 * `Map<dbId, Map<fragId, ExtractedFragmentRecord>>` -- confirmed by direct read that `observeF7`
 * only ever READS from it (`.get(dbId)`, `.keys()`), never mutates an inner Map, so Task 10's
 * existing shallow-outer-Map copy (`new Map(value.entries())`) is sufficient for this control's
 * own read-only usage. Also confirmed by direct read that `observeF7` never writes into
 * `session.artifacts` at all -- no key needs excluding from the scratch copy, and no scratch-
 * isolation hazard beyond the ordinary artifact-copy discipline Task 10 already provides.
 *
 * Patches the tree's `getNodeBox` (obtained via `model.getObjectTree()`/`getInstanceTree()`
 * fallback -- confirmed by direct read of `clashpanel/viewer/viewerApi.js`'s own
 * `getElementWorldBounds` that it resolves the tree the SAME way, so this patch is actually
 * observed by `observeF7`'s own re-run through that real, unmodified production function) to
 * fill the output buffer with `NaN` for `targetDbId` only -- the original's exact perturbation.
 * Detection: re-run F7's own detection via `observeF7(scratchSessionId)`,
 * `r.fields.boundsAgreement[targetDbId] === 'viewerApiNull'` (confirmed against `observeF7`'s
 * current real output shape).
 */
async function invalidBoundsControlInPage(arg) {
  const { sessionId, tokenId, gen, controlId, innerTimeoutMs, targetDbId } = arg || {};
  const acquire = acquireControlLease({ sessionId, tokenId, gen, controlId });
  if (!acquire.ok) return { ok: false, reason: acquire.reason };

  const g = window.__g1;
  const session = g.sessions[sessionId];
  const stillMine = () => Boolean(session.activeControl) && session.activeControl.controlId === controlId;

  const scratch = createControlScratchSession(sessionId, {
    controlId,
    copyArtifactKeys: ['f1FragmentMapsByRoot', 'f4Geometry', 'f4FragmentGeometryId', 'f4WorldMatricesByFragId'],
  });
  if (!scratch.ok) {
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: `scratch-session-failed:${scratch.reason}` };
  }
  const scratchSessionId = scratch.scratchSessionId;

  const model = session.model;
  let tree;
  try {
    tree = typeof model.getObjectTree === 'function' ? model.getObjectTree() : null;
    if (!tree || typeof tree.getNodeBox !== 'function') tree = typeof model.getInstanceTree === 'function' ? model.getInstanceTree() : null;
  } catch { tree = null; }
  if (!tree || typeof tree.getNodeBox !== 'function') {
    disposeControlScratchSession(scratchSessionId);
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: 'no-tree-getNodeBox' };
  }

  const property = 'getNodeBox';
  const originalDescriptor = Object.getOwnPropertyDescriptor(tree, property) || null;
  const originalGetNodeBox = tree[property];

  let detected = null;
  let timedOut = false;
  let reason = null;
  let restored = null;
  let leaseLost = false;

  try {
    tree[property] = (dbId, buffer) => {
      if (dbId === targetDbId && buffer && buffer.length >= 6) {
        for (let i = 0; i < 6; i += 1) buffer[i] = Number.NaN;
        return undefined;
      }
      return originalGetNodeBox.call(tree, dbId, buffer);
    };
    recordControlPatch(session, { target: tree, property, originalDescriptor });

    try {
      const r = await raceWithInnerTimeout(observeF7(scratchSessionId), innerTimeoutMs);
      if (!stillMine()) { leaseLost = true; } else {
        const agreement = r && r.ok === true && r.fields && r.fields.boundsAgreement ? r.fields.boundsAgreement[targetDbId] : undefined;
        detected = agreement === 'viewerApiNull';
        if (!detected) reason = 'not-detected';
      }
    } catch (e) {
      if (!stillMine()) { leaseLost = true; } else if (e && e.innerControlTimeout) {
        timedOut = true;
        reason = 'perturbation-timeout';
      } else {
        detected = false;
        reason = 'observeF7-threw';
      }
    }
  } finally {
    if (stillMine()) {
      let membersRestored = false;
      try {
        if (originalDescriptor) Object.defineProperty(tree, property, originalDescriptor);
        else delete tree[property];
        membersRestored = tree[property] === originalGetNodeBox;
      } catch {
        membersRestored = false;
      }
      const { worldLiveOk, bindingOk } = checkSessionLiveness(session, model);
      restored = membersRestored && worldLiveOk && bindingOk;
      if (restored) releaseControlLease({ sessionId, controlId });
      disposeControlScratchSession(scratchSessionId);
    }
  }

  if (leaseLost) return { ok: true, detected: false, restored: false, timedOut: false, reason: 'lease-lost-mid-flight' };
  if (timedOut) return { ok: true, detected: false, restored: false, timedOut: true, reason };
  if (!detected) return { ok: true, detected: false, restored: Boolean(restored), timedOut: false, reason };
  if (!restored) return { ok: true, detected: true, restored: false, timedOut: false, reason: reason || 'restore-assertion-failed' };
  return { ok: true, detected: true, restored: true, timedOut: false, reason: null };
}

/**
 * In-page. `boundsBeyondToleranceControlInPage({sessionId, tokenId, gen, controlId,
 * innerTimeoutMs, targetDbId, axisIndex, delta, nodeBoxPrimary})` -- bridged port of
 * `runBoundsBeyondToleranceControl` (below), Phase 8c (right after invalid-bounds). The most
 * numerically precise control in the whole plan.
 *
 * Target selection AND the delta/representability math (`selectBoundsBeyondToleranceTarget`,
 * `refMin_a`/`nodeMin_a`/`S_a`/`delta = (refMin_a - nodeMin_a) + 2^-6*S_a`) are done ENTIRELY
 * Node-side, in `buildBoundsBeyondToleranceControlDep` (below) -- they operate purely on
 * `primaryF7Fields` (F7's own already-computed, already-serialized fields), need no live
 * page/model access at all, and the brief's own explicit instruction is to short-circuit to
 * `NOT_EXECUTABLE{reason:'perturbation-not-representable'}` WITHOUT ever entering the page when
 * unrepresentable -- doing the arithmetic Node-side lets that short-circuit happen before any
 * lease is ever acquired, exactly matching the ORIGINAL Node-side function's own behavior (no
 * mutation attempted at all when unrepresentable), and keeps what crosses the realm boundary to
 * the bare minimum: `targetDbId`/`axisIndex`/`delta`/`nodeBoxPrimary` (the primary-pass
 * `elementWorldBounds[targetDbId]`, needed for the bit-exact restoration oracle below) -- all
 * JSON-safe plain numbers/arrays, never the whole `primaryF7Fields` object.
 *
 * A SEPARATE, genuinely-runtime-only representability check remains in-page (mirroring the
 * original exactly): whether the LIVE `getNodeBox` call's own buffer values, once shifted by the
 * precomputed `delta`, stay finite and well-ordered can only be known at call time (the live
 * buffer content is not knowable Node-side ahead of time) -- if not, the patched `getNodeBox`
 * still calls through to the original unperturbed result and flags `perturbationRepresentable =
 * false`, which this function surfaces as the same `NOT_EXECUTABLE{reason:
 * 'perturbation-not-representable'}` outcome, AFTER unconditionally restoring/releasing/
 * disposing in its own `finally` first (never skipping cleanup on this path).
 *
 * Scratch session: same four `copyArtifactKeys` as `invalidBoundsControlInPage` (`observeF7`'s
 * own confirmed precondition, see that function's own doc comment -- identical reasoning,
 * unrepeated here). Patches `tree.getNodeBox` for `targetDbId` ONLY: calls the original first,
 * then -- if representable -- adds `delta` to both `dst[axisIndex]`/`dst[axisIndex+3]`.
 * Detection: re-run F7's own detection via `observeF7(scratchSessionId)`,
 * `checkResult.boundsAgreement === 'disagrees'` (never a weaker state, per the original's own
 * doc comment: "never a weaker state").
 *
 * Restoration oracle (STRONGER than every other bridged control's own descriptor-based check,
 * per the brief's explicit instruction -- not weakened to match the simpler pattern): after
 * restoring `tree.getNodeBox` from its recorded descriptor, re-read `targetDbId`'s bounds via
 * the REAL `getElementWorldBounds` (from `createViewerApi`, the SAME `window.__g1.mod` module
 * reference and construction `observeF7` itself already uses -- never re-resolved a second way)
 * and confirm bit-exact equality (`Object.is` per component) against the primary-pass
 * `nodeBoxPrimary` -- not merely that the property descriptor was reinstalled.
 *
 * codex-review (code, high effort, this task's own pre-commit review pass) fix: `stillMine()` is
 * now re-checked BEFORE interpreting `perturbationRepresentable` (both after the `await` and in
 * the final return-priority ordering) -- an earlier version checked `perturbationRepresentable`
 * first, which is a structural violation of the "check lease ownership immediately after await,
 * before doing anything else" discipline even though it has no observable effect TODAY (confirmed:
 * `observeF7` is fully synchronous, so `perturbationRepresentable`'s final value is always fully
 * determined, in the SAME synchronous span, before this function's own `await` could possibly
 * yield to any macrotask that could clear the lease -- but the ordering is corrected for
 * consistency and in case a future, genuinely-async detection oracle changes that property).
 *
 * codex-review DISCLOSED, NOT fixed (Important finding, same disposition as Task 11's own
 * disclosed residuals): when `perturbationRepresentable` is false AND this control's own
 * post-restore liveness/bit-exact checks ALSO genuinely fail (e.g. `world.isModelLive()` returns
 * false), the returned shape is still `{ok:false, reason:'perturbation-not-representable'}` --
 * the SAME `NOT_EXECUTABLE{executed:false}` classification as an ordinary not-representable
 * outcome, which does not surface that a lease was actually acquired, a patch was actually
 * installed, and restoration actually failed (the lease is correctly left HELD in
 * `session.activeControl` either way -- Phase 11's own fallback still sees and handles it
 * directly, since it reads `session.activeControl`, never this function's return value -- so
 * REAL cleanup safety is unaffected; only this function's own returned diagnostic is imprecise
 * in this combined case). This is NOT a new defect: the ORIGINAL, already-accepted Node-side
 * `runBoundsBeyondToleranceControl` (below) has the IDENTICAL characteristic for this exact path
 * (it does not even attempt a liveness check when `!perturbationRepresentable`, confirmed by
 * direct read) -- since NOT_EXECUTABLE and RESTORE_FAILED are equally PASS-blocking per the
 * governing verdict precedence, this has no effect on the overall G1 gate. Resolving it precisely
 * would require extending the `ControlResult`/command-result schema to represent "attempted,
 * unrepresentable, AND restoration failed" as a distinct state -- a schema-boundary decision
 * outside this bounded task's own authorization ("only the REALM changes, not the logic").
 * Flagged explicitly for Task 13 or a dedicated schema review.
 */
async function boundsBeyondToleranceControlInPage(arg) {
  const {
    sessionId, tokenId, gen, controlId, innerTimeoutMs,
    targetDbId, axisIndex, delta, nodeBoxPrimary,
  } = arg || {};
  const acquire = acquireControlLease({ sessionId, tokenId, gen, controlId });
  if (!acquire.ok) return { ok: false, reason: acquire.reason };

  const g = window.__g1;
  const session = g.sessions[sessionId];
  const stillMine = () => Boolean(session.activeControl) && session.activeControl.controlId === controlId;

  const scratch = createControlScratchSession(sessionId, {
    controlId,
    copyArtifactKeys: ['f1FragmentMapsByRoot', 'f4Geometry', 'f4FragmentGeometryId', 'f4WorldMatricesByFragId'],
  });
  if (!scratch.ok) {
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: `scratch-session-failed:${scratch.reason}` };
  }
  const scratchSessionId = scratch.scratchSessionId;

  const model = session.model;
  let tree;
  try {
    tree = typeof model.getObjectTree === 'function' ? model.getObjectTree() : null;
    if (!tree || typeof tree.getNodeBox !== 'function') tree = typeof model.getInstanceTree === 'function' ? model.getInstanceTree() : null;
  } catch { tree = null; }
  if (!tree || typeof tree.getNodeBox !== 'function') {
    disposeControlScratchSession(scratchSessionId);
    releaseControlLease({ sessionId, controlId });
    return { ok: false, reason: 'no-tree-getNodeBox' };
  }

  const property = 'getNodeBox';
  const originalDescriptor = Object.getOwnPropertyDescriptor(tree, property) || null;
  const originalGetNodeBox = tree[property];

  let detected = null;
  let timedOut = false;
  let reason = null;
  let restored = null;
  let leaseLost = false;
  let perturbationRepresentable = true;

  try {
    tree[property] = (dbId, buffer) => {
      const result = originalGetNodeBox.call(tree, dbId, buffer);
      if (dbId === targetDbId && buffer && buffer.length >= 6) {
        const shiftedMin = buffer[axisIndex] + delta;
        const shiftedMax = buffer[axisIndex + 3] + delta;
        if (!Number.isFinite(shiftedMin) || !Number.isFinite(shiftedMax) || shiftedMin > shiftedMax) {
          perturbationRepresentable = false;
          return result;
        }
        buffer[axisIndex] = shiftedMin;
        buffer[axisIndex + 3] = shiftedMax;
      }
      return result;
    };
    recordControlPatch(session, { target: tree, property, originalDescriptor });

    try {
      const r = await raceWithInnerTimeout(observeF7(scratchSessionId), innerTimeoutMs);
      // codex-review fix (code, high effort, this task's own pre-commit review pass): `stillMine()`
      // is re-checked FIRST, immediately after the one `await`, before interpreting
      // `perturbationRepresentable` -- matching the lease-lost-mid-flight hard requirement
      // literally ("before doing anything else"), rather than the reverse order an earlier
      // version of this function used. `observeF7` is fully synchronous (confirmed by direct
      // source read, no internal `await`), so today this reordering is a no-op in practice (the
      // whole synchronous span, including every point where `perturbationRepresentable` could be
      // set, completes before ANY macrotask could interleave to clear the lease) -- but the
      // ordering is corrected here for structural consistency with the stated discipline and to
      // stay correct if `observeF7`/its equivalent ever gains a genuine internal `await`.
      if (!stillMine()) {
        leaseLost = true;
      } else if (!perturbationRepresentable) {
        // Handled after the finally block, below -- restoration must still run unconditionally.
      } else {
        const agreement = r && r.ok === true && r.fields && r.fields.boundsAgreement ? r.fields.boundsAgreement[targetDbId] : undefined;
        detected = agreement === 'disagrees';
        if (!detected) reason = 'not-detected';
      }
    } catch (e) {
      if (!stillMine()) {
        leaseLost = true;
      } else if (!perturbationRepresentable) {
        // Handled after the finally block, below.
      } else if (e && e.innerControlTimeout) {
        timedOut = true;
        reason = 'perturbation-timeout';
      } else {
        detected = false;
        reason = 'observeF7-threw';
      }
    }
  } finally {
    if (stillMine()) {
      let membersRestored = false;
      try {
        if (originalDescriptor) Object.defineProperty(tree, property, originalDescriptor);
        else delete tree[property];
        membersRestored = tree[property] === originalGetNodeBox;
      } catch {
        membersRestored = false;
      }
      const { worldLiveOk, bindingOk } = checkSessionLiveness(session, model);

      // Stronger restoration oracle (per the brief's explicit instruction): re-read via the REAL
      // getElementWorldBounds and confirm bit-exact equality against the primary-pass value --
      // not merely that the property descriptor was reinstalled.
      let boundsBitExact = true;
      try {
        const mod = g.mod || {};
        const { createViewerApi } = mod['/clashpanel/viewer/viewerApi.js'] || {};
        if (typeof createViewerApi === 'function' && Array.isArray(nodeBoxPrimary)) {
          const av = window.Autodesk && window.Autodesk.Viewing;
          const events = { BEFORE_MODEL_UNLOAD: av ? av.BEFORE_MODEL_UNLOAD_EVENT : undefined, MODEL_REMOVED: av ? av.MODEL_REMOVED_EVENT : undefined };
          const viewerApi = createViewerApi(window.__viewer, { events });
          const reread = viewerApi.getElementWorldBounds(model, targetDbId);
          boundsBitExact = Array.isArray(reread) && reread.length === nodeBoxPrimary.length
            && reread.every((v, i) => Object.is(v, nodeBoxPrimary[i]));
        }
      } catch {
        boundsBitExact = false;
      }

      restored = membersRestored && worldLiveOk && bindingOk && boundsBitExact;
      if (restored) releaseControlLease({ sessionId, controlId });
      disposeControlScratchSession(scratchSessionId);
    }
  }

  // leaseLost takes priority over perturbationRepresentable, matching the corrected in-branch
  // ordering above (codex-review fix).
  if (leaseLost) return { ok: true, detected: false, restored: false, timedOut: false, reason: 'lease-lost-mid-flight' };
  if (!perturbationRepresentable) return { ok: false, reason: 'perturbation-not-representable' };
  if (timedOut) return { ok: true, detected: false, restored: false, timedOut: true, reason };
  if (!detected) return { ok: true, detected: false, restored: Boolean(restored), timedOut: false, reason };
  if (!restored) return { ok: true, detected: true, restored: false, timedOut: false, reason: reason || 'restore-assertion-failed' };
  return { ok: true, detected: true, restored: true, timedOut: false, reason: null };
}

// ============================================================================================
// STAGE 5 -- Geometry-and-limits slice: F4 (collision-layer per-fragment/geometry reads, the
// most complex single check in the whole plan), F5 (existing limits under SVF2), and their
// two mandatory controls (invalid-geometry-consumer, capacity-breach) (plan §6.1 Phase 6/6c/
// 7/7c, §7.4, §7.5, §6.5/§6.3a's invalid-geometry-consumer and capacity-breach rows).
//
// Per codex-advisor consult (medium, before implementing F4 specifically -- explicitly
// sanctioned by this stage's own brief given F4's complexity and its dependence on exact
// compactAndWeld/activeRangeCompaction.js semantics): (1) keep `getRenderProxy ->
// adaptViewerGeometry -> compactAndWeld` together inside ONE synchronous in-page span per
// geometry -- the production path (ViewerGeometryAdapter.js's own header comment,
// CollisionWorld.js, createGeometryRegistry.js) deliberately never lets an await/yield land
// between adaptation and welding, because the adapter returns LIVE REFERENCES into Viewer-
// owned buffers; a cross-realm "raw capture, adapt in Node" split was rejected as the WEAKEST
// option -- it would make the capture function an unreviewed second geometry adapter, since
// adaptViewerGeometry makes priority-sensitive decisions from property presence/truthiness/
// Array.isArray/undefined/Infinity that a JSON-safe capture could silently alter; (2) retain,
// for F7 (a later stage), a synchronous DEEP SNAPSHOT of the adapter's own (pre-weld) result
// shape -- never the live adapter output (its arrays are live references), never the welded
// output (F7 needs the adapter's original active ranges/vertex stream; welding remaps indices,
// converts to Float32, and filters degenerate triangles); (3) store geometry data ONCE per
// distinct geometry id (many fragments legitimately share one), with per-fragment records
// carrying only `{geometryId, worldMatrix}` plus a key into the shared geometry snapshot --
// never duplicating the geometry buffers per fragment; (4) keep `scoreF4`/evidence-shaping/
// verdict-reduction in ordinary Node code, and reuse the SAME Node-side weld-result classifier
// for both F4's own scoring and the invalid-geometry-consumer control, so the control exercises
// the exact same finiteness/failure classification F4 itself uses, not a second, separately-
// reasoned copy. All adopted verbatim.
//
// `adaptViewerGeometry`/`compactAndWeld` were confirmed PURE (no live-Viewer/browser
// dependency) by direct source read of both production files -- `compactAndWeld` is imported
// for real, Node-side use at the top of this file (see that import's own comment); ONLY
// `viewer.impl.getRenderProxy(model, fragId)` is genuinely live-browser-only. Offline tests
// reconstruct `observeF4` in the same `node:vm` realm used throughout this file, populating
// `window.__g1.mod` with the REAL imported `adaptViewerGeometry`/`compactAndWeld` (never fakes
// for these two) alongside a fake `viewer.impl.getRenderProxy` (the one thing that must be
// faked) -- exercising the real production functions without a browser.
// ============================================================================================

/** Node-side. Shared weld-result classifier -- the SAME logic both `scoreF4`'s own evidence
 * shaping (via `observeF4`'s in-page duplicate, since an in-page function cannot call a
 * Node-side helper -- see this file's own established bundling-note discipline) and
 * `runInvalidGeometryConsumerControl` use to turn one `compactAndWeld` return value into an
 * outcome, per plan §7.4's exact success/failure split: `{oversized:true,
 * reason:'geometry-too-large-for-sync-build'}` is informational only, never a failure (F5 owns
 * the limit-conformance verdict); `{oversized:true, reason:'index-references-invalid-vertex'}`
 * is a genuine F4/control failure; a successful weld with every `position` component finite is
 * success; a successful weld with a non-finite `position` component is F4's OWN added
 * finiteness assertion firing (the gap `compactAndWeld` itself does not close, confirmed by
 * source read: `findOutOfRangeVertexId` only checks range membership, never
 * `Number.isFinite`). */
function classifyWeldResult(weldResult) {
  if (!weldResult) return { outcome: 'threw' };
  if (weldResult.oversized === true) {
    if (weldResult.reason === 'geometry-too-large-for-sync-build') return { outcome: 'oversized-informational', activeTriangleCount: weldResult.activeTriangleCount };
    if (weldResult.reason === 'index-references-invalid-vertex') return { outcome: 'index-references-invalid-vertex' };
    return { outcome: 'unrecognized-oversized-reason', reason: weldResult.reason };
  }
  const position = weldResult.position;
  let allFinite = true;
  if (position) {
    for (let i = 0; i < position.length; i += 1) {
      if (!Number.isFinite(position[i])) { allFinite = false; break; }
    }
  } else {
    allFinite = false;
  }
  return allFinite ? { outcome: 'success', triangleCount: weldResult.triangleCount } : { outcome: 'non-finite-position' };
}

// ------------------------------------------------------------------------------------------
// §7.4 F4 -- collision-layer per-fragment/geometry reads
// ------------------------------------------------------------------------------------------

/**
 * In-page. `observeF4(sessionId)` -- plan §7.4's full observation sequence, the most complex
 * single check in the whole plan, run as ONE synchronous-per-geometry-id chain (per the
 * codex-advisor consult above). References only its own argument and
 * window.__g1/window.__viewer/window.THREE. Reads the real `adaptViewerGeometry`/
 * `compactAndWeld` from `window.__g1.mod`, same convention as `observeF1`.
 *
 * MUST run after `observeF1` for the same session -- reuses `session.artifacts.
 * f1PopulationRecords` (every loaded fragment's already-extracted `{geometryIdentity,
 * worldMatrix, ownerDbId}`, populated by `observeF1`'s own `extractAllFragments` call) to
 * derive the distinct-geometry-id set and every fragment's own world matrix -- NEVER calling
 * `fragList.getGeometryId()`/`readWorldMatrix()` a second time.
 *
 * For every distinct geometry id: `viewer.impl.getRenderProxy(model, representativeFragId)`
 * for one representative fragment -> `adaptViewerGeometry(proxy.geometry)` -> (for every
 * `unsupported: false` result) `compactAndWeld(adapted, {getUnitScale: () =>
 * model.getUnitScale()})` -- deliberately omits `maxSyncTriangleCount` so `compactAndWeld`'s
 * own internal default (imported from `/collision/constants.js` inside that file) applies,
 * and deliberately never reimplements `resolveWeldEpsilon`'s own fallback logic itself --
 * calling the real function with the real option shape `CollisionWorld` itself uses IS the
 * correct reproduction of that formula, not a second transcription of it.
 *
 * Retains, per geometry id, a synchronous deep snapshot of the ADAPTER's own (pre-weld) result
 * -- `{unsupported:false, positions, positionStride, positionOffset, index, ranges,
 * activeTriangleCount, representativeFragId}`, every typed array `.slice()`d (never the live
 * adapter output) -- into `session.artifacts.f4Geometry` (`Map<geometryId, snapshot>`), plus
 * `session.artifacts.f4FragmentGeometryId` (`Map<fragId, geometryId>`, covering every loaded
 * fragment) and `session.artifacts.f4WorldMatricesByFragId` (`Map<fragId, number[]>`, reused
 * directly from `f1PopulationRecords`, never re-read from the Viewer) -- F7 (a later stage)
 * reuses all three verbatim.
 *
 * Returns a JSON-safe `{ok, fields, first20RenderProxyFailures, first20GeometryAdapterFailures,
 * first20WeldConsumerFailures}`. `fields` names every machine-readable field plan §7.4 lists,
 * plus `oversizedGeometryCount` (the TRUE, never-bounded count backing F5's own copy -- plan
 * §7.4's own text: "the count itself is never bounded").
 *
 * Known, documented simplification (matching F1's own §6.1a checkpoint carve-out and F3's own
 * probe-boundary precedent from Stages 3-4): does not implement the full `CENSUS_TIMEOUT_MS`
 * absolute-deadline-check-and-macrotask-yield chunking discipline plan §6.4a names for F4's
 * census -- that is genuinely separate async-timing work a later, live-run-wiring stage owns;
 * `CENSUS_TIMEOUT_MS` is exported here only as a named, documented constant for that stage to
 * use, never silently baked into this function's own control flow.
 */
async function observeF4(sessionId) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'session-not-found' };
  if (!session.artifacts || !session.artifacts.f1PopulationRecords) {
    return { ok: false, reason: 'f1-population-records-not-available-run-observeF1-first' };
  }

  const { model } = session;
  const mod = g.mod || {};
  const { adaptViewerGeometry } = mod['/collision/viewer/ViewerGeometryAdapter.js'] || {};
  const { compactAndWeld: weld } = mod['/collision/geometry/activeRangeCompaction.js'] || {};
  const viewer = window.__viewer;
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), reason: e.reason ?? null }
    : { primitive: typeof e, value: String(e) });

  // Fix round 1 (Stage 5 review): F4's own ownership-metadata observation (plan line 946:
  // "additionally record whether getGeometryId returns a usable id for every fragment in the
  // tested population (no undefined/throw)"). This is a FRESH, INDEPENDENT per-fragment
  // fragList.getGeometryId()/getDbIds() re-verification -- deliberately NOT derived from F1's
  // already-cached record.geometryIdentity/ownerDbId. Reasoning: F1's own extractAllFragments
  // call builds geometryIdentity via `createGeometryIdentity(loadEpoch,
  // fragList.getGeometryId(fragId))` (ViewerModelAdapter.js:267), and createGeometryIdentity
  // itself THROWS a TypeError if geometryIndex is undefined/non-integer
  // (collision/geometry/GeometryIdentity.js:8-16) -- so if getGeometryId were EVER undefined
  // or threw for even one fragment during F1's OWN scan, that exception would propagate out of
  // extractAllFragments, be swallowed by observeF1's own try/catch, and
  // session.artifacts.f1PopulationRecords would never be set at all. Since observeF4 refuses to
  // run without that artifact (the precondition check above), relying on F1's cached
  // geometryIdentity here would make this check STRUCTURALLY INCAPABLE of ever observing the
  // exact failure it exists to catch. Re-deriving fresh, in F4's own try/catch, is the only way
  // this observation can ever be meaningful.
  let libraryThrew = 0;
  let libOwnerDiffersFromFragList = 0;
  const droppedDiagnosticsCount = { 'geometry-id-undefined': 0, 'geometry-id-threw': 0 };
  const fragList = model.getFragmentList();

  const geometryIdToRepresentativeFragId = new Map();
  const fragmentGeometryId = new Map();
  const worldMatricesByFragId = new Map();
  for (const [fragId, record] of session.artifacts.f1PopulationRecords) {
    let freshGeometryId;
    try {
      freshGeometryId = fragList.getGeometryId(fragId);
    } catch {
      libraryThrew += 1;
      droppedDiagnosticsCount['geometry-id-threw'] += 1;
      continue; // no usable geometry id -- excluded from the census below, per plan's own
                // "droppedDiagnosticsCount... distinct from the already-known N/U classes".
    }
    if (freshGeometryId === undefined) {
      droppedDiagnosticsCount['geometry-id-undefined'] += 1;
      continue;
    }

    // T3's own libOwnerDiffersFromFragList convention (MEASURE_ADAPTER,
    // clashtest-viewer-adapter.acceptance.mjs:326-327): compares the library's (F1's own
    // extractAllFragments) already-computed ownerDbId against a FRESH fragList.getDbIds(fragId)
    // read for the same fragment -- a getDbIds throw is a distinct, unnamed concern (no field
    // exists for it) and is deliberately excluded from this specific count rather than
    // fabricating a bucket the plan never names.
    try {
      const freshOwnerDbId = fragList.getDbIds(fragId);
      if (freshOwnerDbId !== record.ownerDbId) libOwnerDiffersFromFragList += 1;
    } catch { /* getDbIds threw -- not counted toward libOwnerDiffersFromFragList (a value
                 comparison field), and the plan names no separate field for this case */ }

    fragmentGeometryId.set(fragId, freshGeometryId);
    worldMatricesByFragId.set(fragId, record.worldMatrix);
    if (!geometryIdToRepresentativeFragId.has(freshGeometryId)) geometryIdToRepresentativeFragId.set(freshGeometryId, fragId);
  }

  const distinctGeometryCount = geometryIdToRepresentativeFragId.size;
  const renderProxyFailures = [];
  const geometryAdapterFailures = [];
  const weldConsumerFailures = [];
  let geometriesWithNullIndex = 0;
  let weldConsumerSuccessCount = 0;
  let maxActiveTriangleCount = 0;
  const oversizedGeometryIds = [];
  let oversizedGeometryCount = 0;
  const geometrySnapshots = new Map();

  for (const [geometryId, representativeFragId] of geometryIdToRepresentativeFragId) {
    let proxy;
    try {
      proxy = viewer.impl.getRenderProxy(model, representativeFragId);
    } catch (e) {
      renderProxyFailures.push({ geometryId, fragId: representativeFragId, error: errOf(e) });
      continue;
    }
    if (!proxy) {
      renderProxyFailures.push({ geometryId, fragId: representativeFragId, error: { message: 'getRenderProxy returned a falsy value' } });
      continue;
    }

    let adapted;
    try {
      adapted = adaptViewerGeometry(proxy.geometry);
    } catch (e) {
      geometryAdapterFailures.push({ geometryId, fragId: representativeFragId, error: errOf(e) });
      continue;
    }
    if (!adapted || adapted.unsupported === true) {
      geometryAdapterFailures.push({ geometryId, fragId: representativeFragId, reason: adapted ? adapted.reason : 'adapter-returned-falsy' });
      continue;
    }

    if (adapted.index === null || adapted.index === undefined) geometriesWithNullIndex += 1;
    if (adapted.activeTriangleCount > maxActiveTriangleCount) maxActiveTriangleCount = adapted.activeTriangleCount;

    geometrySnapshots.set(geometryId, {
      unsupported: false,
      positions: adapted.positions.slice(),
      positionStride: adapted.positionStride,
      positionOffset: adapted.positionOffset,
      index: adapted.index == null ? null : adapted.index.slice(),
      ranges: adapted.ranges.map((r) => ({ start: r.start, count: r.count })),
      activeTriangleCount: adapted.activeTriangleCount,
      representativeFragId,
    });

    let weldResult;
    try {
      weldResult = weld(adapted, { getUnitScale: () => model.getUnitScale() });
    } catch (e) {
      weldConsumerFailures.push({ geometryId, error: errOf(e) });
      continue;
    }

    // Inlined duplicate of classifyWeldResult's own logic -- an in-page function cannot call a
    // Node-side helper (this file's own established constraint); kept in exact lockstep with
    // classifyWeldResult, which Node-side scoreF4/the invalid-geometry-consumer control use.
    if (weldResult.oversized === true) {
      if (weldResult.reason === 'geometry-too-large-for-sync-build') {
        oversizedGeometryCount += 1;
        if (oversizedGeometryIds.length < 20) oversizedGeometryIds.push(geometryId);
      } else {
        weldConsumerFailures.push({ geometryId, reason: weldResult.reason });
      }
      continue;
    }
    let allFinite = true;
    if (weldResult.position) {
      for (let i = 0; i < weldResult.position.length; i += 1) {
        if (!Number.isFinite(weldResult.position[i])) { allFinite = false; break; }
      }
    } else {
      allFinite = false;
    }
    if (!allFinite) {
      weldConsumerFailures.push({ geometryId, nonFiniteComponent: true });
      continue;
    }
    weldConsumerSuccessCount += 1;
  }

  session.artifacts.f4Geometry = geometrySnapshots;
  session.artifacts.f4FragmentGeometryId = fragmentGeometryId;
  session.artifacts.f4WorldMatricesByFragId = worldMatricesByFragId;

  return {
    ok: true,
    fields: {
      libraryThrew,
      libOwnerDiffersFromFragList,
      droppedDiagnosticsCount,
      distinctGeometryCount,
      renderProxyFailures: renderProxyFailures.length,
      geometryAdapterFailures: geometryAdapterFailures.length,
      geometriesWithNullIndex,
      weldConsumerFailures: weldConsumerFailures.length,
      weldConsumerSuccessCount,
      maxActiveTriangleCount,
      oversizedGeometryCount,
    },
    first20RenderProxyFailures: renderProxyFailures.slice(0, 20),
    first20GeometryAdapterFailures: geometryAdapterFailures.slice(0, 20),
    first20WeldConsumerFailures: weldConsumerFailures.slice(0, 20),
    oversizedGeometryIds,
  };
}

/**
 * `scoreF4(fields)` -- plan §7.4's exact success/failure criteria, pure, Node-side. `FAIL` iff
 * ANY of: the ownership-metadata half (`libraryThrew > 0`, `libOwnerDiffersFromFragList > 0`,
 * or any `droppedDiagnosticsCount` class non-zero -- fix round 1, Stage 5 review: exactly the
 * "unexplained extraction failures beyond the already-known N/U diagnostic classes" plan
 * §7.4's own success criteria, line 947, names, and a metadata-read failure per line 949's own
 * failure criteria) OR the geometry-buffer half (any render-proxy failure, any geometry-adapter
 * failure -- an `unsupported:true` result for a geometry F1 confirmed populated -- or any
 * weld-consumer failure -- `index-references-invalid-vertex` or a non-finite `position`
 * component). `geometriesWithNullIndex` and `oversizedGeometryCount` are NEVER failure
 * conditions here (a `null` index is an explicit PASS for that geometry; an oversized-for-
 * sync-build geometry is F5's own limit-conformance finding, never an F4 collision-
 * compatibility regression).
 */
function scoreF4(fields) {
  const f = fields || {};
  // Fix round 1 (Stage 5 review): libraryThrew/libOwnerDiffersFromFragList/
  // droppedDiagnosticsCount are exactly the "unexplained extraction failures beyond the
  // already-known N/U diagnostic classes" plan §7.4's own success criteria (line 947) names --
  // a genuinely broken getGeometryId()/getDbIds() resolution for a fragment F1/F2 already
  // confirmed present is a metadata-read failure (line 949's own failure criteria), not merely
  // informational.
  const droppedDiagnosticsTotal = f.droppedDiagnosticsCount
    ? Object.values(f.droppedDiagnosticsCount).reduce((sum, n) => sum + (n || 0), 0)
    : 0;
  const ownershipMetadataFailed = f.libraryThrew > 0 || f.libOwnerDiffersFromFragList > 0 || droppedDiagnosticsTotal > 0;
  const geometryBufferFailed = f.renderProxyFailures > 0 || f.geometryAdapterFailures > 0 || f.weldConsumerFailures > 0;
  const failed = ownershipMetadataFailed || geometryBufferFailed;
  const reason = !failed ? null
    : ownershipMetadataFailed ? 'f4-ownership-metadata-failure'
    : 'f4-render-proxy-adapter-or-weld-consumer-failure';
  return { verdict: failed ? CHECK_VERDICT.FAIL : CHECK_VERDICT.PASS, reason, fields: f };
}

// ------------------------------------------------------------------------------------------
// §7.5 F5 -- existing limits under SVF2
// ------------------------------------------------------------------------------------------

/** Node-side, pure. Maps a typed capacity error to `{limit, requested}` per plan §7.5's
 * corrected dependency. `CapacityExceededError` (`Object.assign(this, {limit, requested,
 * ...})`, `collision/errors.js`) is read directly; `EnumerationBoundExceededError` (`bound`
 * names which limit, `detail` carries `{dbId,tally}`/`{dbId,root,count}` context, never a
 * literal `limit`/`requested` pair) is mapped via this file's own imported constants. */
function deriveOrganicBreach(error) {
  if (!error) return null;
  if (error.name === 'CapacityExceededError') {
    return { limit: error.limit ?? null, requested: error.requested ?? null };
  }
  if (error.name === 'EnumerationBoundExceededError') {
    const limitByBound = { maxFragmentsPerDbId, maxChildrenPerNode: MAX_CHILDREN_PER_NODE_LIMIT };
    const detail = error.detail || {};
    const requested = detail.tally !== undefined ? detail.tally : (detail.count !== undefined ? detail.count : null);
    return { limit: (error.bound && limitByBound[error.bound]) ?? null, requested };
  }
  return null;
}

/**
 * `scoreF5({f1Result, f2Fields, f4Fields})` -- plan §7.5's corrected dependency and organic-
 * breach rule, pure, Node-side. `f1Result` is `observeF1`'s own raw return
 * (`{ok:true,fields}` or `{ok:false,reason,error}`).
 *
 * - F1 failed with a typed `CapacityExceededError`/`EnumerationBoundExceededError`: `FAIL`,
 *   `withinLimits:false`, `enforcementObserved:true` (never `PASS` for an organic breach, even
 *   though enforcement fired correctly -- the corrected rule plan §7.5 explicitly warns
 *   against reintroducing).
 * - F1 failed with anything else: `BLOCKED`, `reason:'F1-failed-non-capacity'`.
 * - F1 succeeded: `PASS` iff F2's accounting balances (fully enumerated) AND
 *   `oversizedGeometryCount === 0` (F4's own count, copied verbatim) -- otherwise `FAIL`.
 */
function scoreF5({ f1Result, f2Fields, f4Fields }) {
  if (!f1Result || f1Result.ok !== true) {
    const err = f1Result && f1Result.error;
    const isCapacityError = Boolean(err && (err.name === 'CapacityExceededError' || err.name === 'EnumerationBoundExceededError'));
    if (isCapacityError) {
      return {
        verdict: CHECK_VERDICT.FAIL,
        reason: 'organic-capacity-breach',
        fields: {
          maxRootFragmentCount: null, maxPerDbIdFragmentCount: null, maxChildrenPerNode: null,
          sumRootFragmentCount: null, wholePopulationCount: null,
          maxActiveTriangleCount: null, oversizedGeometryCount: null,
          withinLimits: false, fullyEnumerated: false, enforcementObserved: true,
          organicBreach: deriveOrganicBreach(err),
        },
      };
    }
    return {
      verdict: CHECK_VERDICT.BLOCKED,
      reason: 'F1-failed-non-capacity',
      fields: {
        maxRootFragmentCount: null, maxPerDbIdFragmentCount: null, maxChildrenPerNode: null,
        sumRootFragmentCount: null, wholePopulationCount: null,
        maxActiveTriangleCount: null, oversizedGeometryCount: null,
        withinLimits: null, fullyEnumerated: null, enforcementObserved: false, organicBreach: null,
      },
    };
  }

  const f1 = f1Result.fields || {};
  const f2 = f2Fields || {};
  const f4 = f4Fields || {};
  const fullyEnumerated = f2.accountingBalanced === true;
  const oversizedGeometryCount = f4.oversizedGeometryCount ?? 0;
  const withinLimits = fullyEnumerated && oversizedGeometryCount === 0;

  return {
    verdict: withinLimits ? CHECK_VERDICT.PASS : CHECK_VERDICT.FAIL,
    reason: withinLimits ? null : (!fullyEnumerated ? 'not-fully-enumerated' : 'oversized-geometry-present'),
    fields: {
      maxRootFragmentCount: f1.maxRootFragmentCount ?? null,
      maxPerDbIdFragmentCount: f1.maxPerDbIdFragmentCount ?? null,
      maxChildrenPerNode: f2.maxChildrenPerNode ?? null,
      sumRootFragmentCount: f1.sumRootFragmentCount ?? null,
      wholePopulationCount: f1.populationCount ?? null,
      maxActiveTriangleCount: f4.maxActiveTriangleCount ?? null,
      oversizedGeometryCount,
      withinLimits,
      fullyEnumerated,
      enforcementObserved: false,
      organicBreach: null,
    },
  };
}

// ------------------------------------------------------------------------------------------
// §7.7 F7 -- Viewer API bounds/unit/visibility behavior (world-space correctness oracle)
// ------------------------------------------------------------------------------------------

/** Tolerance constants for F7's bounds bracket (plan §7.7 lines 1045-1048; "Discipline": these
 * may never be tuned against a live run's own observations). `u` is float32 unit roundoff for
 * round-to-nearest; `passFactor`/`grossRelative` give the declared PASS allowance and the
 * FAIL boundary; `sFloor` is the smallest normal float32, `S_a`'s own floor. */
const F7_TOLERANCE_CONSTANTS = Object.freeze({ u: 2 ** -24, passFactor: 16, grossRelative: 2 ** -10, sFloor: 2 ** -126 });

/**
 * In-page. `observeF7(sessionId)` -- plan §7.7's full independent bounds algorithm plus the
 * unit-metadata/visibility subchecks, run once per censused dbId. Census domain is F1's own
 * per-root `extractFragments` maps, `session.artifacts.f1FragmentMapsByRoot` (keys = root
 * dbIds, values = `Map<fragId, ExtractedFragmentRecord>`) -- NOT `resolveRoots`'s aggregate
 * output and NOT the flat `f1PopulationRecords`, mirroring F8's own R1 discussion (plan §7.8)
 * of which source is the genuine per-fragment-per-owning-root evidence.
 *
 * MUST run after observeF1 and observeF4 for the same session -- reuses F4's retained
 * `session.artifacts.f4Geometry`/`f4FragmentGeometryId`/`f4WorldMatricesByFragId` verbatim,
 * never recomputing `getRenderProxy`/`adaptViewerGeometry`/world matrices (plan's own "reuse,
 * never recompute" convention, restated for F7 by this stage's brief).
 *
 * codex-advisor consult (medium, before implementation) on the S_a/tolerance-bracket math
 * confirmed: (a) the placement-substitution (line 1040) replaces only each of the three
 * 3x3-block-derived per-axis-k coefficients -- the `L_k` multiplication stays OUTSIDE the
 * substitution, applied once per k; (b) all four residual quantities (`rMin`, `rMax`, `eMin`,
 * `eMax`) share ONE uniform sign convention -- positive means the containment/envelope
 * requirement is VIOLATED, never the reverse (this file's first draft of this question had the
 * envelope sign backwards; corrected here), and raw signed values (never `abs()`) are compared
 * with strict `>`; (c) classification is a global reduction over all 6 independent containment
 * components (never per-axis-pair-together) in the stated precedence order, with
 * `envelope-incomplete` preceding `exceeds-envelope` even when both would otherwise apply; (d)
 * equality at `T_pass` passes, equality at `T_gross` is `near-tolerance` (not `disagrees`) --
 * both boundaries are strict `>`; (e) F4's frozen retained-artifact shape means an ABSENT
 * `f4FragmentGeometryId`/`f4Geometry` entry is the only signal available for a fragment F4
 * itself dropped, and per the consult this is correctly reported under the plan's own
 * `unsupported` reason vocabulary (§7.7 names no other reason for this), with an additional
 * non-plan `origin` field retained alongside it so the concrete absence source (missing
 * fragment mapping vs. missing geometry snapshot) is never silently lost; (f) every `S_a`/
 * residual/matrix-inverse computation is explicitly finite-gated before classification, since a
 * non-finite value would otherwise make every `> threshold` comparison false and silently fall
 * through to `agrees` -- this file never lets that happen (see `nonFiniteAxisDbIds` below).
 *
 * A non-invertible placement transform (only possible when `P`'s 3x3 block is non-identity) is
 * a genuine computation impossibility the plan does not itself resolve to a verdict (flagged by
 * the same consult as an open uncertainty); this file's own resolution, stated explicitly here
 * rather than guessed silently: `placementNotInvertible`/`nonFiniteAxisDbIds` are recorded as
 * harness-level evidence and `scoreF7` treats either as forcing `NOT_EVIDENCED` (never PASS,
 * never a fabricated FAIL) -- "we could not tell," exactly the same discipline the plan already
 * applies to the `(T_pass, T_gross]` calibration band.
 */
async function observeF7(sessionId) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'session-not-found' };
  if (!session.artifacts || !session.artifacts.f1FragmentMapsByRoot) {
    return { ok: false, reason: 'f1-fragment-maps-by-root-not-available-run-observeF1-first' };
  }
  if (!session.artifacts.f4Geometry || !session.artifacts.f4FragmentGeometryId || !session.artifacts.f4WorldMatricesByFragId) {
    return { ok: false, reason: 'f4-artifacts-not-available-run-observeF4-first' };
  }

  const { model } = session;
  const viewer = window.__viewer;
  const mod = g.mod || {};
  const { createViewerApi } = mod['/clashpanel/viewer/viewerApi.js'] || {};
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), reason: e.reason ?? null }
    : { primitive: typeof e, value: String(e) });

  if (typeof createViewerApi !== 'function') {
    return { ok: false, reason: 'createViewerApi-module-not-available' };
  }

  let viewerApi;
  try {
    const av = window.Autodesk && window.Autodesk.Viewing;
    const events = {
      BEFORE_MODEL_UNLOAD: av ? av.BEFORE_MODEL_UNLOAD_EVENT : undefined,
      MODEL_REMOVED: av ? av.MODEL_REMOVED_EVENT : undefined,
    };
    viewerApi = createViewerApi(viewer, { events });
  } catch (e) {
    return { ok: false, reason: 'createViewerApi-threw', error: errOf(e) };
  }

  const { f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId } = session.artifacts;

  // Inlined duplicate of the Node-side F7_TOLERANCE_CONSTANTS -- an in-page function cannot
  // reference a module-level Node-side const (this file's own established constraint: it would
  // be a free variable once this function's source is reconstructed inside a page realm, e.g.
  // via node:vm in this file's own offline tests); kept in exact lockstep with
  // F7_TOLERANCE_CONSTANTS, which the exported constant and scoreF7/tests use.
  const TOLERANCE_CONSTANTS = { u: 2 ** -24, passFactor: 16, grossRelative: 2 ** -10, sFloor: 2 ** -126 };

  // -------- Self-contained numeric helpers (in-page function -- may reference only its own
  // argument and page globals, per this file's own established constraint; nested helpers with
  // no free variables outside window/their own params are the established way around that,
  // e.g. observeF4's inlined classifyWeldResult duplicate). --------
  function isFiniteVec16(e) {
    if (!e || e.length !== 16) return false;
    for (let i = 0; i < 16; i += 1) if (!Number.isFinite(e[i])) return false;
    return true;
  }
  function isAffine(e) { return e[3] === 0 && e[7] === 0 && e[11] === 0 && e[15] === 1; }
  function is3x3Identity(e) {
    return e[0] === 1 && e[1] === 0 && e[2] === 0
      && e[4] === 0 && e[5] === 1 && e[6] === 0
      && e[8] === 0 && e[9] === 0 && e[10] === 1;
  }
  function identity16() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  // Gauss-Jordan inversion of a column-major 4x4 (e[col*4+row]) with partial pivoting. Returns
  // a plain 16-element column-major array, or null if singular/non-finite.
  function invert4x4ColumnMajor(e) {
    if (!isFiniteVec16(e)) return null;
    const a = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const inv = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) a[r][c] = e[c * 4 + r];
    for (let col = 0; col < 4; col += 1) {
      let pivotRow = col;
      let pivotMag = Math.abs(a[col][col]);
      for (let r = col + 1; r < 4; r += 1) {
        const m = Math.abs(a[r][col]);
        if (m > pivotMag) { pivotMag = m; pivotRow = r; }
      }
      if (pivotMag < 1e-300) return null;
      if (pivotRow !== col) {
        const tmpA = a[col]; a[col] = a[pivotRow]; a[pivotRow] = tmpA;
        const tmpI = inv[col]; inv[col] = inv[pivotRow]; inv[pivotRow] = tmpI;
      }
      const pivot = a[col][col];
      for (let k = 0; k < 4; k += 1) { a[col][k] /= pivot; inv[col][k] /= pivot; }
      for (let r = 0; r < 4; r += 1) {
        if (r === col) continue;
        const factor = a[r][col];
        if (factor === 0) continue;
        for (let k = 0; k < 4; k += 1) { a[r][k] -= factor * a[col][k]; inv[r][k] -= factor * inv[col][k]; }
      }
    }
    const out = new Array(16);
    for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) out[c * 4 + r] = inv[r][c];
    return isFiniteVec16(out) ? out : null;
  }
  function matMulColumnMajor4x4(A, B) {
    const out = new Array(16).fill(0);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += A[k * 4 + row] * B[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }
  function readAxisComponent(v, axisIndex) {
    if (v === null || v === undefined) return 0;
    if (Array.isArray(v) || typeof v.length === 'number') return v[axisIndex];
    const key = axisIndex === 0 ? 'x' : axisIndex === 1 ? 'y' : 'z';
    return v[key];
  }

  // -------- Model-scoped placement/offset (read once) --------
  let G = null;
  let P = null;
  try { G = typeof model.getGlobalOffset === 'function' ? model.getGlobalOffset() : null; } catch { G = null; }
  try { P = typeof model.getPlacementTransform === 'function' ? model.getPlacementTransform() : null; } catch { P = null; }
  const Pelements = P && P.elements ? Array.from(P.elements) : identity16();
  const placementIsIdentity = is3x3Identity(Pelements) && Pelements[12] === 0 && Pelements[13] === 0 && Pelements[14] === 0;
  let PInv = null;
  let placementNotInvertible = false;
  if (!is3x3Identity(Pelements)) {
    PInv = invert4x4ColumnMajor(Pelements);
    if (PInv === null) placementNotInvertible = true;
  }
  const Gvec = [readAxisComponent(G, 0) || 0, readAxisComponent(G, 1) || 0, readAxisComponent(G, 2) || 0];

  // -------- Unit metadata (once, model-scoped; plan: "not per-dbId") --------
  let unitScale = null;
  let unitScaleThrew = false;
  try { unitScale = model.getUnitScale(); } catch { unitScaleThrew = true; }
  const unitScalePlausible = !unitScaleThrew && typeof unitScale === 'number' && Number.isFinite(unitScale) && unitScale > 0;

  let unitString = null;
  let unitStringThrew = false;
  try { unitString = model.getUnitString(); } catch { unitStringThrew = true; }
  const unitStringPlausible = !unitStringThrew && (unitString === null || (typeof unitString === 'string' && unitString.length > 0));

  // -------- Visibility: getAggregateHiddenNodes (once, model-scoped) --------
  let hiddenNodesRaw = null;
  let hiddenNodesThrew = false;
  try { hiddenNodesRaw = viewerApi.getAggregateHiddenNodes(); } catch { hiddenNodesThrew = true; }
  const hiddenNodesPlausible = !hiddenNodesThrew && Array.isArray(hiddenNodesRaw);

  // -------- visibilityBranch characterization (never gates -- plan's own explicit rule) --------
  let visibilityBranch = 'undetermined';
  try {
    const fragList = typeof model.getFragmentList === 'function' ? model.getFragmentList() : null;
    if (fragList && fragList.db2ThemingColor !== undefined) visibilityBranch = 'FragmentList';
    else if (model.instanceCollection !== undefined || (fragList && fragList.instanceCollection !== undefined)) visibilityBranch = 'InstanceCollection3D';
  } catch { /* stays 'undetermined' */ }

  const censusedDbIds = [...session.artifacts.f1FragmentMapsByRoot.keys()].sort((x, y) => x - y);
  const censusCount = censusedDbIds.length;
  const axisNames = ['x', 'y', 'z'];

  const elementWorldBounds = {};
  const fragmentBoundsUnion = {};
  const conservativeEnvelopeUnion = {};
  const boundsAgreement = {};
  const skippedFragments = {};
  const boundsScalePerDbId = {};
  const boundsResiduals = {};
  const placementOmissionExplains = {};
  const positionsArrayType = {};
  const worldMatrixElementType = {};
  const visibilityResults = {};
  const nonFiniteAxisDbIds = [];
  let nonFiniteTransformedVertexCount = 0;

  for (const dbId of censusedDbIds) {
    // (a) getElementWorldBounds -- read first, per plan's own observation-sequence order.
    const nodeBox = viewerApi.getElementWorldBounds(model, dbId);
    elementWorldBounds[dbId] = nodeBox;

    // visibility (d): membership check against the ONE model-scoped hiddenNodesRaw snapshot.
    let hiddenByDefault = false;
    if (Array.isArray(hiddenNodesRaw)) {
      for (const entry of hiddenNodesRaw) {
        if (entry && typeof entry === 'object' && Array.isArray(entry.ids) && entry.model === model && entry.ids.includes(dbId)) {
          hiddenByDefault = true;
          break;
        }
      }
    }
    visibilityResults[dbId] = { hiddenByDefault };

    // (b) independent computation -- F1's own per-root extractFragments map is the authoritative
    // per-fragment-per-owning-root evidence (never resolveRoots' aggregate, never the flat
    // f1PopulationRecords -- see this function's own doc comment).
    const fragMap = session.artifacts.f1FragmentMapsByRoot.get(dbId);
    const fragIds = fragMap ? [...fragMap.keys()] : [];
    const dbSkips = [];
    let envelopeIncomplete = false;
    const envelopeFragments = [];
    const tightRefFragments = [];

    for (const fragId of fragIds) {
      const geometryId = f4FragmentGeometryId.get(fragId);
      if (geometryId === undefined) {
        dbSkips.push({ fragmentId: fragId, reason: 'unsupported', origin: 'missing-fragment-geometry-mapping' });
        envelopeIncomplete = true;
        continue;
      }
      const geomEntry = f4Geometry.get(geometryId);
      if (!geomEntry) {
        dbSkips.push({ fragmentId: fragId, reason: 'unsupported', origin: 'missing-geometry-snapshot' });
        envelopeIncomplete = true;
        continue;
      }
      if (geomEntry.unsupported === true) {
        dbSkips.push({ fragmentId: fragId, reason: 'unsupported', origin: 'geometry-marked-unsupported' });
        envelopeIncomplete = true;
        continue;
      }
      const e = f4WorldMatricesByFragId.get(fragId);
      if (!e) {
        dbSkips.push({ fragmentId: fragId, reason: 'unsupported', origin: 'missing-world-matrix' });
        envelopeIncomplete = true;
        continue;
      }
      const positions = geomEntry.positions;
      // Object.prototype.toString.call, never `instanceof` -- this file's own established
      // cross-realm gotcha (documented elsewhere in this file): `instanceof` against a realm-
      // specific built-in constructor (Float32Array/Float64Array) always fails across a
      // node:vm realm boundary even for a genuine same-shape typed array, exactly like the
      // Map/Set `instanceof` gotcha this file already worked around.
      const positionsTag = Object.prototype.toString.call(positions);
      if (positionsTag !== '[object Float32Array]' && positionsTag !== '[object Float64Array]') {
        dbSkips.push({ fragmentId: fragId, reason: 'non-float-positions' });
        envelopeIncomplete = true;
        continue;
      }
      if (!isFiniteVec16(e) || !isAffine(e)) {
        dbSkips.push({ fragmentId: fragId, reason: 'non-affine-world-matrix' });
        envelopeIncomplete = true;
        continue;
      }

      positionsArrayType[fragId] = Object.prototype.toString.call(positions);
      worldMatrixElementType[fragId] = Object.prototype.toString.call(e);

      // Step 3b: all-vertex local AABB -- used for the envelope AND S_a's own L_k terms, for
      // every fragment reaching this point (including no-active-triangles ones).
      const stride = geomEntry.positionStride;
      const offset = geomEntry.positionOffset;
      const vertexCount = Math.floor(positions.length / stride);
      let loX = Infinity; let loY = Infinity; let loZ = Infinity;
      let hiX = -Infinity; let hiY = -Infinity; let hiZ = -Infinity;
      for (let i = 0; i < vertexCount; i += 1) {
        const x = positions[i * stride + offset];
        const y = positions[i * stride + offset + 1];
        const z = positions[i * stride + offset + 2];
        if (x < loX) loX = x; if (x > hiX) hiX = x;
        if (y < loY) loY = y; if (y > hiY) hiY = y;
        if (z < loZ) loZ = z; if (z > hiZ) hiZ = z;
      }

      const frag = {
        e, positions, positionStride: stride, positionOffset: offset,
        index: geomEntry.index, ranges: geomEntry.ranges,
        localLo: [loX, loY, loZ], localHi: [hiX, hiY, hiZ], F: null,
      };
      envelopeFragments.push(frag);

      if (geomEntry.activeTriangleCount === 0) {
        dbSkips.push({ fragmentId: fragId, reason: 'no-active-triangles' });
        // kept in envelope (already pushed above); excluded from tight ref only -- this is the
        // FOURTH skip reason, which does NOT mark envelopeIncomplete (only the first three do).
        continue;
      }
      tightRefFragments.push(frag);
    }
    skippedFragments[dbId] = dbSkips;

    // Precompute F = P^-1*e once per envelope-eligible fragment (axis-independent).
    if (!is3x3Identity(Pelements) && PInv !== null) {
      for (const frag of envelopeFragments) {
        const F = matMulColumnMajor4x4(PInv, frag.e);
        frag.F = isFiniteVec16(F) ? F : null;
      }
    }

    // Tight reference (fragmentBoundsUnion): only vertex indices inside adaptViewerGeometry's
    // own `ranges`, resolved through `index` when indexed (step 3/4/5).
    let refLoX = Infinity; let refLoY = Infinity; let refLoZ = Infinity;
    let refHiX = -Infinity; let refHiY = -Infinity; let refHiZ = -Infinity;
    let anyRefPoint = false;
    for (const frag of tightRefFragments) {
      const { e, positions, positionStride: stride, positionOffset: offset, index, ranges } = frag;
      for (const range of ranges) {
        for (let k = 0; k < range.count; k += 1) {
          const pos = range.start + k;
          const vid = index ? index[pos] : pos;
          const x = positions[vid * stride + offset];
          const y = positions[vid * stride + offset + 1];
          const z = positions[vid * stride + offset + 2];
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
          const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
            nonFiniteTransformedVertexCount += 1;
            continue; // step 5: "reject (record, do not silently drop)" -- recorded above,
                      // just this one coordinate excluded from accumulation, never the whole
                      // fragment/dbId (step 7's own "zero valid finite points" already covers
                      // the degenerate all-non-finite case).
          }
          anyRefPoint = true;
          if (wx < refLoX) refLoX = wx; if (wx > refHiX) refHiX = wx;
          if (wy < refLoY) refLoY = wy; if (wy > refHiY) refHiY = wy;
          if (wz < refLoZ) refLoZ = wz; if (wz > refHiZ) refHiZ = wz;
        }
      }
    }

    // Envelope (conservativeEnvelopeUnion): transform the 8 corners of each envelope-eligible
    // fragment's local AABB (step 6).
    let envLoX = Infinity; let envLoY = Infinity; let envLoZ = Infinity;
    let envHiX = -Infinity; let envHiY = -Infinity; let envHiZ = -Infinity;
    let anyEnvPoint = false;
    for (const frag of envelopeFragments) {
      const { e, localLo, localHi } = frag;
      for (let cx = 0; cx < 2; cx += 1) {
        for (let cy = 0; cy < 2; cy += 1) {
          for (let cz = 0; cz < 2; cz += 1) {
            const x = cx === 0 ? localLo[0] : localHi[0];
            const y = cy === 0 ? localLo[1] : localHi[1];
            const z = cz === 0 ? localLo[2] : localHi[2];
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
            const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
            const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
            if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue;
            anyEnvPoint = true;
            if (wx < envLoX) envLoX = wx; if (wx > envHiX) envHiX = wx;
            if (wy < envLoY) envLoY = wy; if (wy > envHiY) envHiY = wy;
            if (wz < envLoZ) envLoZ = wz; if (wz > envHiZ) envHiZ = wz;
          }
        }
      }
    }
    if (!anyEnvPoint) envelopeIncomplete = true;

    if (!anyRefPoint) {
      // Step 7: every fragment excluded from the tight reference, or zero valid finite points.
      fragmentBoundsUnion[dbId] = null;
      conservativeEnvelopeUnion[dbId] = anyEnvPoint ? [envLoX, envLoY, envLoZ, envHiX, envHiY, envHiZ] : null;
      boundsAgreement[dbId] = 'no-reference-geometry';
      continue;
    }
    const refBox = [refLoX, refLoY, refLoZ, refHiX, refHiY, refHiZ];
    fragmentBoundsUnion[dbId] = refBox;
    conservativeEnvelopeUnion[dbId] = anyEnvPoint ? [envLoX, envLoY, envLoZ, envHiX, envHiY, envHiZ] : null;

    if (nodeBox === null) {
      boundsAgreement[dbId] = 'viewerApiNull';
      continue;
    }

    const refMin = [refLoX, refLoY, refLoZ];
    const refMax = [refHiX, refHiY, refHiZ];
    const nodeMin = [nodeBox[0], nodeBox[1], nodeBox[2]];
    const nodeMax = [nodeBox[3], nodeBox[4], nodeBox[5]];
    const envMin = [envLoX, envLoY, envLoZ];
    const envMax = [envHiX, envHiY, envHiZ];

    const scale = {};
    const residuals = {};
    let anyDisagrees = false;
    let anyNearTolerance = false;
    let anyExceedsEnvelope = false;
    let anyNonFiniteAxis = false;

    for (let a = 0; a < 3; a += 1) {
      let maxSaFragmentsOnly = 0;
      for (const frag of envelopeFragments) {
        const { e, localLo, localHi } = frag;
        const L = [Math.max(Math.abs(localLo[0]), Math.abs(localHi[0])),
          Math.max(Math.abs(localLo[1]), Math.abs(localHi[1])),
          Math.max(Math.abs(localLo[2]), Math.abs(localHi[2]))];
        let sAf;
        if (is3x3Identity(Pelements)) {
          sAf = Math.abs(e[a]) * L[0] + Math.abs(e[a + 4]) * L[1] + Math.abs(e[a + 8]) * L[2];
        } else if (!frag.F) {
          sAf = NaN;
        } else {
          const F = frag.F;
          let sum = 0;
          for (let k = 0; k < 3; k += 1) {
            let coeff = 0;
            for (let j = 0; j < 3; j += 1) coeff += Math.abs(Pelements[a + 4 * j]) * Math.abs(F[j + 4 * k]);
            sum += coeff * L[k];
          }
          sAf = sum;
        }
        sAf += Math.abs(e[a + 12]);
        if (!Number.isFinite(sAf)) { anyNonFiniteAxis = true; continue; }
        if (sAf > maxSaFragmentsOnly) maxSaFragmentsOnly = sAf;
      }
      const maxSaWithConst = maxSaFragmentsOnly + Math.abs(Gvec[a]) + Math.abs(Pelements[a + 12]);
      const S_a = Math.max(
        maxSaWithConst,
        Math.abs(refMin[a]), Math.abs(refMax[a]),
        Math.abs(nodeMin[a]), Math.abs(nodeMax[a]),
        TOLERANCE_CONSTANTS.sFloor,
      );

      const rMin = nodeMin[a] - refMin[a];
      const rMax = refMax[a] - nodeMax[a];
      const eMin = envMin[a] - nodeMin[a];
      const eMax = nodeMax[a] - envMax[a];
      const T_pass = TOLERANCE_CONSTANTS.passFactor * TOLERANCE_CONSTANTS.u * S_a;
      const T_gross = TOLERANCE_CONSTANTS.grossRelative * S_a;
      scale[axisNames[a]] = { S_a, T_pass, T_gross };
      residuals[axisNames[a]] = { rMin, rMax, eMin, eMax };

      if (!Number.isFinite(S_a) || !Number.isFinite(rMin) || !Number.isFinite(rMax)) {
        anyNonFiniteAxis = true;
        continue;
      }
      const maxContainmentResidual = Math.max(rMin, rMax);
      if (maxContainmentResidual > T_gross) anyDisagrees = true;
      else if (maxContainmentResidual > T_pass) anyNearTolerance = true;
      if (Number.isFinite(eMin) && eMin > T_pass) anyExceedsEnvelope = true;
      if (Number.isFinite(eMax) && eMax > T_pass) anyExceedsEnvelope = true;
    }

    boundsScalePerDbId[dbId] = scale;
    boundsResiduals[dbId] = residuals;
    if (anyNonFiniteAxis) nonFiniteAxisDbIds.push(dbId);

    let state;
    if (anyDisagrees) state = 'disagrees';
    else if (anyNearTolerance) state = 'near-tolerance';
    else if (envelopeIncomplete) state = 'envelope-incomplete';
    else if (anyExceedsEnvelope) state = 'exceeds-envelope';
    else if (anyNonFiniteAxis) state = 'envelope-incomplete'; // conservative fallback -- never
                                                                // silently 'agrees' on NaN.
    else state = 'agrees';
    boundsAgreement[dbId] = state;

    if (state === 'disagrees' && !placementIsIdentity) {
      // Diagnostic only (plan line 1051): does the classic-SVF-predicted cause (nodeBox
      // omitting placement) explain the disagreement? Recompute the tight reference using
      // F = P^-1*e instead of e, and check containment within T_pass on every axis.
      let altLoX = Infinity; let altLoY = Infinity; let altLoZ = Infinity;
      let altHiX = -Infinity; let altHiY = -Infinity; let altHiZ = -Infinity;
      let anyAltPoint = false;
      for (const frag of tightRefFragments) {
        const F = frag.F;
        if (!F) continue;
        const { positions, positionStride: stride, positionOffset: offset, index, ranges } = frag;
        for (const range of ranges) {
          for (let k = 0; k < range.count; k += 1) {
            const pos = range.start + k;
            const vid = index ? index[pos] : pos;
            const x = positions[vid * stride + offset];
            const y = positions[vid * stride + offset + 1];
            const z = positions[vid * stride + offset + 2];
            const wx = F[0] * x + F[4] * y + F[8] * z + F[12];
            const wy = F[1] * x + F[5] * y + F[9] * z + F[13];
            const wz = F[2] * x + F[6] * y + F[10] * z + F[14];
            if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue;
            anyAltPoint = true;
            if (wx < altLoX) altLoX = wx; if (wx > altHiX) altHiX = wx;
            if (wy < altLoY) altLoY = wy; if (wy > altHiY) altHiY = wy;
            if (wz < altLoZ) altLoZ = wz; if (wz > altHiZ) altHiZ = wz;
          }
        }
      }
      if (anyAltPoint) {
        const altMin = [altLoX, altLoY, altLoZ];
        const altMax = [altHiX, altHiY, altHiZ];
        let explains = true;
        for (let a = 0; a < 3; a += 1) {
          const altRMin = nodeMin[a] - altMin[a];
          const altRMax = altMax[a] - nodeMax[a];
          const T_pass_a = scale[axisNames[a]].T_pass;
          if (!(altRMin <= T_pass_a) || !(altRMax <= T_pass_a)) { explains = false; break; }
        }
        placementOmissionExplains[dbId] = explains;
      } else {
        placementOmissionExplains[dbId] = false;
      }
    }
  }

  return {
    ok: true,
    fields: {
      censusedDbIds,
      censusCount,
      elementWorldBounds,
      fragmentBoundsUnion,
      boundsAgreement,
      conservativeEnvelopeUnion,
      skippedFragments,
      boundsToleranceConstants: TOLERANCE_CONSTANTS,
      boundsScalePerDbId,
      boundsResiduals,
      placementOmissionExplains,
      modelGlobalOffset: G === null ? null : Gvec,
      modelPlacementTransform: P && P.elements ? Pelements : null,
      placementIsIdentity,
      positionsArrayType,
      worldMatrixElementType,
      visibilityResults,
      visibilityBranch,
      unitScale,
      unitString,
      unitScalePlausible,
      unitStringPlausible,
      hiddenNodesPlausible,
      placementNotInvertible,
      nonFiniteAxisDbIds,
      nonFiniteTransformedVertexCount,
    },
  };
}

/**
 * `scoreF7(fields)` -- plan §7.7's exact success/failure/NOT_EVIDENCED criteria, pure,
 * Node-side. `FAIL` iff any censused dbId (excluding `no-reference-geometry` exclusions)
 * classifies `disagrees` or `viewerApiNull`, OR any of `getUnitScale`/`getUnitString`/
 * `getAggregateHiddenNodes` threw or returned an implausible value (plan's own flat Failure
 * criteria list places these in the SAME tier as a bounds disagreement -- never a softer
 * verdict). `NOT_EVIDENCED` iff not `FAIL` and any dbId is `near-tolerance`/`exceeds-envelope`/
 * `envelope-incomplete`, OR this file's own harness-level `placementNotInvertible`/
 * `nonFiniteAxisDbIds` safety gate fired (a genuine computation impossibility the plan itself
 * does not resolve to a verdict -- see `observeF7`'s own doc comment -- never invented as PASS
 * or FAIL). `PASS` iff every censused, non-excluded dbId `agrees` and every subcheck is
 * plausible.
 */
function scoreF7(fields) {
  const f = fields || {};
  const agreement = f.boundsAgreement || {};
  const states = Object.values(agreement);

  const anyDisagrees = states.includes('disagrees');
  const anyViewerApiNull = states.includes('viewerApiNull');
  const subcheckFailed = f.unitScalePlausible !== true || f.unitStringPlausible !== true || f.hiddenNodesPlausible !== true;

  if (anyDisagrees || anyViewerApiNull || subcheckFailed) {
    const reason = anyDisagrees ? 'f7-bounds-disagrees'
      : anyViewerApiNull ? 'f7-viewer-api-returned-null-for-valid-geometry'
        : 'f7-unit-or-visibility-subcheck-implausible';
    return { verdict: CHECK_VERDICT.FAIL, reason, fields: f };
  }

  const anyCalibrationGated = states.includes('near-tolerance') || states.includes('exceeds-envelope') || states.includes('envelope-incomplete');
  const harnessComputationGate = f.placementNotInvertible === true || (Array.isArray(f.nonFiniteAxisDbIds) && f.nonFiniteAxisDbIds.length > 0);

  if (anyCalibrationGated || harnessComputationGate) {
    const reason = harnessComputationGate ? 'f7-placement-not-invertible-or-non-finite-scale' : 'f7-calibration-gated-state-present';
    return { verdict: CHECK_VERDICT.NOT_EVIDENCED, reason, fields: f };
  }

  return { verdict: CHECK_VERDICT.PASS, reason: null, fields: f };
}

/**
 * `selectBoundsBeyondToleranceTarget(f7Fields)` -- plan §6.5's `bounds-beyond-tolerance` row's
 * own target-selection rule (line 672): the LOWEST sorted censused dbId whose PRIMARY F7 result
 * was `agrees`, using the FIRST axis (x, then y, then z) whose `S_a` is finite, normal (`>=
 * 2^-126`, the same smallest-normal-float32 threshold `sFloor` already uses), and positive.
 * Returns `{dbId, axis}` or `null` if none qualifies (the control's own
 * `NOT_EXECUTABLE{reason:'perturbation-not-representable'}` case). Pure, Node-side, so this
 * selection rule and the control that uses it can be tested independently of any page-realm
 * state.
 */
function selectBoundsBeyondToleranceTarget(f7Fields) {
  const f = f7Fields || {};
  const agreement = f.boundsAgreement || {};
  const scale = f.boundsScalePerDbId || {};
  const axisOrder = ['x', 'y', 'z'];
  const sortedDbIds = Object.keys(agreement).map(Number).sort((a, b) => a - b);
  for (const dbId of sortedDbIds) {
    if (agreement[dbId] !== 'agrees') continue;
    const perAxis = scale[dbId];
    if (!perAxis) continue;
    for (const axis of axisOrder) {
      const s = perAxis[axis] && perAxis[axis].S_a;
      if (typeof s === 'number' && Number.isFinite(s) && s >= 2 ** -126 && s > 0) {
        return { dbId, axis };
      }
    }
  }
  return null;
}

/**
 * `runInvalidBoundsControl({modelBefore, world, registry, registryKey, checkBoundsForDbId,
 * targetDbId, controlTimeoutMs})` -- plan §6.5's `invalid-bounds` row (8c, right after F7).
 * Patches `modelBefore`'s tree `getNodeBox` (the same tree `viewerApi.js:63-64` itself
 * resolves) to fill the output buffer with `NaN` for ONE censused dbId (`targetDbId`,
 * caller-selected -- any censused dbId qualifies, since the perturbation exercises
 * `viewerApi.js`'s own non-finite-box guard independent of that dbId's primary-pass state),
 * confirms `checkBoundsForDbId` (injected -- a later live-run stage wires it as `(m, dbId) =>
 * pageEvaluate(observeF7,{sessionId}).then((r) => ({boundsAgreement:
 * r.fields.boundsAgreement[dbId]}))`) reports `viewerApiNull` for that dbId, restores in
 * `finally`.
 */
async function runInvalidBoundsControl({ modelBefore, world, registry, registryKey, checkBoundsForDbId, targetDbId, controlTimeoutMs = CHECK_TIMEOUT_MS }) {
  if (!modelBefore || typeof checkBoundsForDbId !== 'function' || targetDbId === undefined || targetDbId === null) {
    return createControlResult('invalid-bounds', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  let tree;
  try {
    tree = typeof modelBefore.getObjectTree === 'function' ? modelBefore.getObjectTree() : null;
    if (!tree || typeof tree.getNodeBox !== 'function') tree = typeof modelBefore.getInstanceTree === 'function' ? modelBefore.getInstanceTree() : null;
  } catch { tree = null; }
  if (!tree || typeof tree.getNodeBox !== 'function') {
    return createControlResult('invalid-bounds', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'no-tree-getNodeBox' });
  }

  const hasOwnGetNodeBox = Object.prototype.hasOwnProperty.call(tree, 'getNodeBox');
  const originalGetNodeBox = tree.getNodeBox;

  let detected = null;
  let timedOut = false;
  let reason = null;

  try {
    tree.getNodeBox = (dbId, buffer) => {
      if (dbId === targetDbId && buffer && buffer.length >= 6) {
        for (let i = 0; i < 6; i += 1) buffer[i] = Number.NaN;
        return undefined;
      }
      return originalGetNodeBox.call(tree, dbId, buffer);
    };

    const checkResult = await withControlTimeout(checkBoundsForDbId(modelBefore, targetDbId), controlTimeoutMs);
    detected = Boolean(checkResult && checkResult.boundsAgreement === 'viewerApiNull');
    if (!detected) reason = 'not-detected';
  } catch (e) {
    if (e && e.controlTimeout) { timedOut = true; reason = 'perturbation-timeout'; } else { detected = false; reason = 'checkBoundsForDbId-threw'; }
  } finally {
    if (hasOwnGetNodeBox) tree.getNodeBox = originalGetNodeBox;
    else delete tree.getNodeBox;
  }

  if (timedOut) {
    return createControlResult('invalid-bounds', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const membersRestored = tree.getNodeBox === originalGetNodeBox;
  const worldLiveOk = !world || world.isModelLive(modelBefore) === true;
  const bindingOk = !registry || Boolean(registry.bindingFor(registryKey) && registry.bindingFor(registryKey).model === modelBefore);
  const restored = membersRestored && worldLiveOk && bindingOk;

  if (!detected) {
    return createControlResult('invalid-bounds', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('invalid-bounds', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: reason || 'restore-assertion-failed' });
  }
  return createControlResult('invalid-bounds', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

/**
 * `runBoundsBeyondToleranceControl({modelBefore, world, registry, registryKey, primaryF7Fields,
 * checkBoundsForDbId, viewerApiGetElementWorldBounds, model, controlTimeoutMs})` -- plan §6.5's
 * `bounds-beyond-tolerance` row (8c, right after `invalid-bounds`), the most numerically
 * precise control in the plan. Selects its target via `selectBoundsBeyondToleranceTarget`
 * against F7's OWN already-computed `primaryF7Fields` (reused, never recomputed); if none
 * qualifies, `NOT_EXECUTABLE{reason:'perturbation-not-representable'}` (the plan's own escape
 * hatch, line 102 of this stage's brief / line 672 of the plan).
 *
 * Wraps `tree.getNodeBox` for the target dbId only: calls the original first, then adds
 * `Δ = (refMin_a − nodeMin_a) + 2^-6·S_a` to BOTH `dst[a]` and `dst[a+3]` -- shifting the whole
 * box by Δ on one axis, keeping it finite/well-ordered so `viewerApi.js`'s own guard does not
 * fire (exercising the containment/tolerance path, unlike `invalid-bounds`). `refMin_a`/
 * `nodeMin_a`/`S_a` all come from the target's own RETAINED primary-pass values.
 *
 * Detects: `checkBoundsForDbId`, re-run for the target dbId, reports `disagrees` (never a
 * weaker state). Restoration confirms the target dbId's re-read via the real
 * `getElementWorldBounds` is bit-exact (all six Float32 values) against its own primary-pass
 * `elementWorldBounds` (plan line 848) -- not merely that the property descriptor was
 * reinstalled.
 */
async function runBoundsBeyondToleranceControl({
  modelBefore, world, registry, registryKey, primaryF7Fields, checkBoundsForDbId,
  viewerApiGetElementWorldBounds, model, controlTimeoutMs = CHECK_TIMEOUT_MS,
}) {
  const target = selectBoundsBeyondToleranceTarget(primaryF7Fields);
  if (!target || !modelBefore || typeof checkBoundsForDbId !== 'function') {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' });
  }

  const { dbId: targetDbId, axis } = target;
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const refBox = primaryF7Fields.fragmentBoundsUnion && primaryF7Fields.fragmentBoundsUnion[targetDbId];
  const nodeBoxPrimary = primaryF7Fields.elementWorldBounds && primaryF7Fields.elementWorldBounds[targetDbId];
  const S_a = primaryF7Fields.boundsScalePerDbId && primaryF7Fields.boundsScalePerDbId[targetDbId]
    && primaryF7Fields.boundsScalePerDbId[targetDbId][axis] && primaryF7Fields.boundsScalePerDbId[targetDbId][axis].S_a;

  if (!Array.isArray(refBox) || !Array.isArray(nodeBoxPrimary) || typeof S_a !== 'number' || !Number.isFinite(S_a)) {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' });
  }

  const refMin_a = refBox[axisIndex];
  const nodeMin_a = nodeBoxPrimary[axisIndex];
  const delta = (refMin_a - nodeMin_a) + (2 ** -6) * S_a;
  if (!Number.isFinite(delta)) {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' });
  }

  let tree;
  try {
    tree = typeof modelBefore.getObjectTree === 'function' ? modelBefore.getObjectTree() : null;
    if (!tree || typeof tree.getNodeBox !== 'function') tree = typeof modelBefore.getInstanceTree === 'function' ? modelBefore.getInstanceTree() : null;
  } catch { tree = null; }
  if (!tree || typeof tree.getNodeBox !== 'function') {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' });
  }

  const hasOwnGetNodeBox = Object.prototype.hasOwnProperty.call(tree, 'getNodeBox');
  const originalGetNodeBox = tree.getNodeBox;

  let detected = null;
  let timedOut = false;
  let reason = null;
  let perturbationRepresentable = true;

  try {
    tree.getNodeBox = (dbId, buffer) => {
      const result = originalGetNodeBox.call(tree, dbId, buffer);
      if (dbId === targetDbId && buffer && buffer.length >= 6) {
        const shiftedMin = buffer[axisIndex] + delta;
        const shiftedMax = buffer[axisIndex + 3] + delta;
        if (!Number.isFinite(shiftedMin) || !Number.isFinite(shiftedMax) || shiftedMin > shiftedMax) {
          perturbationRepresentable = false;
          return result;
        }
        buffer[axisIndex] = shiftedMin;
        buffer[axisIndex + 3] = shiftedMax;
      }
      return result;
    };

    if (!perturbationRepresentable) throw Object.assign(new Error('perturbation-not-representable'), { notRepresentable: true });
    const checkResult = await withControlTimeout(checkBoundsForDbId(modelBefore, targetDbId), controlTimeoutMs);
    if (!perturbationRepresentable) throw Object.assign(new Error('perturbation-not-representable'), { notRepresentable: true });
    detected = Boolean(checkResult && checkResult.boundsAgreement === 'disagrees');
    if (!detected) reason = 'not-detected';
  } catch (e) {
    if (e && e.notRepresentable) { /* handled after finally, below */ } else if (e && e.controlTimeout) { timedOut = true; reason = 'perturbation-timeout'; } else { detected = false; reason = 'checkBoundsForDbId-threw'; }
  } finally {
    if (hasOwnGetNodeBox) tree.getNodeBox = originalGetNodeBox;
    else delete tree.getNodeBox;
  }

  if (!perturbationRepresentable) {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' });
  }
  if (timedOut) {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const membersRestored = tree.getNodeBox === originalGetNodeBox;
  const worldLiveOk = !world || world.isModelLive(modelBefore) === true;
  const bindingOk = !registry || Boolean(registry.bindingFor(registryKey) && registry.bindingFor(registryKey).model === modelBefore);

  // Plan line 848's own restoration oracle: re-read via the REAL getElementWorldBounds and
  // confirm bit-exact against the primary-pass elementWorldBounds -- stronger than "the
  // property was reinstalled."
  let boundsBitExact = true;
  if (typeof viewerApiGetElementWorldBounds === 'function' && model) {
    let reread;
    try { reread = viewerApiGetElementWorldBounds(model, targetDbId); } catch { reread = null; }
    boundsBitExact = Array.isArray(reread) && reread.length === 6
      && reread.every((v, i) => Object.is(v, nodeBoxPrimary[i]));
  }
  const restored = membersRestored && worldLiveOk && bindingOk && boundsBitExact;

  if (!detected) {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: reason || 'restore-assertion-failed' });
  }
  return createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

// ------------------------------------------------------------------------------------------
// §6.5/§6.3a -- `invalid-geometry-consumer` (6c, right after F4, `restorationRequired: false`
// -- an isolated synthetic perturbation, the non-interference oracle, never touches shared
// state -- and `capacity-breach` (7c, right after F5, `restorationRequired: true`, the same
// shared-state restoration discipline as prior controls).
// ------------------------------------------------------------------------------------------

/** Canonical/stable JSON stringification -- recursively sorts object keys before
 * stringifying, so two structurally-identical JSON-safe values compare equal regardless of
 * property insertion order. A bare `JSON.stringify(a) === JSON.stringify(b)` is key-order-
 * SENSITIVE (`{a:1,b:2}` and `{b:2,a:1}` stringify to different strings despite being
 * structurally identical), which would make `jsonDeepEqual` capable of a false positive
 * `RESTORE_FAILED` report for `invalid-geometry-consumer` -- flagging leakage that never
 * actually happened, purely because of an incidental key-ordering difference between the
 * "before" snapshot and the "after" re-read. Never used for anything beyond this file's own
 * JSON-safe evidence objects (never a value containing a function, a circular reference, or a
 * non-JSON-safe type -- those are describeError's own job, §4.2). */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonDeepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function buildSyntheticOutOfRangeTriangleView() {
  // Three vertices, one triangle; index deliberately references vertex 99, which does not
  // exist (only 0, 1, 2 do) -- compactAndWeld's own existing, already-accepted contract
  // (activeRangeCompaction.js's findOutOfRangeVertexId) rejects this.
  return {
    unsupported: false,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    positionStride: 3,
    positionOffset: 0,
    index: new Uint32Array([0, 1, 99]),
    ranges: [{ start: 0, count: 3 }],
    activeTriangleCount: 1,
  };
}

function buildSyntheticNonFinitePositionTriangleView() {
  // Two well-separated triangles (indexed), the second one carrying a non-finite (NaN) Y
  // component at an otherwise IN-RANGE index. compactAndWeld itself never rejects this
  // (confirmed gap, plan §7.4) -- only the finiteness assertion this control exists to prove
  // catches it. Empirically verified (not just reasoned about): a SINGLE triangle whose only
  // NaN vertex has no other vertex to weld against gets silently collapsed into a degenerate
  // (then filtered) triangle by mergeVertices' own hash-based dedup, which would make the NaN
  // vanish from the output entirely and defeat this control's whole purpose -- two triangles,
  // far enough apart that no cross-triangle welding occurs, reliably keeps the NaN component in
  // the final `position` array for the finiteness assertion to actually observe.
  return {
    unsupported: false,
    positions: new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 10, 0,
      1000, 1000, 0, 1001, 1000, 0, 1000, NaN, 0,
    ]),
    positionStride: 3,
    positionOffset: 0,
    index: new Uint32Array([0, 1, 2, 3, 4, 5]),
    ranges: [{ start: 0, count: 6 }],
    activeTriangleCount: 2,
  };
}

/**
 * `runInvalidGeometryConsumerControl({f4SnapshotBefore, readCurrentF4, controlTimeoutMs})` --
 * plan §6.5's `invalid-geometry-consumer` row, run immediately after F4 (phase 6c). Entirely
 * Node-side -- unlike every other control, its input is ENTIRELY synthetic and harness-local
 * (never touches `modelBefore`/shared state), and `compactAndWeld` is genuinely Node-importable
 * (the real, module-level import at the top of this file), so no in-page component is needed
 * at all.
 *
 * Feeds two synthetic `triangleGeometryView`-shaped objects directly into the REAL, unmodified
 * `compactAndWeld` -- an out-of-range index (must be rejected via `compactAndWeld`'s own
 * existing contract, already proven by `test/geometry/activeRangeCompaction.test.mjs`'s own
 * "Finding 3" case -- this control only confirms the harness's own call site observes that
 * same rejection) and a non-finite position at an in-range index (must be rejected by the SAME
 * `classifyWeldResult` Node-side classifier `scoreF4` itself uses -- proving that assertion
 * actually fires, not merely present in the plan's prose).
 *
 * `restorationRequired: false` (Stage 1's `CONTROL_RESTORATION_REQUIRED['invalid-geometry-
 * consumer']`, cross-checked, never hardcoded) -- the non-interference oracle per §6.3a,
 * mirroring the `late-completion-after-timeout` control's own `f1Snapshot` pattern (plan
 * §6.4a): `f4SnapshotBefore` (a deep copy of `checks.F4`, captured by the CALLER before this
 * control runs) must `jsonDeepEqual` whatever `readCurrentF4()` (an injected callable, re-
 * reading the current `checks.F4` AFTER both `compactAndWeld` calls settle) returns -- proving
 * the synthetic input never leaked into any shared result field. `detected` requires BOTH
 * synthetic cases correctly classified; ANY failure (either case misclassified, or leakage
 * into `checks.F4`) is `RESTORE_FAILED`, per §6.3a's own per-control table for this control.
 */
async function runInvalidGeometryConsumerControl({ f4SnapshotBefore, readCurrentF4, controlTimeoutMs = CHECK_TIMEOUT_MS }) {
  if (typeof readCurrentF4 !== 'function') {
    return createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  let outOfRangeResult = null;
  let nonFiniteResult = null;
  let timedOut = false;
  let reason = null;

  try {
    await withControlTimeout((async () => {
      outOfRangeResult = compactAndWeld(buildSyntheticOutOfRangeTriangleView());
      nonFiniteResult = compactAndWeld(buildSyntheticNonFinitePositionTriangleView());
    })(), controlTimeoutMs);
  } catch (e) {
    if (e && e.controlTimeout) { timedOut = true; reason = 'perturbation-timeout'; }
    else { reason = 'compactAndWeld-threw-unexpectedly'; }
  }

  if (timedOut) {
    return createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const outOfRangeClassified = classifyWeldResult(outOfRangeResult);
  const nonFiniteClassified = classifyWeldResult(nonFiniteResult);
  const outOfRangeDetected = outOfRangeClassified.outcome === 'index-references-invalid-vertex';
  const nonFiniteDetected = nonFiniteClassified.outcome === 'non-finite-position';
  const detected = outOfRangeDetected && nonFiniteDetected;
  if (!detected) reason = reason || 'not-detected';

  let currentF4;
  try {
    currentF4 = await readCurrentF4();
  } catch (e) {
    return createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected, restored: false, reason: 'readCurrentF4-threw' });
  }
  const restored = detected && jsonDeepEqual(f4SnapshotBefore, currentF4);

  if (!detected) {
    return createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: 'checks-F4-diverged-from-snapshot' });
  }
  return createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

/**
 * `runCapacityBreachControl({modelBefore, world, registry, registryKey, checkCapacity,
 * controlTimeoutMs})` -- plan §6.5's `capacity-breach` row, run immediately after F5 (phase
 * 7c), against the SAME `modelBefore` F5's own dependency (F1) read. Patches
 * `modelBefore.fragList.getCount` to report a count over `maxCollisionInstancesPerEpoch`
 * (this file's own real, imported constant -- never a hardcoded duplicate), confirms
 * `checkCapacity` (an injected stand-in for re-running F1's `resolveRoots` and confirming the
 * expected `CapacityExceededError` fires -- a later live-run stage implements it as `(m) =>
 * pageEvaluate(observeF1, {sessionId}).then((r) => ({capacityExceededDetected: !r.ok &&
 * r.error && r.error.name === 'CapacityExceededError'}))`) reports the enforcement fired,
 * restores in `finally`, same restoration discipline as `wrong-owner`/`hidden-fragment`/
 * `tree-unavailable`. `restorationRequired` comes from Stage 1's
 * `CONTROL_RESTORATION_REQUIRED['capacity-breach']` (plan line 846: `true`).
 */
async function runCapacityBreachControl({ modelBefore, world, registry, registryKey, checkCapacity, controlTimeoutMs = CHECK_TIMEOUT_MS }) {
  if (!modelBefore || !modelBefore.fragList || typeof checkCapacity !== 'function') {
    return createControlResult('capacity-breach', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' });
  }

  const fragList = modelBefore.fragList;
  const hasOwnGetCount = Object.prototype.hasOwnProperty.call(fragList, 'getCount');
  const originalGetCount = fragList.getCount;

  let detected = null;
  let timedOut = false;
  let reason = null;

  try {
    fragList.getCount = () => maxCollisionInstancesPerEpoch + 1;
    const checkResult = await withControlTimeout(checkCapacity(modelBefore), controlTimeoutMs);
    detected = Boolean(checkResult && checkResult.capacityExceededDetected === true);
    if (!detected) reason = 'not-detected';
  } catch (e) {
    if (e && e.controlTimeout) { timedOut = true; reason = 'perturbation-timeout'; }
    else { detected = false; reason = 'checkCapacity-threw'; }
  } finally {
    if (hasOwnGetCount) fragList.getCount = originalGetCount;
    else delete fragList.getCount;
  }

  if (timedOut) {
    return createControlResult('capacity-breach', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason });
  }

  const membersRestored = fragList.getCount === originalGetCount;
  const worldLiveOk = !world || world.isModelLive(modelBefore) === true;
  const bindingOk = !registry || Boolean(registry.bindingFor(registryKey) && registry.bindingFor(registryKey).model === modelBefore);
  const restored = membersRestored && worldLiveOk && bindingOk;

  if (!detected) {
    return createControlResult('capacity-breach', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored, reason });
  }
  if (!restored) {
    return createControlResult('capacity-breach', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: reason || 'restore-assertion-failed' });
  }
  return createControlResult('capacity-breach', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

// ------------------------------------------------------------------------------------------
// §7.6 F6 -- unload/reload behavior (the ONLY mutating check; must run last) plus the
// `stale-old-model-event` control (line 674/849: F6's own step 6, copied, never re-run)
// ------------------------------------------------------------------------------------------

/**
 * In-page. Installs F6's unload wiring (plan §7.6 step 2): a probe listener for
 * `BEFORE_MODEL_UNLOAD_EVENT` installed BEFORE the real `wireModelUnload` (dispatch-order-
 * sensitive, per T3's own comment), a T3-style `eventTarget` recorder that captures the wiring's
 * own handler function for direct invocation later (step 6), and an eviction-ordering shim on
 * `world.evictModel` (T3's own `H_STEP1_ASSERT` pattern) that records whether the registry
 * binding was ALREADY null at the moment eviction is invoked -- proving unregister-before-evict
 * ordering, never assumed. Stores everything under page-owned `session.f6` scratch state
 * (function references included -- never returned to Node directly, only JSON-safe snapshots
 * are, via the other in-page functions below).
 */
function f6InstallUnloadWiring({ sessionId, unloadEventName }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session) return { ok: false, reason: 'session-not-found' };
  const { world, registry, model } = session;
  const viewer = window.__viewer;
  const mod = g.mod || {};
  const { wireModelUnload } = mod['/clashtest/viewer/index.js'] || {};
  if (typeof wireModelUnload !== 'function') return { ok: false, reason: 'wireModelUnload-not-available' };

  const f6 = {
    modelBefore: model, modelAfter: null, capturedHandler: null,
    unloadProbeFired: false, unloadEventModel: null, unregisterBeforeEvict: null,
    reloadProbe: null, dispose: null,
    // Fix round (Stage 8 review, codex-advisor finding #4): inspectable bookkeeping -- exact
    // listener identity/event name and disposed/removed state -- so Phase 11's fallback cleanup
    // can PROVE its own removal/disposal succeeded (via runInPageResourceCleanup, below) rather
    // than trusting a single, error-swallowing `dispose` closure whose own success can never be
    // independently re-verified. `probeListener`/`wiringRef` are never touched by anything
    // outside this function and `f6Cleanup`, so `removed`/`disposed` are always accurate.
    probeListener: null, wiringRef: null,
  };

  const probe = (event) => {
    f6.unloadProbeFired = true;
    f6.unloadEventModel = event && event.model !== undefined ? event.model : null;
  };
  viewer.addEventListener(unloadEventName, probe);
  f6.probeListener = { eventName: unloadEventName, fn: probe, removed: false };

  const originalEvictModel = world.evictModel;
  world.evictModel = (m) => {
    if (f6.unregisterBeforeEvict === null) {
      f6.unregisterBeforeEvict = registry.bindingFor(session.K) === null;
    }
    return originalEvictModel.call(world, m);
  };

  const recorder = {
    addEventListener(n, fn) { f6.capturedHandler = fn; viewer.addEventListener(n, fn); },
    removeEventListener(n, fn) { viewer.removeEventListener(n, fn); },
  };
  const wiring = wireModelUnload({ world, registry, eventTarget: recorder, eventName: unloadEventName });
  f6.wiringRef = { disposed: false };

  f6.dispose = () => {
    try {
      viewer.removeEventListener(unloadEventName, probe);
      f6.probeListener.removed = true;
    } catch { /* best-effort -- f6.probeListener.removed stays false, an accurate signal */ }
    world.evictModel = originalEvictModel;
    try {
      wiring.dispose();
      f6.wiringRef.disposed = true;
    } catch { /* best-effort -- f6.wiringRef.disposed stays false, an accurate signal */ }
  };

  session.f6 = f6;
  return { ok: true };
}

/** In-page. Plan §7.6 step 3: `viewer.unloadModel(modelBefore)`. */
function f6TriggerUnload({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6) return { ok: false, reason: 'f6-not-installed' };
  window.__viewer.unloadModel(session.f6.modelBefore);
  return { ok: true };
}

/** In-page predicate (for the Node-side `pageWaitForFunction` bounded wait, Stage 2's own
 * shape). Plan §7.6 step 3: "wait ... for it to leave `viewer.getAllModels()`". */
function f6UnloadSettledPredicate({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6) return false;
  const viewer = window.__viewer;
  const models = typeof viewer.getAllModels === 'function' ? viewer.getAllModels() : [];
  return !models.includes(session.f6.modelBefore);
}

/** In-page. Reads out the unload-phase evidence plan §7.6 step 3 names, once the bounded wait
 * above has settled (or timed out -- the Node orchestrator reads this regardless, since a
 * `false` probe/binding result is itself evidence, never silently dropped). */
function f6ReadUnloadSnapshot({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6) return { ok: false, reason: 'f6-not-installed' };
  const f6 = session.f6;
  return {
    ok: true,
    unloadProbeFired: f6.unloadProbeFired,
    unloadEventModelMatchesModelBefore: f6.unloadEventModel === f6.modelBefore,
    unregisterBeforeEvict: f6.unregisterBeforeEvict,
    bindingNullAfterUnload: session.registry.bindingFor(session.K) === null,
  };
}

/**
 * In-page. Plan §7.6 step 4's corrected ordering (fixes H1's timing defect): installs a FRESH
 * `MODEL_ADDED_EVENT` listener BEFORE the reload's `Document.load` is ever triggered by the
 * Node-side orchestrator -- self-contained implementation of plan §7.3's own prose logic (no
 * concrete implementation of this exists anywhere else in the repo to import; Stage 3 left it as
 * an opaque injected dependency, explicitly out of that stage's own scope -- writing it here, for
 * F6's own reload probe, is this stage's own explicit brief).
 *
 * Fix round 1 (Stage 7 review, Important finding): plan line 1002 says F6's own `f3RepeatProbe`
 * field is "per §7.3's fields" -- an explicit instruction to reuse F3's own field shape and
 * names, not merely its general idea. The timeline this function builds is now BYTE-IDENTICAL in
 * shape to the `timeline` object `scoreF3Readiness` itself already documents and consumes
 * (`modelAddedObserved`, `tModelAdded`, `atInvocation`, `resolveRootsOutcome`
 * `'resolved'|'rejected'|'timed-out'`, `atSettlement`, `elapsedMs`, `rejectionError`) --
 * including the previously-missing SECOND flag snapshot, `atSettlement`, taken when the
 * `resolveRoots` promise actually settles (resolve or reject), distinct from the pre-call
 * `atInvocation` snapshot. This is the exact "recorded flag snapshots... characterize how large
 * that gap actually was" comparison plan §7.3's own success-criteria text requires, and F6's own
 * "Repeatability note" text (plan line 929) explicitly says F6's reload repeats this SAME
 * characterization. `model`/`listener`/`addedEventName` are this function's own bookkeeping,
 * never part of F3's own field list, kept off the eventually-returned/scored shape (see
 * `f6FinalizeReloadProbe`). `resolveRootsOutcome` starts `null` and is set to `'resolved'`/
 * `'rejected'` here when the promise settles, or to `'timed-out'` in `f6FinalizeReloadProbe`
 * (Node-side bounded-wait timeout, which this in-page function has no way to observe itself).
 *
 * Only the FIRST `MODEL_ADDED_EVENT` after install is acted on (`rp.modelAddedObserved` guard)
 * -- a later, unrelated event must never overwrite this reload's own probe result.
 */
function f6InstallReloadProbe({ sessionId, addedEventName }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6) return { ok: false, reason: 'f6-not-installed' };
  const viewer = window.__viewer;
  const ctx = { checkpoint() {} };
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? '') }
    : { primitive: typeof e, value: String(e) });
  const readFlags = (model) => ({
    isObjectTreeCreated: (() => { try { return model && typeof model.isObjectTreeCreated === 'function' ? model.isObjectTreeCreated() : null; } catch { return null; } })(),
    instanceTreeInData: (() => { try { return model && typeof model.getData === 'function' ? Boolean(model.getData() && model.getData().instanceTree) : null; } catch { return null; } })(),
    isLoadDone: (() => { try { return model && typeof model.isLoadDone === 'function' ? model.isLoadDone() : null; } catch { return null; } })(),
  });

  const rp = {
    modelAddedObserved: false, tModelAdded: null, atInvocation: null,
    resolveRootsOutcome: null, atSettlement: null, elapsedMs: null, rejectionError: null,
    model: null, listener: null, addedEventName,
  };
  const listener = (event) => {
    if (rp.modelAddedObserved) return;
    rp.modelAddedObserved = true;
    const model = event && event.model !== undefined ? event.model : null;
    rp.model = model;
    rp.tModelAdded = performance.now();
    rp.atInvocation = readFlags(model);
    session.enumerator.resolveRoots({ model }, 'whole', ctx).then(
      () => {
        rp.resolveRootsOutcome = 'resolved';
        rp.atSettlement = readFlags(model);
        rp.elapsedMs = performance.now() - rp.tModelAdded;
      },
      (err) => {
        rp.resolveRootsOutcome = 'rejected';
        rp.atSettlement = readFlags(model);
        rp.elapsedMs = performance.now() - rp.tModelAdded;
        rp.rejectionError = errOf(err);
      },
    );
  };
  viewer.addEventListener(addedEventName, listener);
  rp.listener = listener;
  session.f6.reloadProbe = rp;
  return { ok: true };
}

/** In-page predicate (Stage 2's `pageWaitForFunction` shape). True once the reload probe's own
 * `resolveRoots` call has settled (`resolveRootsOutcome` is no longer `null` -- `'resolved'` or
 * `'rejected'`; `'timed-out'` is assigned separately, by `f6FinalizeReloadProbe`, once THIS
 * predicate's own bounded wait gives up). */
function f6ReloadProbeSettledPredicate({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  return Boolean(session && session.f6 && session.f6.reloadProbe && session.f6.reloadProbe.resolveRootsOutcome !== null);
}

/**
 * In-page. Plan §7.6 step 7: read out the timeline, remove the listener immediately (mirrors
 * F3's own "finalize immediately, don't wait for Phase 11" discipline). Returns F3's own field
 * shape verbatim (plan line 1002/929 -- fix round 1, Stage 7 review) plus this function's own
 * necessary addition, `modelMatchesReloadToken`.
 *
 * `timedOut` (from the Node-side orchestrator's own bounded-wait outcome, since this in-page
 * function has no visibility into that wait itself): if the probe never settled on its own
 * (`resolveRootsOutcome` still `null`) and the bounded wait gave up, this assigns
 * `resolveRootsOutcome = 'timed-out'` -- F3's own third named outcome state (plan line 929),
 * never left as a bare `null`/an undocumented separate boolean.
 *
 * codex-advisor consult (Stage 7): a fresh listener can observe an UNRELATED `MODEL_ADDED_EVENT`
 * (e.g. a stray/duplicate load elsewhere) -- URN matching alone is insufficient. `tokenId` (the
 * reload's own `loadDocumentNode` token, once known) lets this correlate the probe's own
 * recorded `model` against the AUTHORITATIVE model for that exact reload
 * (`window.__g1.models[tokenId]`, the same record Stage 2's own load machinery already
 * populates) -- `modelMatchesReloadToken` is `null` only when `tokenId` was never supplied
 * (the reload itself never reached a completed token), never silently assumed true.
 */
function f6FinalizeReloadProbe({ sessionId, tokenId, timedOut = false } = {}) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6 || !session.f6.reloadProbe) return { ok: false, reason: 'reload-probe-not-installed' };
  const rp = session.f6.reloadProbe;
  window.__viewer.removeEventListener(rp.addedEventName, rp.listener);
  // Fix round (Stage 8 review): inspectable, alongside f6.probeListener/f6.wiringRef above --
  // Phase 11's fallback cleanup checks this before attempting a redundant removal.
  rp.removed = true;
  if (rp.resolveRootsOutcome === null && timedOut === true) {
    rp.resolveRootsOutcome = 'timed-out';
  }
  let modelMatchesReloadToken = null;
  if (tokenId !== undefined && rp.modelAddedObserved) {
    const expectedModel = g.models ? g.models[tokenId] : undefined;
    modelMatchesReloadToken = expectedModel !== undefined && rp.model === expectedModel;
  }
  return {
    ok: true,
    modelAddedObserved: rp.modelAddedObserved,
    tModelAdded: rp.tModelAdded,
    atInvocation: rp.atInvocation,
    resolveRootsOutcome: rp.resolveRootsOutcome,
    atSettlement: rp.atSettlement,
    elapsedMs: rp.elapsedMs,
    rejectionError: rp.rejectionError,
    modelMatchesReloadToken,
  };
}

/**
 * In-page. Plan §7.6 step 5: `registry.register(K, modelAfter, {modelVersion})`; confirm
 * `registry.bindingFor(K).model === modelAfter` and `world.isModelLive(modelAfter) === true`.
 * `modelAfter` is read from `window.__g1.models[tokenId]` -- the reload's own load-record,
 * exactly how Stage 2's own machinery already tracks a completed load's model (never a separate
 * ad hoc lookup). F6 is the only mutating check: `session.model` moves forward to `modelAfter`
 * here. `session.binding` is intentionally NOT overwritten -- every later read of "the current
 * binding" in this file re-fetches `registry.bindingFor(K)` fresh rather than trusting a cached
 * snapshot, avoiding any staleness question entirely.
 */
function f6Reregister({ sessionId, tokenId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6) return { ok: false, reason: 'f6-not-installed' };
  const modelAfter = g.models ? g.models[tokenId] : undefined;
  if (!modelAfter) return { ok: false, reason: 'modelAfter-not-found' };
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? '') }
    : { primitive: typeof e, value: String(e) });
  try {
    session.registry.register(session.K, modelAfter, { modelVersion: session.modelVersion });
  } catch (e) {
    return { ok: false, reason: 'register-threw', error: errOf(e) };
  }
  session.f6.modelAfter = modelAfter;
  session.model = modelAfter;
  const binding = session.registry.bindingFor(session.K);
  const bindingOk = Boolean(binding && binding.model === modelAfter);
  const liveOk = session.world.isModelLive(modelAfter) === true;
  return { ok: true, reregisteredOk: bindingOk && liveOk };
}

/**
 * In-page, async. Plan §7.6 step 6 -- the actual stale-event proof (T3's own `H_STEP3` "late-
 * unload" pattern): invokes the wiring's CAPTURED handler directly with `{model: modelBefore}`
 * (a simulated stale/delayed event for the model no longer bound), then asserts the four
 * post-conditions the plan names: the handler does not throw; `registry.bindingFor(K)` still
 * resolves to `modelAfter` (unchanged); `world.isModelLive(modelAfter)` is still `true`; a
 * `resolveRoots` call against the CURRENT (freshly re-fetched) binding still succeeds. This
 * outcome IS what `buildStaleOldModelEventControlResult` copies into
 * `result.controls['stale-old-model-event']` (plan line 674/996) -- never re-run.
 */
async function f6RunLateUnloadControl({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6 || typeof session.f6.capturedHandler !== 'function') {
    return { ok: false, reason: 'captured-handler-not-available' };
  }
  const f6 = session.f6;
  const ctx = { checkpoint() {} };

  let lateUnloadHandlerThrew = false;
  try {
    f6.capturedHandler({ model: f6.modelBefore });
  } catch {
    lateUnloadHandlerThrew = true;
  }

  const binding = session.registry.bindingFor(session.K);
  const bindingSurvivesLateUnload = Boolean(binding && binding.model === f6.modelAfter);
  const modelAfterStillLive = session.world.isModelLive(f6.modelAfter) === true;

  let resolveRootsOk = false;
  if (binding) {
    try {
      const r = await session.enumerator.resolveRoots(binding, 'whole', ctx);
      resolveRootsOk = Boolean(r);
    } catch {
      resolveRootsOk = false;
    }
  }

  return { ok: true, lateUnloadHandlerThrew, bindingSurvivesLateUnload, modelAfterStillLive, resolveRootsOk };
}

/** In-page. Plan §7.6 step 9: F6-local cleanup (the probe listener, the eviction-ordering shim,
 * the wiring itself), guarded, independent of and before Phase 11's own outer cleanup. */
function f6Cleanup({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  if (!session || !session.f6 || typeof session.f6.dispose !== 'function') return { ok: true, disposed: false, probeRemoved: null, wiringDisposed: null };
  try { session.f6.dispose(); } catch { /* best-effort, mirrors this file's own guarded cleanup discipline --
    session.f6.probeListener.removed/session.f6.wiringRef.disposed below report the TRUE outcome
    regardless: dispose() itself sets each flag only on its own individual try's success (fix
    round, Stage 8 review, codex-advisor finding #4 -- this return value must never silently
    claim success it cannot prove). */ }
  const probeRemoved = session.f6.probeListener ? session.f6.probeListener.removed : null;
  const wiringDisposed = session.f6.wiringRef ? session.f6.wiringRef.disposed : null;
  return { ok: true, disposed: probeRemoved === true && wiringDisposed === true, probeRemoved, wiringDisposed };
}

/**
 * Node-side. `runF6UnloadReload(deps)` -- plan §7.6's exact 9-step sequence, the ONLY mutating
 * check in the whole harness (must run last). Node owns sequencing/timeouts/failure routing; in-
 * page functions (above) own every Viewer/registry/listener touch -- a strict realm boundary,
 * since `world`/`registry`/`model` are page-owned and never returnable to Node (codex-advisor-
 * confirmed decomposition, Stage 7 consult).
 *
 * Reuses Stage 2's own `startLoad` (never a second, parallel load protocol) for the reload's
 * `Document.load`/`loadDocumentNode` pair, same corrected initializer options, no new
 * `Initializer()` call. `drainLoadToken` is deliberately NOT used for the normal reload-success
 * path (codex-advisor consult) -- it exists to reconcile a token that TIMED OUT and might still
 * resolve late, a scenario that does not apply to a freshly-minted reload token with no prior
 * ownership contention; `startLoad` alone already resolves once the reload has settled.
 *
 * `deps`: `{sessionId, pageEvaluate, pageWaitForFunction, loadStarter: {documentLoad,
 * loadDocumentNode}, urn, loadTimeoutMs, unloadEventName, addedEventName, unloadWaitTimeoutMs =
 * CHECK_TIMEOUT_MS, reloadProbeTimeoutMs = CHECK_TIMEOUT_MS, captureFormatSignalsFn =
 * captureModelFormatSignals}` -- `unloadEventName`/`addedEventName` are real
 * `Autodesk.Viewing.*_EVENT` STRINGS, caller-resolved (never hardcoded Node-side).
 *
 * Returns `{ok, fields, docLoad, loadDocumentNode, unloadSettled, unloadSnapshot,
 * reregisterResult, lateUnloadResult, formatSignals}` (`ok:false` only on a fatal wiring-install
 * failure before any of F6's own fields can be produced at all).
 */
async function runF6UnloadReload(deps) {
  const {
    sessionId, pageEvaluate, pageWaitForFunction, loadStarter, urn, loadTimeoutMs,
    unloadEventName, addedEventName,
    unloadWaitTimeoutMs = CHECK_TIMEOUT_MS, reloadProbeTimeoutMs = CHECK_TIMEOUT_MS,
    captureFormatSignalsFn = captureModelFormatSignals,
  } = deps;

  const wiringResult = await pageEvaluate(f6InstallUnloadWiring, { sessionId, unloadEventName });
  if (!wiringResult || wiringResult.ok !== true) {
    return { ok: false, reason: 'wiring-install-failed', detail: wiringResult };
  }

  await pageEvaluate(f6TriggerUnload, { sessionId });
  let unloadSettled = true;
  try {
    await pageWaitForFunction(f6UnloadSettledPredicate, { sessionId }, { timeout: unloadWaitTimeoutMs });
  } catch {
    unloadSettled = false;
  }
  const unloadSnapshot = await pageEvaluate(f6ReadUnloadSnapshot, { sessionId });

  await pageEvaluate(f6InstallReloadProbe, { sessionId, addedEventName });

  const docLoad = await startLoad({
    pageEvaluate, starter: loadStarter.documentLoad, api: LOAD_API.DOCUMENT_LOAD, urn, loadTimeoutMs,
  });
  let loadDocumentNodeResult = null;
  let reloadClassifier = null;
  let formatSignals = null;
  if (docLoad.token.state === TOKEN_STATE.COMPLETED) {
    loadDocumentNodeResult = await startLoad({
      pageEvaluate, starter: loadStarter.loadDocumentNode, api: LOAD_API.LOAD_DOCUMENT_NODE,
      docTokenId: docLoad.token.id, loadTimeoutMs,
    });
  }

  let reregisterResult = { ok: false, reregisteredOk: false };
  let lateUnloadResult = { ok: false, lateUnloadHandlerThrew: null, bindingSurvivesLateUnload: null, modelAfterStillLive: null, resolveRootsOk: null };

  if (loadDocumentNodeResult && loadDocumentNodeResult.token.state === TOKEN_STATE.COMPLETED) {
    reregisterResult = await pageEvaluate(f6Reregister, { sessionId, tokenId: loadDocumentNodeResult.token.id });

    const signalSnapshot = await pageEvaluate(captureFormatSignalsFn, { tokenId: loadDocumentNodeResult.token.id, gen: loadDocumentNodeResult.gen });
    formatSignals = signalSnapshot;
    if (signalSnapshot && signalSnapshot.ok === true && signalSnapshot.isOTG !== null && signalSnapshot.isSVF2 !== null) {
      reloadClassifier = readFormat(buildFormatSignalShim(signalSnapshot));
    }

    if (reregisterResult && reregisterResult.ok === true) {
      lateUnloadResult = await pageEvaluate(f6RunLateUnloadControl, { sessionId });
    }
  }

  let reloadProbeSettled = false;
  try {
    await pageWaitForFunction(f6ReloadProbeSettledPredicate, { sessionId }, { timeout: reloadProbeTimeoutMs });
    reloadProbeSettled = true;
  } catch {
    reloadProbeSettled = false;
  }
  const probeFinal = await pageEvaluate(f6FinalizeReloadProbe, {
    sessionId, tokenId: loadDocumentNodeResult ? loadDocumentNodeResult.token.id : undefined,
    timedOut: !reloadProbeSettled,
  });
  // Fix round 1 (Stage 7 review): F3's own exact field shape (plan line 1002/929), never a
  // separate ad hoc wrapper -- see f6InstallReloadProbe/f6FinalizeReloadProbe's own doc
  // comments. `readinessGateSufficient` mirrors scoreF3Readiness's own derivation (`resolved`
  // is the only sufficient outcome) rather than duplicating its reason/error-formatting logic,
  // which is specific to F3's own top-level check, not a nested field within F6.
  const f3RepeatProbe = probeFinal && probeFinal.ok === true
    ? {
      modelAddedObserved: probeFinal.modelAddedObserved,
      tModelAdded: probeFinal.tModelAdded,
      atInvocation: probeFinal.atInvocation,
      resolveRootsOutcome: probeFinal.resolveRootsOutcome,
      atSettlement: probeFinal.atSettlement,
      elapsedMs: probeFinal.elapsedMs,
      rejectionError: probeFinal.rejectionError,
      readinessGateSufficient: probeFinal.resolveRootsOutcome === 'resolved',
      modelMatchesReloadToken: probeFinal.modelMatchesReloadToken,
    }
    : {
      modelAddedObserved: false, tModelAdded: null, atInvocation: null,
      resolveRootsOutcome: null, atSettlement: null, elapsedMs: null, rejectionError: null,
      readinessGateSufficient: false, modelMatchesReloadToken: null,
    };

  await pageEvaluate(f6Cleanup, { sessionId });

  return {
    ok: true,
    fields: {
      unloadProbeFired: Boolean(unloadSnapshot && unloadSnapshot.unloadProbeFired),
      bindingNullAfterUnload: Boolean(unloadSnapshot && unloadSnapshot.bindingNullAfterUnload),
      reregisteredOk: Boolean(reregisterResult && reregisterResult.reregisteredOk === true),
      lateUnloadHandlerThrew: lateUnloadResult.lateUnloadHandlerThrew,
      bindingSurvivesLateUnload: lateUnloadResult.bindingSurvivesLateUnload,
      modelAfterStillLive: lateUnloadResult.modelAfterStillLive,
      reloadClassifier,
      f3RepeatProbe,
      // Additions beyond the brief's own minimal named-field list, both directly required by
      // the plan's own prose (never invented): `resolveRootsOk` is one of step 6's four named
      // post-condition assertions (plan line 996: "a resolveRoots call against the current
      // binding still succeeds"); `unregisterBeforeEvict` is step 3's own named eviction-
      // ordering check (plan's Failure criteria: "eviction/unregistration ordering differs from
      // the accepted Adapter contract"). Both are load-bearing for scoreF6 below.
      resolveRootsOk: lateUnloadResult.resolveRootsOk,
      unregisterBeforeEvict: unloadSnapshot ? unloadSnapshot.unregisterBeforeEvict : null,
    },
    docLoad, loadDocumentNode: loadDocumentNodeResult,
    unloadSettled, unloadSnapshot, reregisterResult, lateUnloadResult, formatSignals,
  };
}

/**
 * `scoreF6(fields)` -- plan §7.6's exact success/failure criteria, pure, Node-side. `FAIL` iff:
 * the late-unload control DOES disturb `modelAfter`'s binding/liveness/`resolveRoots` (the real
 * stale-event failure mode this whole check exists to catch); eviction/unregistration ordering
 * disagrees with the accepted contract; the reload never reaches `CONFIRMED_SVF2`; the step-7
 * reload probe never fires, rejects, or times out (a probe that never settles is itself a
 * finding, per the plan's own H1 discipline -- never merely "attempted"); the late-unload
 * handler itself threw; or `reregisteredOk`/`unloadProbeFired`/`bindingNullAfterUnload` are
 * false. Fails closed on missing evidence -- a `null`/`undefined` field never silently passes.
 */
function scoreF6(fields) {
  const f = fields || {};
  // Fix round 1 (Stage 7 review): reads F3's own field shape (modelAddedObserved/
  // resolveRootsOutcome), matching plan line 1002's "per §7.3's fields" instruction -- never
  // the prior ad hoc fired/settled/timedOut/entry.outcome wrapper.
  const probeOutcomeOk = Boolean(f.f3RepeatProbe) && f.f3RepeatProbe.modelAddedObserved === true
    && f.f3RepeatProbe.resolveRootsOutcome === 'resolved'
    && f.f3RepeatProbe.modelMatchesReloadToken === true;
  const reloadOk = Boolean(f.reloadClassifier) && f.reloadClassifier.classifier === CLASSIFIER.CONFIRMED_SVF2;
  const lateUnloadOk = f.lateUnloadHandlerThrew === false && f.bindingSurvivesLateUnload === true
    && f.modelAfterStillLive === true && f.resolveRootsOk === true;
  const evictionOrderingOk = f.unregisterBeforeEvict === true;

  const failed = f.unloadProbeFired !== true
    || f.bindingNullAfterUnload !== true
    || f.reregisteredOk !== true
    || !lateUnloadOk
    || !reloadOk
    || !probeOutcomeOk
    || !evictionOrderingOk;

  let reason = null;
  if (failed) {
    if (!lateUnloadOk) reason = 'f6-stale-event-disturbed-modelAfter';
    else if (!evictionOrderingOk) reason = 'f6-eviction-ordering-violated';
    else if (!reloadOk) reason = 'f6-reload-not-confirmed-svf2';
    else if (!probeOutcomeOk) reason = 'f6-reload-probe-did-not-resolve';
    else reason = 'f6-setup-failed';
  }
  return { verdict: failed ? CHECK_VERDICT.FAIL : CHECK_VERDICT.PASS, reason, fields: f };
}

/**
 * `buildStaleOldModelEventControlResult(f6Fields)` -- plan line 674/849/996: `stale-old-model-
 * event` is NOT a new perturbation -- F6's own step 6 (`f6RunLateUnloadControl`, above) already
 * performs exactly this perturbation, in-sequence, as part of the mutating check itself. Its
 * outcome is COPIED, never re-run, into `result.controls['stale-old-model-event']`, via Stage
 * 1's `createControlResult`, so it participates in §6.3's mandatory-control manifest identically
 * to the other eight controls. `restorationRequired` comes from Stage 1's
 * `CONTROL_RESTORATION_REQUIRED['stale-old-model-event']` via `createControlResult` (plan line
 * 849: `true`, cross-checked, never hardcoded here). Nothing is patched by this control (it
 * drives the wiring's own REAL captured handler, per line 849's own state description), so
 * "detected" and "restored" collapse to the SAME oracle: F6 step 6's own four post-assertions.
 */
function buildStaleOldModelEventControlResult(f6Fields) {
  const f = f6Fields || {};
  const executed = f.lateUnloadHandlerThrew !== null && f.lateUnloadHandlerThrew !== undefined;
  if (!executed) {
    return createControlResult('stale-old-model-event', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'f6-late-unload-control-not-executed' });
  }
  const survived = f.lateUnloadHandlerThrew === false && f.bindingSurvivesLateUnload === true
    && f.modelAfterStillLive === true && f.resolveRootsOk === true;
  if (!survived) {
    return createControlResult('stale-old-model-event', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: 'stale-event-disturbed-modelAfter' });
  }
  return createControlResult('stale-old-model-event', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true, reason: null });
}

// ============================================================================================
// STAGE 8 -- Integration slice: real F3-probe install/finalize, the real browser-owned load
// starters, the in-page half of Phase 11 cleanup, `runHarness`, `main()`'s activation interlock,
// and the full §8 evidence-schema validator.
//
// This is where the composition finally gets assembled -- writing launch-capable code here is
// implementation, not live execution (this stage's own brief, second-opinion-confirmed). Every
// real side effect (dynamic `import('playwright')`, a browser launch, any file/network I/O) is
// gated behind the activation interlock in `main()` itself (below); `runHarness` remains fully
// offline-testable via injected `deps`, exactly like every function built in Stages 2-7. NEVER
// invoked with real dependencies anywhere in this stage's own code or tests.
// ============================================================================================

/**
 * In-page, async. Fix wave (final whole-branch review, CRITICAL C1): populates
 * `window.__g1.mod` with the REAL, actually-imported repository modules F1/F2/F4/F5/F7/F8/F6's
 * own in-page functions all read via `g.mod['/path']` -- without this, every one of those
 * `mod['/...']` lookups resolves to `undefined` on a real page, and every check that depends on
 * one (all of them) would throw or misbehave immediately. Mirrors T3's own `INSTALL_T3` pattern
 * exactly (`clashtest-viewer-adapter.acceptance.mjs:180-222`, confirmed by direct source read):
 * one `await import(spec)` per entry point, storing the resulting module namespace into
 * `g.mod[spec]`, using this file's own already-established `SERVED_MODULE_ENTRY_POINTS` list
 * (the exact plan-§5-plus-Stage-8's-own-genuine-gap-fix set) as `specs` -- never a second,
 * independently-maintained list. `/collision/**` resolves through the REAL, already-running,
 * unmodified server (`server.js` already serves it via `express.static('collision')`, confirmed
 * by direct source read -- never a page.route interception for that directory); `/clashtest/**`
 * and `/clashpanel/**` resolve through `main()`'s own synthetic route registrations (below),
 * mirroring T3's own "server.js serves /collision only" comment exactly. Returns a per-spec
 * `{ok, missing, exports}` / `{ok:false, error}` summary (never throws) so a real run's own
 * evidence retains exactly which modules failed to import and why, rather than a single opaque
 * failure.
 */
async function installG1Modules(specs) {
  const g = (window.__g1 = window.__g1 || { closing: false, nextGen: 1, loads: {}, docs: {}, models: {} });
  g.mod = g.mod || {};
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? '') }
    : { primitive: typeof e, value: String(e) });
  const out = {};
  for (const spec of specs || []) {
    try {
      const m = await import(spec);
      g.mod[spec] = m;
      out[spec] = { ok: true, exports: Object.keys(m).sort() };
    } catch (e) {
      out[spec] = { ok: false, error: errOf(e) };
    }
  }
  return out;
}

/**
 * In-page. Plan §7.3/§4.4's real F3 probe: install the `MODEL_ADDED_EVENT` listener
 * IMMEDIATELY after `viewer.start()`, before `Document.load` is ever called. No `sessionId`
 * exists yet at this point (Phase 2.5 has not run) -- state lives in the fixed, singleton
 * `window.__g1.f3Probe` slot (there is only ever one F3 probe per harness run). Reuses the SAME
 * timeline shape/logic `f6InstallReloadProbe` already established for the reload's own repeat
 * of this exact probe (Stage 7) -- kept as an independent, self-contained duplicate per this
 * file's own "in-page function may reference only its own argument and page globals" rule
 * (neither may call the other as a Node-side sibling).
 */
function f3InstallProbe() {
  const g = (window.__g1 = window.__g1 || { closing: false, nextGen: 1, loads: {}, docs: {}, models: {} });
  const viewer = window.__viewer;
  const addedEventName = window.Autodesk && window.Autodesk.Viewing ? window.Autodesk.Viewing.MODEL_ADDED_EVENT : undefined;
  if (!viewer || typeof addedEventName !== 'string' || addedEventName === '') {
    return { ok: false, reason: 'viewer-or-MODEL_ADDED_EVENT-not-available' };
  }
  const errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? '') }
    : { primitive: typeof e, value: String(e) });
  const readFlags = (model) => ({
    isObjectTreeCreated: (() => { try { return model && typeof model.isObjectTreeCreated === 'function' ? model.isObjectTreeCreated() : null; } catch { return null; } })(),
    instanceTreeInData: (() => { try { return model && typeof model.getData === 'function' ? Boolean(model.getData() && model.getData().instanceTree) : null; } catch { return null; } })(),
    isLoadDone: (() => { try { return model && typeof model.isLoadDone === 'function' ? model.isLoadDone() : null; } catch { return null; } })(),
  });

  const probe = {
    modelAddedObserved: false, tModelAdded: null, atInvocation: null,
    resolveRootsOutcome: null, atSettlement: null, elapsedMs: null, rejectionError: null,
    model: null, listener: null, addedEventName, removed: false,
  };
  const listener = (event) => {
    if (probe.modelAddedObserved) return; // only the FIRST MODEL_ADDED_EVENT of the whole run
    probe.modelAddedObserved = true;
    const model = event && event.model !== undefined ? event.model : null;
    probe.model = model;
    probe.tModelAdded = performance.now();
    probe.atInvocation = readFlags(model);
    const mod = g.mod || {};
    const { createViewerElementEnumerator } = mod['/clashtest/viewer/index.js'] || {};
    if (typeof createViewerElementEnumerator !== 'function') {
      probe.resolveRootsOutcome = 'rejected';
      probe.atSettlement = readFlags(model);
      probe.elapsedMs = performance.now() - probe.tModelAdded;
      probe.rejectionError = { name: 'ConfigurationError', message: 'createViewerElementEnumerator not available on window.__g1.mod' };
      return;
    }
    const enumerator = createViewerElementEnumerator();
    const ctx = { checkpoint() {} };
    enumerator.resolveRoots({ model }, 'whole', ctx).then(
      () => {
        probe.resolveRootsOutcome = 'resolved';
        probe.atSettlement = readFlags(model);
        probe.elapsedMs = performance.now() - probe.tModelAdded;
      },
      (err) => {
        probe.resolveRootsOutcome = 'rejected';
        probe.atSettlement = readFlags(model);
        probe.elapsedMs = performance.now() - probe.tModelAdded;
        probe.rejectionError = errOf(err);
      },
    );
  };
  viewer.addEventListener(addedEventName, listener);
  probe.listener = listener;
  g.f3Probe = probe;
  return { ok: true };
}

/** In-page predicate (Stage 2's `pageWaitForFunction` shape). True once F3's own probe has
 * settled (`resolveRootsOutcome` no longer `null`). */
function f3ProbeSettledPredicate() {
  const g = window.__g1;
  return Boolean(g && g.f3Probe && g.f3Probe.resolveRootsOutcome !== null);
}

/**
 * In-page. Plan §7.3's own "Phase 3 (F3 finalize)... removes the listener immediately" --
 * removes F3's listener NOW (not at Phase 11), reads out F3's own exact field shape (plan line
 * 929 -- the SAME shape `scoreF3Readiness` already consumes and `f6FinalizeReloadProbe` already
 * produces for the reload's own repeat of this probe, Stage 7). `timedOut` (from the Node-side
 * orchestrator's own bounded-wait outcome) assigns `resolveRootsOutcome = 'timed-out'` when the
 * probe never settled on its own -- mirrors `f6FinalizeReloadProbe` exactly.
 */
function f3FinalizeProbe({ timedOut = false } = {}) {
  const g = window.__g1;
  if (!g || !g.f3Probe) return { ok: false, reason: 'f3-probe-not-installed' };
  const probe = g.f3Probe;
  if (!probe.removed) {
    window.__viewer.removeEventListener(probe.addedEventName, probe.listener);
    probe.removed = true;
  }
  if (probe.resolveRootsOutcome === null && timedOut === true) {
    probe.resolveRootsOutcome = 'timed-out';
  }
  return {
    ok: true,
    modelAddedObserved: probe.modelAddedObserved,
    tModelAdded: probe.tModelAdded,
    atInvocation: probe.atInvocation,
    resolveRootsOutcome: probe.resolveRootsOutcome,
    atSettlement: probe.atSettlement,
    elapsedMs: probe.elapsedMs,
    rejectionError: probe.rejectionError,
  };
}

/**
 * In-page. Plan §6.4a's real `Document.load` starter -- the concrete implementation
 * `startLoad({..., starter: documentLoadStarter, ...})` calls via `pageEvaluate`. Reuses Stage
 * 2's own already-built record/transition machinery verbatim
 * (`createLoadRecord`/`onDeadline`/`onSuccess`/`onError`/`readLoadRecordSnapshot`/`pageErrOf`,
 * all in the SAME lexical bundle, per this file's own "in-page function may reference only its
 * own argument and page globals" rule -- sibling in-page functions are the one documented
 * exception, per the Stage-2 "BUNDLING NOTE" comment). Mirrors `wwwroot/viewer.js`'s own
 * REAL, already-reviewed, production `Document.load` call shape exactly
 * (`Autodesk.Viewing.Document.load('urn:'+urn, onSuccess, onFailure)`) -- confirmed by direct
 * source read, never guessed. Resolves once the record reaches a terminal status (via the
 * success/error callback settling it, OR the deadline timer firing) -- whichever comes first;
 * a Promise only ever settles once, so a later race arrival is a harmless no-op resolve.
 */
function documentLoadStarter({ tokenId, urn, loadTimeoutMs }) {
  const g = (window.__g1 = window.__g1 || { closing: false, nextGen: 1, loads: {}, docs: {}, models: {} });
  const gen = g.nextGen++;
  const record = createLoadRecord(tokenId, 'Document.load', gen, performance.now() + loadTimeoutMs);
  return new Promise((resolve) => {
    record.timer = setTimeout(() => {
      onDeadline(tokenId, gen);
      resolve(readLoadRecordSnapshot(tokenId));
    }, loadTimeoutMs);
    try {
      window.Autodesk.Viewing.Document.load(
        `urn:${urn}`,
        (doc) => { onSuccess(tokenId, gen, doc); resolve(readLoadRecordSnapshot(tokenId)); },
        (code, message, errors) => { onError(tokenId, gen, pageErrOf({ name: 'DocumentLoadError', message: String(message ?? ''), code, reason: errors })); resolve(readLoadRecordSnapshot(tokenId)); },
      );
    } catch (e) {
      onError(tokenId, gen, pageErrOf(e));
      resolve(readLoadRecordSnapshot(tokenId));
    }
  });
}

/**
 * In-page. Plan §6.4a's real `loadDocumentNode` starter, the second half of `startLoad`'s own
 * two-call sequence (Document.load -> loadDocumentNode). `docTokenId` names the PRIOR
 * `Document.load` token whose resulting `Document` this reads from `window.__g1.docs`. Mirrors
 * `wwwroot/viewer.js`'s own real, production `loadDocumentNode` call shape exactly
 * (`viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), options)`) -- confirmed
 * by direct source read.
 */
function loadDocumentNodeStarter({ tokenId, docTokenId, loadTimeoutMs }) {
  const g = (window.__g1 = window.__g1 || { closing: false, nextGen: 1, loads: {}, docs: {}, models: {} });
  const gen = g.nextGen++;
  const record = createLoadRecord(tokenId, 'loadDocumentNode', gen, performance.now() + loadTimeoutMs);
  return new Promise((resolve) => {
    record.timer = setTimeout(() => {
      onDeadline(tokenId, gen);
      resolve(readLoadRecordSnapshot(tokenId));
    }, loadTimeoutMs);
    const doc = g.docs[docTokenId];
    if (!doc) {
      onError(tokenId, gen, pageErrOf({ name: 'LoadDocumentNodeError', message: 'no Document found for docTokenId' }));
      resolve(readLoadRecordSnapshot(tokenId));
      return;
    }
    try {
      Promise.resolve(window.__viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), {})).then(
        (model) => { onSuccess(tokenId, gen, model); resolve(readLoadRecordSnapshot(tokenId)); },
        (err) => { onError(tokenId, gen, pageErrOf(err)); resolve(readLoadRecordSnapshot(tokenId)); },
      );
    } catch (e) {
      onError(tokenId, gen, pageErrOf(e));
      resolve(readLoadRecordSnapshot(tokenId));
    }
  });
}

/**
 * In-page. The page-owned half of Phase 11 cleanup (plan §4.3's 22-step ledger) -- resolves the
 * cleanup-ownership hand-off Stage 4 flagged and no stage closed until now: `world`/`registry`/
 * `model` are page-owned (`setupSharedSessionResources`'s own doc comment: "Node never learns
 * about this in-page-only world/registry otherwise"), so Node-side `runCleanup` (Stage 2,
 * frozen, unmodified by this fix) can never be handed live references to them. codex-advisor
 * consult (Stage 8, high effort, before implementation) confirmed: split cleanup by REALM (this
 * function handles the page-owned steps; Node-side `runCleanup` is called separately, restricted
 * to ONLY the genuinely Node-owned steps -- see `runHarness`'s own Phase 11, below) AND by
 * PHASE (browser-owned load-record sealing/draining and Node timer/controller cleanup happen
 * BEFORE this call; page/context/browser close happen strictly AFTER it, regardless of this
 * call's own outcome).
 *
 * Covers the 13 page-owned steps of `runCleanup`'s own 22-name ledger (`CLEANUP_STEP_NAMES`):
 * `removeF3Listeners`, `removeF6ProbeListener`, `removeF6ReloadProbeListener`,
 * `disposeF6Wiring`, `restoreAllControlPatches`, `unloadModelBeforeFromViewer`,
 * `unloadModelAfterFromViewer`, `unregisterModelBefore`, `unregisterModelAfter`,
 * `evictModelBefore`, `evictModelAfter`, `disposeWorld`, `verifyViewerModelSetEmpty` -- using the
 * SAME step names, the SAME guard/try-catch-per-step structure, and the SAME postcondition-based
 * (never "the action threw alone") unresolved-ownership determination `runCleanup` itself already
 * established, per the consult's own explicit instruction not to duplicate its entire ledger
 * design, only its per-step semantics for the subset that must run in this realm.
 *
 * `restoreAllControlPatches` (Task 10, bounded completion pass, area 3 shared foundation) is now
 * REAL here -- Phase 11's own fallback restoration for a control whose own `finally` restoration
 * already failed (e.g. an outer-watchdog-timed-out control, `runBridgedControl`/
 * `runControlSafely`'s own `sessionTainted` path, below), driven entirely by
 * `session.activeControl.patches` (`acquireControlLease`/`recordControlPatch`, above) -- the
 * SAME generic, patch-shape-agnostic mechanism every one of the six controls' own bridged in-page
 * handlers (Tasks 11/12) will use, never a control-specific restoration written here. Was
 * previously deliberately deferred (recorded as `'not-applicable-this-stage'`, per this file's
 * own "never a missing object" discipline, plan §8) until this shared foundation existed --
 * PRECISELY what this task closes; a stub comment claiming this is still out of scope would now
 * be stale, so it is removed, not left behind. `runCleanup`'s OWN, separate, Node-side
 * `restoreAllControlPatches` step (`~line 1552`, operating on `resources.controlPatches`, the
 * OLD pre-realm-split Node-side-live-object design) is untouched by this task and stays
 * permanently `'skipped'` in real wiring (`nodeCleanupResources` never includes
 * `controlPatches`, `runHarness`'s own doc comment) -- `mergedStepStatus = {...nodeCleanup.
 * stepStatus, ...pageCleanup.stepStatus}` (`runHarness`, Phase 11) makes THIS function's own
 * real result for the shared ledger name `restoreAllControlPatches` authoritative, exactly like
 * the other 12 already-real page-owned steps (second, task-sanity-check codex-advisor consult,
 * request 20260928-180527-75769-27344, finding 2: confirmed this is the correct name/ownership
 * resolution, not a new/differently-named step).
 */
function runInPageResourceCleanup({ sessionId }) {
  const g = window.__g1;
  const session = g && g.sessions && g.sessions[sessionId];
  const stepStatus = {};
  const cleanupFailures = [];
  let cleanupUnresolvedOwnership = false;

  const step = (name, guard, fn, { checkOwnership } = {}) => {
    let shouldRun;
    try {
      shouldRun = Boolean(guard());
    } catch (e) {
      stepStatus[name] = 'threw';
      cleanupFailures.push({ step: name, error: { name: e && e.name, message: e ? String(e.message ?? '') : null } });
      if (checkOwnership && checkOwnership()) cleanupUnresolvedOwnership = true;
      return;
    }
    if (!shouldRun) { stepStatus[name] = 'skipped'; return; }
    try {
      fn();
      stepStatus[name] = 'ran';
    } catch (e) {
      stepStatus[name] = 'threw';
      cleanupFailures.push({ step: name, error: { name: e && e.name, message: e ? String(e.message ?? '') : null } });
    }
    // Postcondition-based ownership check -- ALWAYS re-checked after a 'ran' attempt too, never
    // only on a throw (codex-advisor consult finding #3: "action threw but the final
    // postcondition is clean" must NOT set cleanupUnresolvedOwnership; the converse -- action
    // reported success but the postcondition still fails -- must).
    if (checkOwnership && checkOwnership()) cleanupUnresolvedOwnership = true;
  };

  // F3's own listener is session-independent (installed before any session exists) -- fallback
  // removal is attempted regardless of whether a session was ever published.
  step('removeF3Listeners',
    () => Boolean(g && g.f3Probe && g.f3Probe.listener && g.f3Probe.removed === false),
    () => { window.__viewer.removeEventListener(g.f3Probe.addedEventName, g.f3Probe.listener); g.f3Probe.removed = true; },
    { checkOwnership: () => Boolean(g && g.f3Probe && g.f3Probe.removed === false) });

  if (!session) {
    stepStatus.removeF6ProbeListener = 'skipped';
    stepStatus.removeF6ReloadProbeListener = 'skipped';
    stepStatus.disposeF6Wiring = 'skipped';
    stepStatus.unloadModelBeforeFromViewer = 'skipped';
    stepStatus.unloadModelAfterFromViewer = 'skipped';
    stepStatus.unregisterModelBefore = 'skipped';
    stepStatus.unregisterModelAfter = 'skipped';
    stepStatus.evictModelBefore = 'skipped';
    stepStatus.evictModelAfter = 'skipped';
    stepStatus.disposeWorld = 'skipped';
    stepStatus.verifyViewerModelSetEmpty = 'skipped';
    // Task 10: no session means no `session.activeControl` could ever have existed -- genuinely
    // 'skipped' (nothing to restore), not the old 'not-applicable-this-stage' stub, which is now
    // stale (the mechanism this step needs is fully implemented below, for the session-exists
    // path).
    stepStatus.restoreAllControlPatches = 'skipped';
    return { ok: true, stepStatus, cleanupFailures, cleanupUnresolvedOwnership };
  }

  const { world, registry, model: modelBefore, K: registryKey } = session;
  const f6Ran = Boolean(session.f6 && session.f6.modelAfter);
  const modelAfter = f6Ran ? session.f6.modelAfter : null;
  const viewer = window.__viewer;

  step('removeF6ProbeListener',
    () => Boolean(session.f6 && session.f6.probeListener && session.f6.probeListener.removed === false),
    () => { viewer.removeEventListener(session.f6.probeListener.eventName, session.f6.probeListener.fn); session.f6.probeListener.removed = true; },
    { checkOwnership: () => Boolean(session.f6 && session.f6.probeListener && session.f6.probeListener.removed === false) });

  step('removeF6ReloadProbeListener',
    () => Boolean(session.f6 && session.f6.reloadProbe && session.f6.reloadProbe.listener && session.f6.reloadProbe.removed === false),
    () => { viewer.removeEventListener(session.f6.reloadProbe.addedEventName, session.f6.reloadProbe.listener); session.f6.reloadProbe.removed = true; },
    { checkOwnership: () => Boolean(session.f6 && session.f6.reloadProbe && session.f6.reloadProbe.removed === false) });

  step('disposeF6Wiring',
    () => Boolean(session.f6 && session.f6.wiringRef && session.f6.wiringRef.disposed === false && typeof session.f6.dispose === 'function'),
    () => session.f6.dispose(),
    { checkOwnership: () => Boolean(session.f6 && session.f6.wiringRef && session.f6.wiringRef.disposed === false) });

  // Task 10 (bounded completion pass, area 3 shared foundation): last-resort fallback for a
  // control that never reached its own `finally` restoration (the outer-watchdog-timeout case
  // `runBridgedControl`/`runControlSafely`'s `sessionTainted` path exists for, below) --
  // `session.activeControl` is this function's ONLY source of truth for what a control patched,
  // per `acquireControlLease`/`recordControlPatch`, above. Second codex-advisor consult (task
  // sanity check, request 20260928-180527-75769-27344), finding 4, all adopted:
  //  - restore EVERY recorded patch, most-recent-first (reverse order, in case of any dependency
  //    between patches), even if an earlier one in this same pass fails -- one failure must never
  //    prevent an attempt on the rest;
  //  - before overwriting, confirm the CURRENT descriptor still matches the recorded
  //    `installedDescriptor` -- never blindly clobber a legitimate external change made to the
  //    same property after this patch was installed;
  //  - after attempting restoration, re-read and confirm the descriptor now matches
  //    `originalDescriptor` -- "postcondition, never just no-throw" (this function's own
  //    established discipline: a sloppy-mode `delete` of a non-configurable property silently
  //    no-ops rather than throwing, so a bare try/catch around it would falsely report success);
  //  - clear `session.activeControl` (release the lease) ONLY once every patch is confirmed
  //    restored -- a partial restoration must never look "done".
  //
  // codex-review (code, high effort, Task 10's own pre-commit review pass) Important #4, fixed:
  // the ORIGINAL guard (`patches.length > 0`) silently reported 'skipped' + left
  // `cleanupUnresolvedOwnership` false for an `activeControl` that was acquired but never
  // recorded a single patch (e.g. a control that hung/timed-out BETWEEN acquiring its lease and
  // its first `recordControlPatch` call) -- reproduced directly by the review: the lease stayed
  // held, invisibly, forever. The lease itself (not "did it record >=1 patch") is now the guard
  // AND the postcondition: an outer-watchdog timeout only stops NODE from waiting -- it does NOT
  // prove the in-page control actually stopped executing (the original codex-advisor consult's
  // own finding 2: "a synchronous infinite loop or crashed page cannot be repaired by any
  // JavaScript finally"), so a lease with zero patches could still belong to code that is
  // genuinely still running concurrently with this very cleanup pass and could mutate shared
  // state (or call `recordControlPatch`) AFTER this step returns -- fail closed, never silently
  // "nothing to do" here. This also makes `checkOwnership` strictly simpler AND more robust:
  // "is a lease still held" is exactly the invariant the action itself maintains (it clears
  // `session.activeControl` if and only if every patch was verified restored), so re-deriving
  // "unresolved" from a per-patch descriptor re-scan was redundant -- removed in favor of this
  // single, harder-to-drift-from-the-action postcondition.
  const descriptorsEqual = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.value === b.value && a.get === b.get && a.set === b.set
      && a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
  };
  step('restoreAllControlPatches',
    () => Boolean(session.activeControl),
    () => {
      const patches = Array.isArray(session.activeControl.patches) ? session.activeControl.patches : [];
      if (patches.length === 0) {
        throw new Error('restoreAllControlPatches: an active control lease was left held with zero recorded patches -- cannot confirm the control never mutated shared state outside the tracked patch mechanism; the lease is NOT released');
      }
      const failures = [];
      for (let i = patches.length - 1; i >= 0; i -= 1) {
        const { target, property, originalDescriptor, installedDescriptor } = patches[i];
        try {
          const current = Object.getOwnPropertyDescriptor(target, property) || null;
          if (!descriptorsEqual(current, installedDescriptor)) {
            throw new Error(`restoreAllControlPatches: '${property}' no longer matches its recorded installed patch -- refusing to overwrite`);
          }
          if (originalDescriptor) Object.defineProperty(target, property, originalDescriptor);
          else delete target[property];
          const after = Object.getOwnPropertyDescriptor(target, property) || null;
          if (!descriptorsEqual(after, originalDescriptor)) {
            throw new Error(`restoreAllControlPatches: '${property}' restoration did not take effect`);
          }
        } catch (e) {
          failures.push(e);
        }
      }
      if (failures.length === 0) session.activeControl = null;
      if (failures.length > 0) {
        throw new Error(`restoreAllControlPatches: ${failures.length} patch(es) failed to restore`);
      }
    },
    { checkOwnership: () => Boolean(session.activeControl) });

  step('unloadModelBeforeFromViewer',
    () => Boolean(viewer && modelBefore && viewer.getAllModels().includes(modelBefore)),
    () => viewer.unloadModel(modelBefore));

  step('unloadModelAfterFromViewer',
    () => Boolean(f6Ran && viewer && modelAfter && viewer.getAllModels().includes(modelAfter)),
    () => viewer.unloadModel(modelAfter));

  step('unregisterModelBefore',
    () => Boolean(registry && modelBefore),
    () => registry.unregister(modelBefore),
    { checkOwnership: () => Boolean(registry && registry.bindingFor(registryKey) != null) });

  step('unregisterModelAfter',
    () => Boolean(f6Ran && registry && modelAfter),
    () => registry.unregister(modelAfter),
    { checkOwnership: () => Boolean(registry && registry.bindingFor(registryKey) != null) });

  step('evictModelBefore',
    () => Boolean(world && modelBefore && world.isModelLive(modelBefore)),
    () => world.evictModel(modelBefore),
    { checkOwnership: () => Boolean(world && world.isModelLive(modelBefore)) });

  step('evictModelAfter',
    () => Boolean(f6Ran && world && modelAfter && world.isModelLive(modelAfter)),
    () => world.evictModel(modelAfter),
    { checkOwnership: () => Boolean(world && world.isModelLive(modelAfter)) });

  step('disposeWorld',
    () => Boolean(world),
    () => world.dispose());

  // Fix round 1 (Stage 8 review, CRITICAL): `checkOwnership: () => true` was ported unchanged
  // from Stage 2's own runCleanup, where it was safe ONLY because THAT file's own step() helper
  // calls checkOwnership exclusively on a throw path. THIS function's own step() helper (above)
  // deliberately calls checkOwnership UNCONDITIONALLY, on both 'ran' and 'threw' outcomes --
  // per this very stage's own codex-advisor consult finding #3 ("action reported success but
  // the postcondition still fails" must ALSO be caught, never only "the action threw"). Under
  // that unconditional semantics, a bare `() => true` fires on every SUCCESSFUL run too,
  // unconditionally forcing cleanupUnresolvedOwnership = true -- making computeOverall's branch
  // 1 fire on every run that reaches Phase 2.5 regardless of how clean the fixture actually is,
  // making PASS structurally unreachable. Fixed: checkOwnership now genuinely RE-CHECKS the
  // same postcondition the step's own action already checks (models still contains
  // modelBefore/modelAfter), mirroring every other step's own checkOwnership pattern in this
  // function -- true only when the postcondition ACTUALLY still fails, never unconditionally.
  const modelSetStillNotEmpty = () => {
    const models = viewer ? viewer.getAllModels() : [];
    const stillHasBefore = modelBefore != null && models.includes(modelBefore);
    const stillHasAfter = f6Ran && modelAfter != null && models.includes(modelAfter);
    return stillHasBefore || stillHasAfter;
  };
  step('verifyViewerModelSetEmpty',
    () => true,
    () => {
      if (modelSetStillNotEmpty()) {
        const models = viewer ? viewer.getAllModels() : [];
        const stillHasBefore = modelBefore != null && models.includes(modelBefore);
        const stillHasAfter = f6Ran && modelAfter != null && models.includes(modelAfter);
        throw new Error(`verifyViewerModelSetEmpty: viewer.getAllModels() still contains ${[stillHasBefore && 'modelBefore', stillHasAfter && 'modelAfter'].filter(Boolean).join(' and ')}`);
      }
    },
    { checkOwnership: modelSetStillNotEmpty });

  // Task 10: `restoreAllControlPatches` is now a real step (above, run right after
  // `disposeF6Wiring`, matching `CLEANUP_STEP_NAMES`'s own canonical order) -- `stepStatus` is
  // already fully populated by its own `step()` call; no placeholder needed here any more.

  return { ok: true, stepStatus, cleanupFailures, cleanupUnresolvedOwnership };
}

// ------------------------------------------------------------------------------------------
// Bounded completion pass, area 3 -- control-bridging SHARED FOUNDATION, Node-side half
// (deliverable 3, Task 10 brief). See the banner comment above `recordControlPatch` (this file,
// after `setupSharedSessionResources`) for the full "why".
// ------------------------------------------------------------------------------------------

/**
 * Node-side, pure. `mapControlAttemptOutcome(controlName, {detected, restored, timedOut, reason})`
 * -- deliverable 3 (Task 10 brief). The ONE generic state-derivation rule every one of the six
 * existing Node-side `run*Control` functions above already encodes inline (`if (timedOut)
 * TIMED_OUT; else if (!detected) NOT_DETECTED; else if (!restored) RESTORE_FAILED; else
 * DETECTED_RESTORED` -- confirmed identical in shape across all six by direct read), written ONCE
 * here so Tasks 11/12's own bridged in-page ports never re-duplicate it per control.
 *
 * Deliberately NEVER produces `NOT_EXECUTABLE` -- per the brief's own explicit ownership split,
 * confirmed by the second (task-sanity-check) codex-advisor consult (request
 * 20260928-180527-75769-27344), finding 3: an in-page precondition failure is reported by the
 * in-page function itself returning `{ok: false, reason}` BEFORE ever attempting a mutation --
 * `runBridgedControl` (below) maps THAT directly to `NOT_EXECUTABLE`, never routing it through
 * this function. This function's own input is only ever the `{detected, restored, timedOut}`
 * triple from an attempt that genuinely ran (`{ok: true, ...}`).
 */
function mapControlAttemptOutcome(controlName, { detected, restored, timedOut, reason = null } = {}) {
  let state;
  if (timedOut) state = CONTROL_STATE.TIMED_OUT;
  else if (!detected) state = CONTROL_STATE.NOT_DETECTED;
  else if (!restored) state = CONTROL_STATE.RESTORE_FAILED;
  else state = CONTROL_STATE.DETECTED_RESTORED;

  return createControlResult(controlName, {
    state,
    executed: true,
    detected: timedOut ? null : Boolean(detected),
    restored: timedOut ? null : Boolean(restored),
    reason,
  });
}

/**
 * Node-side. `runBridgedControl({pageEvaluate, controlName, inPageFn, arg, innerTimeoutMs,
 * outerTimeoutMs = innerTimeoutMs * 3})` -- deliverable 3 (Task 10 brief). The ONE generic
 * Node-side wrapper every one of the six mandatory browser-realm controls (Tasks 11/12) reuses
 * identically -- never control-specific logic baked in here.
 *
 * `arg` is merged with `innerTimeoutMs` before being handed to `inPageFn` (as `{...arg,
 * innerTimeoutMs}`): every bridged in-page control function (Tasks 11/12) races ITS OWN
 * observation against `innerTimeoutMs` via an in-page timer, so its OWN `finally` (restoration)
 * always completes BEFORE a `TIMED_OUT` outcome is ever returned -- exactly the property the
 * original consult's finding 2 requires, and what makes `raw.timedOut === true` a LEGITIMATE,
 * restoration-attempted result, categorically different from this wrapper's own OUTER timeout,
 * below. (The in-page realm cannot call this file's own Node-side `withControlTimeout` directly
 * -- each bridged handler reimplements the identical small race inline, matching this file's own
 * established "every in-page function stays independently reconstructable, never importing a
 * Node-side helper across the realm boundary" discipline.)
 *
 * Races `pageEvaluate(inPageFn, {...arg, innerTimeoutMs})` against `outerTimeoutMs` via
 * `withControlTimeout` (this file's own existing Node-side timeout primitive -- reused verbatim,
 * never a second one). `outerTimeoutMs` should be strictly greater than `innerTimeoutMs` (default
 * `innerTimeoutMs * 3`) so the in-page race above has a genuine chance to settle first.
 *
 * On the OUTER timeout firing (the in-page call never settled within `outerTimeoutMs` -- the page
 * may be hung, wedged, or the transport itself lost): rejects with a specially-tagged error
 * (`Object.assign(new Error('outer-watchdog-timeout'), {outerWatchdogTimeout: true,
 * controlName})`) -- NEVER silently downgraded to an ordinary `TIMED_OUT` `ControlResult` at this
 * layer; the caller (`runControlSafely`, `runHarness`, below) is what turns this into a
 * `ControlResult` AND taints the session, since only it has `sessionTainted` in scope.
 *
 * On the in-page call resolving normally: `raw.ok === false` (a precondition failure BEFORE any
 * mutation was ever attempted) maps directly to a `NOT_EXECUTABLE` `ControlResult`, `raw.reason`
 * carried through. `raw.ok === true` (an attempt genuinely ran) is handed to the pure
 * `mapControlAttemptOutcome`, above. Any other shape (`raw` falsy, `raw.ok` neither `true` nor
 * `false`) is treated as `NOT_EXECUTABLE{reason: 'malformed-in-page-result'}` -- fail-closed,
 * never assumed successful.
 */
async function runBridgedControl({ pageEvaluate, controlName, inPageFn, arg = {}, innerTimeoutMs, outerTimeoutMs = innerTimeoutMs * 3 }) {
  let raw;
  try {
    raw = await withControlTimeout(pageEvaluate(inPageFn, { ...arg, innerTimeoutMs }), outerTimeoutMs);
  } catch (e) {
    if (e && e.controlTimeout) {
      throw Object.assign(new Error('outer-watchdog-timeout'), { outerWatchdogTimeout: true, controlName });
    }
    throw e;
  }

  if (!raw || typeof raw.ok !== 'boolean') {
    return createControlResult(controlName, { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'malformed-in-page-result' });
  }
  if (raw.ok === false) {
    return createControlResult(controlName, { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: raw.reason || 'precondition-unmet' });
  }
  // codex-review (code, high effort, Task 10's own pre-commit review pass) Critical #1: `raw.ok
  // === true` alone is NOT enough to trust `raw.detected`/`raw.restored`/`raw.timedOut` -- both
  // `mapControlAttemptOutcome`'s own branching AND `createControlResult`'s own field-expectation
  // validation use TRUTHINESS (`!detected`/`Boolean(detected)`), so a serialization bug or a
  // buggy future bridged control (Tasks 11/12) that accidentally hands back STRING booleans
  // (e.g. `{detected: "false", restored: "false", timedOut: false}`, plausible if a control
  // stringifies its own raw values before returning) would silently produce a false
  // `DETECTED_RESTORED` -- reproduced directly by the review. Strictly type-check every field
  // BEFORE ever reaching the outcome mapper; malformed booleans are `NOT_EXECUTABLE`, never
  // coerced. `timedOut` MUST be a real boolean too (never merely present) -- this is the runtime
  // boundary between untrusted cross-realm page data and this file's own typed `ControlResult`
  // contract, so it belongs HERE, not inside the pure `mapControlAttemptOutcome` (which is
  // documented as trusting its own caller's contract, matching this file's established
  // "validate at the realm boundary, trust internally" discipline).
  if (typeof raw.detected !== 'boolean' || typeof raw.restored !== 'boolean' || typeof raw.timedOut !== 'boolean') {
    return createControlResult(controlName, { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'malformed-in-page-result' });
  }
  return mapControlAttemptOutcome(controlName, raw);
}

// ------------------------------------------------------------------------------------------
// Bounded completion pass, area 3 -- Task 11: bridged tree-unavailable/wrong-owner/hidden-
// fragment controls, NODE-SIDE half. One thin wrapper-factory per control, each returning the
// `(ctx) => runBridgedControl({...})` shape `runHarness`'s own `runControlSafely` already calls
// as `fn({controlTimeoutMs})` (unchanged, this file's existing `controls.treeUnavailable`/
// `wrongOwner`/`hiddenFragment` call sites, above). `sessionId`/`tokenId`/`gen` are bound via
// CLOSURE at factory-construction time (never read from `ctx`, which only ever carries
// `controlTimeoutMs`) -- `runHarness` itself only establishes `sessionId` dynamically, inside
// its own Phase 2.5, so a real wiring caller must build these closures once that value is known.
// Task 13 (bounded completion pass, area 3 final integration): `main()`'s own `buildRealControls`
// (below `runHarness`) is that real wiring caller -- it rebuilds each of these factories fresh on
// every control invocation, reading `sessionId`/`tokenId`/`gen` off the `ctx` `runHarness` itself
// passes through (see `runControlSafely`'s own doc comment). These factory functions themselves
// are UNCHANGED by Task 13 -- still closure-bound, never reading from `ctx` directly.
// ------------------------------------------------------------------------------------------

/** Node-side. `buildTreeUnavailableControlDep({pageEvaluate, sessionId, tokenId, gen})` -- see
 * the banner above. Wired into `main()`'s real `deps.controls` via `buildRealControls` (Task 13,
 * below `runHarness`). */
function buildTreeUnavailableControlDep({ pageEvaluate, sessionId, tokenId, gen }) {
  return (ctx) => runBridgedControl({
    pageEvaluate,
    controlName: 'tree-unavailable',
    inPageFn: treeUnavailableControlInPage,
    arg: { sessionId, tokenId, gen, controlId: 'tree-unavailable' },
    innerTimeoutMs: ctx.controlTimeoutMs,
  });
}

/** Node-side. `buildWrongOwnerControlDep({pageEvaluate, sessionId, tokenId, gen})` -- see the
 * banner above. Wired into `main()`'s real `deps.controls` via `buildRealControls` (Task 13). */
function buildWrongOwnerControlDep({ pageEvaluate, sessionId, tokenId, gen }) {
  return (ctx) => runBridgedControl({
    pageEvaluate,
    controlName: 'wrong-owner',
    inPageFn: wrongOwnerControlInPage,
    arg: { sessionId, tokenId, gen, controlId: 'wrong-owner' },
    innerTimeoutMs: ctx.controlTimeoutMs,
  });
}

/** Node-side. `buildHiddenFragmentControlDep({pageEvaluate, sessionId, tokenId, gen})` -- see
 * the banner above. Wired into `main()`'s real `deps.controls` via `buildRealControls` (Task 13). */
function buildHiddenFragmentControlDep({ pageEvaluate, sessionId, tokenId, gen }) {
  return (ctx) => runBridgedControl({
    pageEvaluate,
    controlName: 'hidden-fragment',
    inPageFn: hiddenFragmentControlInPage,
    arg: { sessionId, tokenId, gen, controlId: 'hidden-fragment' },
    innerTimeoutMs: ctx.controlTimeoutMs,
  });
}

// ------------------------------------------------------------------------------------------
// Bounded completion pass, area 3 -- Task 12: bridged capacity-breach/invalid-bounds/bounds-
// beyond-tolerance controls, NODE-SIDE half. Same wrapper-factory shape Task 11 established
// (closure-bound `sessionId`/`tokenId`/`gen`, `(ctx) => Promise<ControlResult>`). Task 13: all
// three wired into `main()`'s real `deps.controls` via `buildRealControls` (below `runHarness`),
// same mechanism as Task 11's three above -- unchanged by this task.
// ------------------------------------------------------------------------------------------

/** Node-side. `buildCapacityBreachControlDep({pageEvaluate, sessionId, tokenId, gen,
 * capacityLimit = maxCollisionInstancesPerEpoch})` -- see the banner above.
 * `capacityLimit` defaults to the REAL, imported (this file's own top-of-file import)
 * `maxCollisionInstancesPerEpoch` -- a plain JSON-safe number, threaded through to
 * `capacityBreachControlInPage`'s own arg so its perturbation always tracks the real constant,
 * never a hardcoded in-page duplicate (codex-review fix, see `capacityBreachControlInPage`'s own
 * doc comment for the full reasoning). Wired into `main()`'s real `deps.controls` via
 * `buildRealControls` (Task 13). */
function buildCapacityBreachControlDep({ pageEvaluate, sessionId, tokenId, gen, capacityLimit = maxCollisionInstancesPerEpoch }) {
  return (ctx) => runBridgedControl({
    pageEvaluate,
    controlName: 'capacity-breach',
    inPageFn: capacityBreachControlInPage,
    arg: { sessionId, tokenId, gen, controlId: 'capacity-breach', capacityLimit },
    innerTimeoutMs: ctx.controlTimeoutMs,
  });
}

/**
 * Node-side. `buildInvalidBoundsControlDep({pageEvaluate, sessionId, tokenId, gen,
 * primaryF7Fields})` -- unlike every other bridged control's wrapper factory, this one needs
 * `primaryF7Fields` (F7's own real, already-computed `fields`, e.g. `checks.F7.fields` --
 * `runHarness`'s own job, Task 13, to supply) to select `targetDbId` -- the original Node-side
 * `runInvalidBoundsControl`'s own doc comment: "any censused dbId qualifies", so the LOWEST
 * sorted censused dbId (`primaryF7Fields.censusedDbIds[0]` -- `observeF7`'s own `censusedDbIds`
 * field is already sorted ascending, confirmed by direct read, above) is a reasonable,
 * deterministic choice, documented here per the brief's own explicit instruction to do so.
 * `targetDbId` selection happens ENTIRELY Node-side, before the page is ever entered -- if no
 * censused dbId exists at all, short-circuits to `NOT_EXECUTABLE{reason:'precondition-unmet'}`
 * without acquiring a lease, matching the ORIGINAL Node-side function's own precondition-check
 * shape (`targetDbId === undefined || targetDbId === null` -> `'precondition-unmet'`).
 */
function buildInvalidBoundsControlDep({ pageEvaluate, sessionId, tokenId, gen, primaryF7Fields }) {
  const censused = (primaryF7Fields && Array.isArray(primaryF7Fields.censusedDbIds)) ? primaryF7Fields.censusedDbIds : [];
  const targetDbId = censused.length > 0 ? censused[0] : null;
  return (ctx) => {
    if (targetDbId === null) {
      return Promise.resolve(createControlResult('invalid-bounds', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'precondition-unmet' }));
    }
    return runBridgedControl({
      pageEvaluate,
      controlName: 'invalid-bounds',
      inPageFn: invalidBoundsControlInPage,
      arg: { sessionId, tokenId, gen, controlId: 'invalid-bounds', targetDbId },
      innerTimeoutMs: ctx.controlTimeoutMs,
    });
  };
}

/**
 * Node-side. `buildBoundsBeyondToleranceControlDep({pageEvaluate, sessionId, tokenId, gen,
 * primaryF7Fields})` -- calls `selectBoundsBeyondToleranceTarget(primaryF7Fields)` (above,
 * unchanged, pure, Node-side) FIRST; if it returns `null`, short-circuits immediately to
 * `NOT_EXECUTABLE{reason:'perturbation-not-representable'}` WITHOUT ever entering the page
 * (matching the original's own early-exit -- no lease needed if there's nothing to perturb, per
 * the brief's own explicit instruction). If a target IS selected, ALSO computes the
 * `refMin_a`/`nodeMin_a`/`S_a`/`delta` representability math here, Node-side (identical
 * arithmetic to the original Node-side `runBoundsBeyondToleranceControl`'s own upfront checks,
 * below) -- this is pure math over `primaryF7Fields`, needs no live page/model access, so doing
 * it here (rather than inside the in-page function) lets an unrepresentable perturbation
 * short-circuit before any lease is ever acquired too, and keeps what crosses the realm boundary
 * to the bare minimum (`targetDbId`/`axisIndex`/`delta`/`nodeBoxPrimary` -- see
 * `boundsBeyondToleranceControlInPage`'s own doc comment for the full reasoning).
 */
function buildBoundsBeyondToleranceControlDep({ pageEvaluate, sessionId, tokenId, gen, primaryF7Fields }) {
  return (ctx) => {
    const target = selectBoundsBeyondToleranceTarget(primaryF7Fields);
    if (!target) {
      return Promise.resolve(createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' }));
    }
    const { dbId: targetDbId, axis } = target;
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const f = primaryF7Fields || {};
    const refBox = f.fragmentBoundsUnion && f.fragmentBoundsUnion[targetDbId];
    const nodeBoxPrimary = f.elementWorldBounds && f.elementWorldBounds[targetDbId];
    const S_a = f.boundsScalePerDbId && f.boundsScalePerDbId[targetDbId]
      && f.boundsScalePerDbId[targetDbId][axis] && f.boundsScalePerDbId[targetDbId][axis].S_a;
    if (!Array.isArray(refBox) || !Array.isArray(nodeBoxPrimary) || typeof S_a !== 'number' || !Number.isFinite(S_a)) {
      return Promise.resolve(createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' }));
    }
    const delta = (refBox[axisIndex] - nodeBoxPrimary[axisIndex]) + (2 ** -6) * S_a;
    if (!Number.isFinite(delta)) {
      return Promise.resolve(createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'perturbation-not-representable' }));
    }
    return runBridgedControl({
      pageEvaluate,
      controlName: 'bounds-beyond-tolerance',
      inPageFn: boundsBeyondToleranceControlInPage,
      arg: { sessionId, tokenId, gen, controlId: 'bounds-beyond-tolerance', targetDbId, axisIndex, delta, nodeBoxPrimary },
      innerTimeoutMs: ctx.controlTimeoutMs,
    });
  };
}

/**
 * Node-side. `runHarness(deps, config)` -- plan §6.1's COMPLETE Phase 0-11 sequence, composing
 * every stage's already-built function in order. Fully offline-testable: every Playwright-shaped
 * dependency is INJECTED via `deps`, exactly like every function built in Stages 2-7 already
 * does (`runSetupThroughClassification`, `runF6UnloadReload`, etc.) -- this function itself
 * never imports/constructs Playwright, never launches a browser, never performs file/network
 * I/O directly. NEVER invoked with real dependencies anywhere in this stage's own code or tests
 * (see `main()`, below, for the ONLY place that happens, gated behind the activation interlock).
 *
 * **Six mandatory model-data controls, now real (Task 13, bounded completion pass area 3 final
 * integration):** the original Stages 4-6 design took `modelBefore`/`world`/`registry` as direct
 * Node-side parameters for `tree-unavailable`/`wrong-owner`/`hidden-fragment`/`capacity-breach`/
 * `invalid-bounds`/`bounds-beyond-tolerance` -- discovered (this pass) to be structurally
 * impossible for a real run, since those objects are page-owned and cannot cross a real
 * Playwright realm boundary as live Node-side references (confirmed by direct source read of
 * `setupSharedSessionResources`'s own doc comment). `runHarness` therefore takes each of those
 * six controls' own invocation as an OPAQUE INJECTED FUNCTION
 * (`deps.controls.<name>(ctx) => Promise<ControlResult>`) -- exactly the same pattern Stage 3
 * already established for `installF3Probe`/`finalizeF3Probe` before Stage 7 had to build F6's own
 * real, in-page-bridged version for F6 specifically. Tasks 10-12 built the real in-page-bridged
 * ports (`treeUnavailableControlInPage`/`wrongOwnerControlInPage`/`hiddenFragmentControlInPage`/
 * `capacityBreachControlInPage`/`invalidBoundsControlInPage`/`boundsBeyondToleranceControlInPage`,
 * plus their Node-side wrapper factories `buildXControlDep`); this task wires them into `main()`'s
 * own real `deps.controls` (via `buildRealControls`, above `main()`) and threads `sessionId`/
 * `tokenId`/`gen`/`primaryF7Fields` through to each `controls.<name>` call site below via
 * `runControlSafely`'s own `extraCtx` third argument and this function's own `controlCtx()`
 * helper (Phase 2.5, below) -- `deps.controls` itself remains an injected, offline-fakeable
 * dependency; only `main()`'s own REAL construction of it changed. `invalid-geometry-consumer`
 * (synthetic-input-only) and `late-completion-after-timeout` (isolated synthetic, Node-side
 * token/checkpoint bookkeeping only) are already realm-safe by construction and ARE genuinely
 * composed for real, below; `stale-old-model-event` is F6's own step 6, already fully real (Stage
 * 7); F1/F2/F4/F5/F7/F8 are genuinely real (in-page, called via `pageEvaluate`, realm-safe by
 * construction since Stage 4-7 built them that way from the start). Every `checks.F*` and
 * `controls.*` entry is therefore genuinely real for a live run; the only remaining disclosed
 * items are the accessor-fidelity and synchronous-detection-oracle notes this task's own report
 * documents (not fixed here, out of this bounded pass's authorization -- see `docs/reviews/` for
 * the persisted write-up).
 *
 * `deps` shape:
 * {
 *   pageEvaluate, pageWaitForFunction,                    // Stage 2/3's own injected shape
 *   loadStarter: { documentLoad, loadDocumentNode },      // real starters (main()) or fakes (tests)
 *   installF3Probe, finalizeF3Probe,                      // real (main()) or fakes (tests)
 *   captureFormatSignalsFn = captureModelFormatSignals,
 *   setupSharedSessionResources,
 *   controls: {                                           // each: (ctx) => Promise<ControlResult>
 *     treeUnavailable, wrongOwner, lateCompletionAfterTimeout, hiddenFragment,
 *     invalidGeometryConsumer, capacityBreach, invalidBounds, boundsBeyondTolerance,
 *   },
 *   f6Deps,                     // runF6UnloadReload's own deps, minus sessionId (added here)
 *   nodeCleanupResources,       // {page, context, browser, tokens, timers, abortControllers, httpServer} --
 *                                // Node-owned only; world/registry/viewer/modelBefore/modelAfter/
 *                                // f3Listener/f6/controlPatches are DELIBERATELY omitted (page-
 *                                // owned, handled by runInPageResourceCleanup instead, per the
 *                                // cleanup-ownership hand-off resolution above)
 *   captureViewerScriptIntegrity: () => Promise<captureRecordShape>,  // classifyViewerScriptIntegrity's own input
 *   errorLedger: { events: [...], record(event) {} },     // accrues continuously from Phase 0
 *   harnessIntegrity: { sha256, branch, headSha, gitStatusPorcelain },  // computed before any browser action
 *   writeResultAtomically: (result) => Promise<void>,
 * }
 * `config`: `{ urn, loadTimeoutMs, unloadWaitTimeoutMs = CHECK_TIMEOUT_MS, reloadProbeTimeoutMs =
 * CHECK_TIMEOUT_MS, controlTimeoutMs = CHECK_TIMEOUT_MS, censusTimeoutMs = CENSUS_TIMEOUT_MS,
 * unloadEventName, addedEventName, viewerVersion, node, chromium, initializer }` -- the run's own
 * scalar envelope, kept separate from `deps`' own function/object dependencies (mirrors the
 * shape/config split the brief's own `runHarness(deps, config)` signature names explicitly).
 *
 * Returns the full §8 result object. `runHarness` itself calls `deps.writeResultAtomically`
 * (if injected) once, as its own last action before returning -- never a raw `fs` call, so the
 * real atomic-write side effect stays behind `main()`'s own activation interlock exactly like
 * every other real side effect (only `main()` ever injects a real, file-writing implementation).
 */
async function runHarness(deps, config) {
  const startedAt = new Date().toISOString();
  const {
    pageEvaluate, pageWaitForFunction, loadStarter, installF3Probe, finalizeF3Probe,
    captureFormatSignalsFn = captureModelFormatSignals, setupSharedSessionResources: setupPhase25,
    controls, f6Deps = {}, nodeCleanupResources = {}, captureViewerScriptIntegrity,
    errorLedger = { events: [], record() {} }, harnessIntegrity: harnessIntegrityInput,
    writeResultAtomically,
  } = deps;
  const {
    urn, loadTimeoutMs, unloadWaitTimeoutMs = CHECK_TIMEOUT_MS, reloadProbeTimeoutMs = CHECK_TIMEOUT_MS,
    controlTimeoutMs = CHECK_TIMEOUT_MS, censusTimeoutMs = CENSUS_TIMEOUT_MS,
    // Task 10 (bounded completion pass, area 3 shared foundation), deliverable 4's last bullet:
    // the outer watchdog around Phase 11's own `pageEvaluate(runInPageResourceCleanup, ...)`
    // call -- same `innerTimeoutMs * 3`-style default multiplier `runBridgedControl` uses, above.
    cleanupWatchdogTimeoutMs = controlTimeoutMs * 3,
    unloadEventName, addedEventName,
  } = config;

  const checks = {};
  const controlResults = {};
  const tokens = [];
  // Fix wave (final whole-branch review, Important I3): per-token `gen` and F6-ownership
  // tracking, needed so Phase 11 step 1b (drainLoadToken) can pass the right generation and
  // step 20a's tokenEscalatesToUnresolvedOwnership can tell an F6 unload/reload-wait token
  // (escalates if left non-terminal) from an initial-load token (never escalates) -- plan
  // §4.3's own resource-ownership table, "per-operation tokens/generations" row.
  const tokenGens = new Map();
  const f6TokenIds = new Set();
  let classifierResult = null;
  // Fix wave (final whole-branch review, C1's own codex-advisor consult finding #4, independently
  // re-verified against this function's own source): hoisted out of Phase 1/2 below, which is now
  // wrapped in its own try/catch -- these two must stay assignable from outside that try so the
  // `if (classifierConfirmed) {...} else {...}` branch immediately below it (unchanged) keeps
  // working when Phase 1/2 aborts partway through. Both default fail-closed (never confirmed /
  // never loaded), matching this file's existing default-fails-closed discipline throughout.
  let classifierConfirmed = false;
  let loadDocumentNodeResult = null;
  let sessionId = null;
  let fatalErrorObserved = false;
  let cleanupUnresolvedOwnership = false;
  const cleanupFailures = [];
  const staleContinuationsDropped = [];
  // Task 10 (bounded completion pass, area 3 shared foundation), deliverable 4: a SEPARATE flag
  // from `fatalErrorObserved` -- deliberately never reused/overloaded for this narrower meaning
  // (second codex-advisor consult, request 20260928-180527-75769-27344: "Preserve the existing
  // error-ledger recording and fatalErrorObserved = true; sessionTainted must not replace
  // either"). Set whenever a control's OWN attempt leaves the session in a state where a further
  // `pageEvaluate` call against the same page/model can no longer be trusted: a control's own
  // OUTER watchdog firing (`runBridgedControl`'s `outerWatchdogTimeout`-tagged rejection, below,
  // where Node gave up waiting on the page and has no idea what state it's in); the control's own
  // settled `ControlResult` being TIMED_OUT/RESTORE_FAILED/`executed && !restored` (`tainted()`,
  // below); OR (Task 15, bounded H1-H3 remediation pass, fix for the final bounded-pass review's
  // H1 finding) a GENERIC exception thrown by the control fn itself (the generic catch branch,
  // below) -- that throw may have happened after the control already acquired a lease, patched
  // Viewer state, or created a scratch session, so the session is no more trustworthy than an
  // outer-watchdog timeout is. `controls.<name>.reason` and the error ledger (`control-threw:*`,
  // `control-outer-watchdog-timeout:*`, etc.) always record the SPECIFIC cause; this flag itself
  // deliberately does not distinguish which one fired. Once true, every REMAINING Phase 3c-10
  // step (every Fi check AND every control) short-circuits -- see the `if (!sessionTainted)`
  // gates below -- rather than risking another `pageEvaluate` call against a possibly-wedged or
  // mid-mutation page.
  let sessionTainted = false;

  const notExecutable = (name, reason) => createControlResult(name, { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason });
  const blockedControl = (name, classifierState) => createControlResult(name, { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: `classifier:${classifierState}` });
  // Task 13 (bounded completion pass, area 3 final integration): `runControlSafely` now accepts an
  // optional THIRD argument, `extraCtx` -- additive only, never changes the existing `{
  // controlTimeoutMs }` shape every prior offline test's own fake control fn already receives and
  // ignores (confirmed by direct re-read of every existing `deps.controls.*` fake across
  // `.controlbridge.test.mjs`/`.mandatorycontrols1/2.test.mjs`: none inspect `ctx` beyond
  // `controlTimeoutMs`, so widening it is behavior-preserving for every already-passing test).
  // This is what lets the REAL six bridged controls' own Node-side wrapper factories
  // (`buildTreeUnavailableControlDep` et al., Tasks 11/12, unmodified) receive `sessionId`/
  // `tokenId`/`gen` (and, for invalid-bounds/bounds-beyond-tolerance, `primaryF7Fields`) despite
  // `main()` needing to construct `deps.controls.*` BEFORE any of those values exist -- those
  // values are only ever known INSIDE `runHarness` itself (`sessionId` from Phase 2.5,
  // `tokenId`/`gen` from Phase 2, `primaryF7Fields` from Phase 8's own `checks.F7.fields`), never
  // by `main()` upfront. `main()`'s own real `controls.<name>` entries (see `main()`, below) are
  // therefore thin per-call adapters that re-invoke the (closure-bound, unmodified) factory
  // functions fresh on every call, reading `sessionId`/`tokenId`/`gen`/`primaryF7Fields` off THIS
  // `ctx` -- exactly the "values runHarness already has in scope at each control's own call site"
  // the authorization's own Task 13 brief requires, without touching the already-reviewed,
  // already-tested `buildXControlDep({pageEvaluate, sessionId, tokenId, gen, ...})` closure-bound
  // contract itself (`mandatorycontrols1.test.mjs`/`mandatorycontrols2.test.mjs` assert that
  // contract directly and must keep passing unmodified).
  // Task 14 fix wave (M1, recommended, final bounded-pass review): `sessionTainted` used to be set
  // ONLY on an outer-watchdog rejection (below). But `observeF1`/`observeF2`/`observeF7` genuinely
  // `await` internally, so an IN-PAGE inner timeout can fire before that, causing the control's
  // own `finally` to restore its patch and release its lease WHILE an abandoned detection
  // continuation may still be reading the live model -- a subsequent control could then acquire a
  // lease and patch the same model while that stale continuation is still active. Reusing the
  // EXACT SAME `sessionTainted` short-circuit (never a second, parallel mechanism), the taint
  // condition below is now ADDITIVELY broadened -- never replacing the outer-watchdog trigger --
  // to also fire on the control's own settled `ControlResult`: `TIMED_OUT` (the control's own
  // in-page inner timeout, distinct from the outer-watchdog TIMED_OUT already produced in the
  // catch block below), `RESTORE_FAILED`, or (checked independently of `state`, since
  // `mapControlAttemptOutcome` classifies a `!detected` result as `NOT_DETECTED` even when its own
  // restore also failed) any `executed:true` result with `restored === false`. Every one of these
  // states was ALREADY PASS-blocking (`computeOverall` branch 3) before this fix -- this only stops
  // `runHarness`'s own remaining sequence from continuing to talk to a possibly-still-perturbed
  // model, never changes the final verdict for a run that reaches this point.
  const tainted = (result) => Boolean(result) && (
    result.state === CONTROL_STATE.TIMED_OUT
    || result.state === CONTROL_STATE.RESTORE_FAILED
    || (result.executed === true && result.restored === false)
  );

  const runControlSafely = async (name, fn, extraCtx = {}) => {
    if (typeof fn !== 'function') return notExecutable(name, 'control-not-injected');
    let result;
    try {
      result = await fn({ controlTimeoutMs, ...extraCtx });
    } catch (e) {
      if (e && e.outerWatchdogTimeout === true) {
        // Task 10, deliverable 4: still return a well-formed ControlResult for THIS control
        // (TIMED_OUT is the more accurate of the two PASS-blocking choices here, since the
        // plan's own precedence already treats it as PASS-blocking either way -- brief's own
        // explicit call), but ALSO taint the session so `runHarness`'s own remaining sequence
        // never continues talking to a possibly-wedged page.
        sessionTainted = true;
        errorLedger.record({ kind: 'required-resource-failure', reason: `control-outer-watchdog-timeout:${name}`, error: describeError(e) });
        return createControlResult(name, { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason: 'outer-watchdog-timeout' });
      }
      errorLedger.record({ kind: 'required-resource-failure', reason: `control-threw:${name}`, error: describeError(e) });
      fatalErrorObserved = true;
      sessionTainted = true;
      return notExecutable(name, 'control-threw');
    }
    // Task 14 fix wave (M1, see this const's own doc comment above): an in-page-only inner
    // timeout/restore-failure taints the session too, using the identical flag/short-circuit.
    if (tainted(result)) sessionTainted = true;
    return result;
  };

  let signalSnapshot = null;
  // Fix wave (C1, codex-advisor consult finding #4): Phase 1/2 wrapped in try/catch, matching
  // Phase 2.5-10's own "nothing early-returns past cleanup" guarantee (its own doc comment,
  // immediately below) -- previously unguarded: a real installF3Probe()/
  // pageEvaluate(captureFormatSignalsFn, ...) rejection (e.g. page.evaluate rejecting on a page
  // crash) would have propagated straight out of runHarness, bypassing Phase 11 cleanup and the
  // atomic write entirely, contradicting that documented invariant. startLoad itself already
  // catches its own pageEvaluate call internally and never rethrows (Stage 2/3's own §6.4a Case D
  // handling), so it needs no additional guard here -- only the two calls that bypass startLoad's
  // protection do.
  try {
    // Phase 1 -- F3 probe install, strictly before Phase 2's load call (§4.4).
    await installF3Probe();

    // Phase 2 -- load: Document.load, then (only if that token completed) loadDocumentNode.
    const docLoad = await startLoad({ pageEvaluate, starter: loadStarter.documentLoad, api: LOAD_API.DOCUMENT_LOAD, urn, loadTimeoutMs });
    tokens.push(docLoad.token);
    tokenGens.set(docLoad.token.id, docLoad.gen);
    if (docLoad.token.state === TOKEN_STATE.COMPLETED) {
      loadDocumentNodeResult = await startLoad({ pageEvaluate, starter: loadStarter.loadDocumentNode, api: LOAD_API.LOAD_DOCUMENT_NODE, docTokenId: docLoad.token.id, loadTimeoutMs });
      tokens.push(loadDocumentNodeResult.token);
      tokenGens.set(loadDocumentNodeResult.token.id, loadDocumentNodeResult.gen);
    }

    const loadReachedCompleted = loadDocumentNodeResult && loadDocumentNodeResult.token.state === TOKEN_STATE.COMPLETED;

    if (loadReachedCompleted) {
      signalSnapshot = await pageEvaluate(captureFormatSignalsFn, { tokenId: loadDocumentNodeResult.token.id, gen: loadDocumentNodeResult.gen });
      if (!signalSnapshot || signalSnapshot.ok !== true || signalSnapshot.isOTG === null || signalSnapshot.isSVF2 === null) {
        fatalErrorObserved = true;
      } else {
        classifierResult = readFormat(buildFormatSignalShim(signalSnapshot));
      }
    }

    // Only CONFIRMED_SVF2 proceeds past the classifier (§4.1) into Phase 2.5 and F1-F8/F6/controls.
    classifierConfirmed = classifierResult && classifierResult.classifier === CLASSIFIER.CONFIRMED_SVF2;
  } catch (e) {
    fatalErrorObserved = true;
    errorLedger.record({ kind: 'required-resource-failure', reason: 'runHarness-phase1-2-sequence-threw', error: describeError(e) });
    // classifierConfirmed stays false (its hoisted default) -- the classifier-stop branch below
    // still runs and fills every checks.F*/controls.* placeholder, then Phase 11 cleanup and the
    // atomic write still happen, exactly like every other mid-sequence throw this file guards.
  }

  if (classifierConfirmed) {
    // Phase 2.5 -- shared session resources + setup postconditions (§6.1a).
    // The whole Phase 2.5-10 sequence below is wrapped in try/catch: a thrown Fi, a control
    // throwing unexpectedly, or any other fatal mid-sequence error must still reach Phase 11
    // cleanup and the atomic write (brief's own "nothing early-returns past cleanup" rule) --
    // this catch is what makes that true structurally, not just for the already-self-guarded
    // individual steps (runControlSafely/scoreFn's own try/catch only protect THOSE calls, never
    // an unexpected throw from, say, pageEvaluate(observeF1, ...) itself rejecting).
    try {
    const phase25 = await setupPhase25(loadDocumentNodeResult.token.id);
    if (!phase25 || phase25.ok !== true) {
      fatalErrorObserved = true;
    } else {
      sessionId = phase25.sessionId;

      // Task 13 (bounded completion pass, area 3 final integration): the six mandatory
      // model-data controls' own real Node-side wrapper factories (Tasks 11/12) are
      // closure-bound to `{pageEvaluate, sessionId, tokenId, gen}` at BUILD time (their own
      // already-reviewed, already-tested contract -- see `runControlSafely`'s own doc comment,
      // above). `main()` cannot build those closures before calling `runHarness` (it does not yet
      // know `sessionId`, established only just above), so `main()`'s own `deps.controls.<name>`
      // entries are instead thin per-call adapters that rebuild the (unmodified) factory fresh on
      // every invocation, reading `sessionId`/`tokenId`/`gen` off the `ctx` `runControlSafely`
      // passes through. `tokenId`/`gen` are the CURRENT load's own token identity -- the same
      // `loadDocumentNodeResult.token.id`/`tokenGens.get(...)` pair `setupSharedSessionResources`
      // itself used to seed `session.tokenId`/`session.tokenGen` (Phase 2.5, above) -- and stay
      // constant for every control call site below (no control creates a NEW load token; F6,
      // Phase 10, runs strictly AFTER every control in Phases 3c-8c). `controlCtx(extra)` builds
      // the per-call-site `extraCtx` `runControlSafely`'s own third argument expects.
      const controlTokenId = loadDocumentNodeResult.token.id;
      const controlGen = tokenGens.get(controlTokenId);
      const controlCtx = (extra = {}) => ({ sessionId, tokenId: controlTokenId, gen: controlGen, ...extra });

      // Phase 3 -- F3 finalize: remove the listener NOW, read out the timeline, score F3.
      let f3TimedOut = false;
      try {
        await pageWaitForFunction(f3ProbeSettledPredicate, {}, { timeout: reloadProbeTimeoutMs });
      } catch { f3TimedOut = true; }
      const f3Timeline = await finalizeF3Probe({ timedOut: f3TimedOut });
      const f3Score = scoreF3Readiness(f3Timeline);
      // Fix wave (Important I4): full {verdict, reason, fields, evidence} record, never a bare
      // verdict string -- see buildCheckRecord's own doc comment.
      checks.F3 = buildCheckRecord({
        verdict: f3Score.verdict, reason: f3Score.reason, fields: f3Score.fields,
        evidence: { status: 'observed', error: f3Score.error || null },
      });

      // Task 10 (bounded completion pass, area 3 shared foundation), deliverable 4: every step
      // from Phase 3c through Phase 10 (inclusive) is now gated behind `if (!sessionTainted)` --
      // once an outer-watchdog timeout taints the session (`runControlSafely`'s own catch,
      // above), every REMAINING step short-circuits rather than risking another `pageEvaluate`
      // call against a possibly-wedged page. `f1Result`/`f2Result`/`f4Result`/`f7Result` are
      // hoisted so a LATER gated block can still read an EARLIER one's result -- always safe,
      // since taint can only ever become true via a control (never an Fi check itself), so a
      // later block that depends on an earlier one is either running with that earlier value
      // already populated (taint became true only AFTER it, if at all) or is itself skipped
      // (taint was already true before this later block's own gate was reached).

      // Phase 3c -- tree-unavailable control, immediately after F3.
      if (!sessionTainted) {
        controlResults['tree-unavailable'] = await runControlSafely('tree-unavailable', controls && controls.treeUnavailable, controlCtx());
      }

      // Phase 4 -- F1.
      let f1Result = null;
      let f1Snapshot;
      if (!sessionTainted) {
        f1Result = await pageEvaluate(observeF1, sessionId);
        const f1Score = scoreF1(f1Result.fields || {});
        // Fix wave (Important I4): see buildCheckRecord's own doc comment. An observation
        // failure (f1Result.ok !== true) never fabricates fields/a scored reason from an empty
        // observation -- fields stays {}, reason/evidence.error name the actual observe failure.
        checks.F1 = f1Result.ok === true
          ? buildCheckRecord({ verdict: f1Score.verdict, reason: f1Score.reason, fields: f1Score.fields, evidence: { status: 'observed' } })
          : buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: f1Result.reason || 'observation-failed', evidence: { status: 'observation-failed' } });
        // Fix wave (final whole-branch review, Minor M3, treated as a real bug): captured HERE,
        // immediately after F1 is computed -- never inline at the control call site below. The
        // prior `f1SnapshotBefore: checks.F1` / `readCurrentF1: () => checks.F1` both ultimately
        // read the SAME Node-side variable, evaluated back-to-back at the same call site, with
        // nothing this oracle could ever observe changing in between -- a comparison against
        // itself, incapable of ever detecting a real leak. `f1Snapshot` now genuinely predates
        // every control that runs before this oracle (wrong-owner, immediately below), matching
        // the pre-control-snapshot pattern the review named. `structuredClone` (never a bare
        // assignment): `checks.F1` is a primitive string today, but a future I4 change (evidence-
        // shape tightening, this same fix wave's own remaining item) turns it into an object --
        // a bare assignment would then alias the SAME object `readCurrentF1()` re-reads, silently
        // reintroducing this exact self-comparison bug the moment that lands.
        f1Snapshot = structuredClone(checks.F1);
      }

      // Phase 4c -- wrong-owner, then late-completion-after-timeout, both before Phase 5.
      // late-completion-after-timeout is synthetic/Node-only (no realm bridging needed at all,
      // unlike wrong-owner) -- runHarness calls it directly, never through deps.controls, since
      // only it (not main()) has checks.F1 in scope to build f1SnapshotBefore/readCurrentF1 from.
      if (!sessionTainted) {
        controlResults['wrong-owner'] = await runControlSafely('wrong-owner', controls && controls.wrongOwner, controlCtx());
      }
      if (!sessionTainted) {
        controlResults['late-completion-after-timeout'] = await runLateCompletionAfterTimeoutControl({
          f1SnapshotBefore: f1Snapshot, readCurrentF1: () => checks.F1,
        });
      }

      // Phase 5 -- F2.
      let f2Result = null;
      if (!sessionTainted) {
        f2Result = await pageEvaluate(observeF2, sessionId);
        const f2Score = scoreF2(f2Result.fields || {});
        // Fix wave (Important I4): see F1's own comment above -- same pattern.
        checks.F2 = f2Result.ok === true
          ? buildCheckRecord({ verdict: f2Score.verdict, reason: f2Score.reason, fields: f2Score.fields, evidence: { status: 'observed' } })
          : buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: f2Result.reason || 'observation-failed', evidence: { status: 'observation-failed' } });
      }

      // Phase 5c -- hidden-fragment control.
      if (!sessionTainted) {
        controlResults['hidden-fragment'] = await runControlSafely('hidden-fragment', controls && controls.hiddenFragment, controlCtx());
      }

      // Phase 6 -- F4.
      let f4Result = null;
      let f4Snapshot;
      if (!sessionTainted) {
        f4Result = await pageEvaluate(observeF4, sessionId);
        const f4Score = scoreF4(f4Result.fields || {});
        // Fix wave (Important I4): see F1's own comment above -- same pattern.
        checks.F4 = f4Result.ok === true
          ? buildCheckRecord({ verdict: f4Score.verdict, reason: f4Score.reason, fields: f4Score.fields, evidence: { status: 'observed' } })
          : buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: f4Result.reason || 'observation-failed', evidence: { status: 'observation-failed' } });
        // Fix wave (final whole-branch review, Minor M3, treated as a real bug): same fix as
        // f1Snapshot above -- captured immediately after F4 is computed, never inline at the
        // control call site (where it previously ran with truly nothing at all in between,
        // making it the most direct of the two self-comparisons the review found). Deep-cloned
        // for the same forward-compatibility reason as f1Snapshot above.
        f4Snapshot = structuredClone(checks.F4);
      }

      // Phase 6c -- invalid-geometry-consumer control (synthetic-only, already realm-safe).
      // Same reasoning as late-completion-after-timeout above: called directly, never through
      // deps.controls, since only runHarness has checks.F4 in scope at this point.
      if (!sessionTainted) {
        controlResults['invalid-geometry-consumer'] = await runInvalidGeometryConsumerControl({
          f4SnapshotBefore: f4Snapshot, readCurrentF4: () => checks.F4, controlTimeoutMs,
        });
      }

      // Phase 7 -- F5 (its own corrected dependency: consumes F1's outcome directly, §7.5/I5).
      if (!sessionTainted) {
        const f5Score = scoreF5({ f1Result, f2Fields: f2Result.fields, f4Fields: f4Result.fields });
        // Fix wave (Important I4): F5 is pure/always-executes (no pageEvaluate ok-gate) -- see
        // buildCheckRecord's own doc comment.
        checks.F5 = buildCheckRecord({ verdict: f5Score.verdict, reason: f5Score.reason, fields: f5Score.fields, evidence: { status: 'observed' } });
      }

      // Phase 7c -- capacity-breach control.
      if (!sessionTainted) {
        controlResults['capacity-breach'] = await runControlSafely('capacity-breach', controls && controls.capacityBreach, controlCtx());
      }

      // Phase 8 -- F7.
      let f7Result = null;
      if (!sessionTainted) {
        f7Result = await pageEvaluate(observeF7, sessionId);
        const f7Score = scoreF7(f7Result.fields || {});
        // Fix wave (Important I4): see F1's own comment above -- same pattern.
        checks.F7 = f7Result.ok === true
          ? buildCheckRecord({ verdict: f7Score.verdict, reason: f7Score.reason, fields: f7Score.fields, evidence: { status: 'observed' } })
          : buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: f7Result.reason || 'observation-failed', evidence: { status: 'observation-failed' } });
      }

      // Phase 8c -- invalid-bounds, then bounds-beyond-tolerance.
      if (!sessionTainted) {
        controlResults['invalid-bounds'] = await runControlSafely('invalid-bounds', controls && controls.invalidBounds, controlCtx({ primaryF7Fields: checks.F7.fields }));
      }
      if (!sessionTainted) {
        controlResults['bounds-beyond-tolerance'] = await runControlSafely('bounds-beyond-tolerance', controls && controls.boundsBeyondTolerance, controlCtx({ primaryF7Fields: checks.F7.fields }));
      }

      // Phase 9 -- F8 (built entirely from F1/F2's own already-computed fields, never re-derived).
      if (!sessionTainted) {
        const f8Result = await pageEvaluate(observeF8, { sessionId, f1Fields: f1Result.fields, f2Fields: f2Result.fields });
        const f8Score = scoreF8(f8Result.fields || {});
        // Fix wave (Important I4): see F1's own comment above -- same pattern.
        checks.F8 = f8Result.ok === true
          ? buildCheckRecord({ verdict: f8Score.verdict, reason: f8Score.reason, fields: f8Score.fields, evidence: { status: 'observed' } })
          : buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: f8Result.reason || 'observation-failed', evidence: { status: 'observation-failed' } });
      }

      // Phase 10 -- F6 (MUTATES state; must run last of all checks; includes its own
      // stale-old-model-event control, copied -- never re-run -- into the controls manifest).
      if (!sessionTainted) {
        const f6Result = await runF6UnloadReload({
          sessionId, pageEvaluate, pageWaitForFunction,
          loadStarter, urn, loadTimeoutMs, unloadEventName, addedEventName,
          unloadWaitTimeoutMs, reloadProbeTimeoutMs, captureFormatSignalsFn,
          ...f6Deps,
        });
        const f6Score = scoreF6(f6Result.fields || {});
        // Fix wave (Important I4): see F1's own comment above -- same pattern (F6's own "ok" gate
        // is runF6UnloadReload's own wiring-install-failed early return, not a pageEvaluate-shaped
        // {ok, reason}, but the same never-fabricate-fields-on-failure discipline applies).
        checks.F6 = f6Result.ok === true
          ? buildCheckRecord({ verdict: f6Score.verdict, reason: f6Score.reason, fields: f6Score.fields, evidence: { status: 'observed' } })
          : buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: f6Result.reason || 'observation-failed', evidence: { status: 'observation-failed' } });
        if (f6Result.loadDocumentNode && f6Result.loadDocumentNode.token) {
          tokens.push(f6Result.loadDocumentNode.token);
          tokenGens.set(f6Result.loadDocumentNode.token.id, f6Result.loadDocumentNode.gen);
          f6TokenIds.add(f6Result.loadDocumentNode.token.id);
        }
        if (f6Result.docLoad && f6Result.docLoad.token) {
          tokens.push(f6Result.docLoad.token);
          tokenGens.set(f6Result.docLoad.token.id, f6Result.docLoad.gen);
          f6TokenIds.add(f6Result.docLoad.token.id);
        }
        controlResults['stale-old-model-event'] = buildStaleOldModelEventControlResult(f6Result.fields || {});
      }
    }
    } catch (e) {
      fatalErrorObserved = true;
      errorLedger.record({ kind: 'required-resource-failure', reason: 'runHarness-phase-sequence-threw', error: describeError(e) });
    }
    // Schema completeness on any abort above (classifier-confirmed but Phase 2.5 failed, or a
    // mid-sequence throw caught just above): every checks.F* / controls.* the sequence didn't
    // reach yet is filled with a fail-closed placeholder here, exactly like the classifier-stop
    // branch below already does -- never a missing object (plan §8), regardless of where the
    // sequence actually stopped.
    for (const name of F_CHECK_NAMES) {
      // Fix wave (Important I4): full record, never a bare verdict string -- see
      // buildCheckRecord's own doc comment ('not-run'/'fatal-error', matching this branch's own
      // 'not-reached:fatal-error' controls reason immediately below for consistency).
      if (!(name in checks)) {
        checks[name] = buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: 'not-reached:fatal-error', evidence: { status: 'not-run', blockedBy: 'fatal-error' } });
      }
    }
    for (const name of CONTROL_NAMES) {
      if (!(name in controlResults)) controlResults[name] = notExecutable(name, 'not-reached:fatal-error');
    }
  } else {
    // Classifier stop (or Phase 2.5 setup failure folded into the same "never proceeds past
    // this point" branch): every check and control is still written, per plan §8's own "no
    // missing objects" discipline -- never a silently-absent object.
    const classifierState = classifierResult ? classifierResult.classifier : 'unavailable';
    // Fix wave (Important I4): full record, never a bare verdict string.
    for (const name of F_CHECK_NAMES) {
      checks[name] = buildCheckRecord({ verdict: CHECK_VERDICT.BLOCKED, reason: `classifier:${classifierState}`, evidence: { status: 'not-run', blockedBy: 'classifier' } });
    }
    for (const name of CONTROL_NAMES) controlResults[name] = blockedControl(name, classifierState);
  }

  // Phase 11 -- cleanup: guarded, independent, continue-on-failure; ALWAYS runs, regardless of
  // how far the sequence above got (this is exactly what "never early-return past cleanup"
  // means). Realm-split per the cleanup-ownership hand-off resolution above: page-owned steps
  // via runInPageResourceCleanup while the page is still alive, THEN Node-owned steps via the
  // existing, frozen, unmodified `runCleanup` (Stage 2) -- page/context/browser close strictly
  // AFTER the in-page half, regardless of that half's own outcome.
  // Phase 11 steps 1a/1b (fix wave, final whole-branch review, Important I3): seal, then drain,
  // load tokens BEFORE the rest of cleanup -- plan §4.3/§6.4a's own ordering ("Sealing (in-page,
  // Phase 11 step 1a)" precedes the rest of cleanup; drain is step 1b). Previously built
  // (sealLoadRecords/drainLoadToken) but never called anywhere in the assembled runHarness.
  const claimedTokenIds = tokens.filter((t) => t.state === TOKEN_STATE.COMPLETED).map((t) => t.id);
  // Task 10 (bounded completion pass, area 3 shared foundation): per the second, task-sanity-
  // check codex-advisor consult (request 20260928-180527-75769-27344), finding 5 -- when the
  // session is already tainted (the page may be hung/wedged, or a control was left mid-mutation
  // by an in-page timeout, restore failure, or generic throw -- see `sessionTainted`'s own doc
  // comment above for the full set of taint causes, Task 15 added the generic-throw case),
  // issuing MORE unprotected page RPCs (sealLoadRecords/drainLoadToken, both un-watchdogged)
  // before ever reaching the one call this task DOES protect
  // (`pageEvaluate(runInPageResourceCleanup, ...)`, below) would defeat the whole point of the
  // outer watchdog: `runHarness` could still hang here, before ever reaching the protected call.
  // Skip both when tainted and go straight to the protected page-cleanup attempt -- any token
  // left non-terminal as a result is still correctly
  // accounted for by the existing per-token escalation loop below (`finalizeLoadTokens`/
  // `tokenEscalatesToUnresolvedOwnership`), unchanged.
  if (!sessionTainted) {
    try {
      await sealLoadRecords({ tokens, pageEvaluate, sealFn: sealLoads, claimedTokenIds });
    } catch (e) {
      cleanupFailures.push({ step: 'sealLoadRecords', error: describeError(e) });
      cleanupUnresolvedOwnership = true; // whole seal RPC failed while page presumed alive -- ownership unknown, same reasoning as the pageCleanup catch below
    }
    for (const token of tokens) {
      if (token.state !== TOKEN_STATE.TIMED_OUT) continue; // sealLoadRecords already moved every ACTIVE token to timed-out above; only those are ever drained (drainLoadToken's own doc comment)
      try {
        const drainResult = await drainLoadToken({
          token, pageWaitForFunction, pageEvaluate,
          ownershipCleanPredicate: f11DrainOwnershipCleanPredicate,
          readRecordFn: readLoadRecordSnapshot,
          tokenId: token.id, gen: tokenGens.get(token.id),
        });
        if (!drainResult.drained) {
          cleanupFailures.push({ step: 'drainPendingTokens', tokenId: token.id, reason: drainResult.reason });
        }
      } catch (e) {
        cleanupFailures.push({ step: 'drainPendingTokens', tokenId: token.id, error: describeError(e) });
        cleanupUnresolvedOwnership = cleanupUnresolvedOwnership || f6TokenIds.has(token.id);
      }
    }
  } else {
    cleanupFailures.push({ step: 'sealLoadRecords', reason: 'skipped-session-tainted' });
    cleanupFailures.push({ step: 'drainPendingTokens', reason: 'skipped-session-tainted' });
  }

  // Task 10, deliverable 4's last bullet: THIS specific call is the one this task protects with
  // an outer watchdog (the SAME `withControlTimeout` mechanism `runBridgedControl` uses, above --
  // never a third timeout primitive) -- a fully deadlocked page's own
  // `pageEvaluate(runInPageResourceCleanup, ...)` could otherwise hang `runHarness` itself
  // forever. `main()`'s own `page.close()`/`context.close()`/`browser.close()` (Node-side, not
  // page-evaluated, via `runCleanup`/`closeAllBestEffort`, unchanged) remain the actual final
  // backstop for a truly wedged page -- this watchdog only prevents THIS ONE RPC from hanging
  // `runHarness` before that backstop is ever reached.
  let pageCleanup = { ok: false, stepStatus: {}, cleanupFailures: [], cleanupUnresolvedOwnership: false };
  try {
    pageCleanup = await withControlTimeout(pageEvaluate(runInPageResourceCleanup, { sessionId }), cleanupWatchdogTimeoutMs);
  } catch (e) {
    if (e && e.controlTimeout) {
      cleanupFailures.push({ step: 'in-page-cleanup-watchdog-timeout', error: describeError(e) });
    } else {
      cleanupFailures.push({ step: 'removeF3Listeners', error: describeError(e) });
    }
    cleanupUnresolvedOwnership = true; // whole page-cleanup RPC failed/timed-out while page presumed alive -- ownership unknown (codex-advisor finding #3)
  }
  const nodeOnlyResources = { ...nodeCleanupResources, tokens };
  const nodeCleanup = await runCleanup(nodeOnlyResources, {});

  // Phase 11 step 20a (fix wave, final whole-branch review, Important I3): after Node-owned
  // page/context/browser close (steps 18-20, just above), finalize any load token still
  // timed-out -- plan §4.3 step 20a, Node-only, no page access. Previously built
  // (finalizeLoadTokens/tokenEscalatesToUnresolvedOwnership) but never called anywhere in the
  // assembled runHarness.
  // finalizeLoadTokens mutates every still-TIMED_OUT token to ABANDONED in place (when the realm
  // is confirmed destroyed) -- its return value is intentionally unused below; the escalation
  // loop re-reads each token's own (now-final) `.state` directly rather than the function's own
  // `stillTimedOut` list. Fix (self-check during this fix wave, independently re-verified
  // against tokenEscalatesToUnresolvedOwnership's own doc comment and async.test.mjs's own
  // "abandoned is non-terminal for this rule's purposes -- still escalates if it owns an F6
  // resource" test): the escalation predicate must be applied to EVERY non-terminal token, not
  // only ones still TIMED_OUT after finalizeLoadTokens runs. An F6 token that just became
  // ABANDONED (the common case -- realm successfully destroyed) is explicitly non-terminal for
  // this rule and must still escalate if it owns an F6 mutable resource; an earlier version of
  // this loop iterated only the function's own `stillTimedOut` list, silently skipping every
  // such token (the ordinary case, not the exceptional one).
  finalizeLoadTokens({
    tokens,
    pageIsClosed: nodeCleanup.stepStatus.closePage === 'ran',
    contextCloseSucceeded: nodeCleanup.stepStatus.closeContext === 'ran',
    browserCloseSucceeded: nodeCleanup.stepStatus.closeBrowser === 'ran',
  });
  for (const token of tokens) {
    if (token.state === TOKEN_STATE.COMPLETED || token.state === TOKEN_STATE.DISPOSED) continue;
    const stillTimedOut = token.state === TOKEN_STATE.TIMED_OUT;
    if (stillTimedOut) {
      cleanupFailures.push({ step: 'finalizeLoadTokens', tokenId: token.id, reason: 'realm-not-confirmed-destroyed' });
    }
    if (tokenEscalatesToUnresolvedOwnership({ tokenState: token.state, ownsF6MutableResource: f6TokenIds.has(token.id) })) {
      cleanupUnresolvedOwnership = true;
      if (!stillTimedOut) {
        cleanupFailures.push({ step: 'finalizeLoadTokens', tokenId: token.id, reason: 'abandoned-f6-token-ownership-never-confirmed-clean' });
      }
    }
  }

  // Fix round 1 (Stage 8 review, Important): page-cleanup's own results for its 12 owned step
  // names must be AUTHORITATIVE -- spread Node's own (vacuous/'skipped' for those same 12 names,
  // since nodeOnlyResources never includes world/registry/viewer/modelBefore/modelAfter) FIRST,
  // so pageCleanup's real per-step results win the merge, never silently overwritten.
  const mergedStepStatus = { ...nodeCleanup.stepStatus, ...pageCleanup.stepStatus };
  cleanupFailures.push(...(pageCleanup.cleanupFailures || []), ...nodeCleanup.cleanupFailures);
  cleanupUnresolvedOwnership = cleanupUnresolvedOwnership || Boolean(pageCleanup.cleanupUnresolvedOwnership) || Boolean(nodeCleanup.cleanupUnresolvedOwnership);

  // Late-arrival/stale-continuation accounting: any token never reaching a terminal state by
  // the time cleanup ran is retained here (plan §8's own staleContinuationsDropped field), never
  // silently dropped.
  for (const t of tokens) {
    if (t.state !== TOKEN_STATE.COMPLETED && t.state !== TOKEN_STATE.DISPOSED) {
      staleContinuationsDropped.push({ tokenId: t.id, operation: t.meta && t.meta.operation, phase: t.state });
    }
  }

  // viewerScriptIntegrity finalization -- per plan §8's own explicit ordering requirement,
  // AFTER cleanup (Phase 11) has completed, BEFORE computeOverall.
  let viewerScriptIntegrity = INTEGRITY_RESULT.CAPTURE_UNAVAILABLE;
  let integrityReason = 'capture-function-not-injected';
  // Fix wave (Important I4): the full capture record is now RETAINED (not just its classified
  // {integrityResult, reason}), so a future independent run-review can recompute
  // classifyViewerScriptIntegrity from the retained digest/status/chain fields and reject the
  // run's evidence if the recomputation disagrees -- plan §8's own explicit requirement.
  // `null` here means capture never ran at all (no function injected, or it threw before
  // returning) -- nothing to recompute FROM, as distinct from a captureRecord that ran and
  // legitimately observed zero attributable responses.
  let viewerScriptCaptureRecord = null;
  if (typeof captureViewerScriptIntegrity === 'function') {
    try {
      viewerScriptCaptureRecord = await captureViewerScriptIntegrity();
      const classified = classifyViewerScriptIntegrity(viewerScriptCaptureRecord);
      viewerScriptIntegrity = classified.integrityResult;
      integrityReason = classified.reason;
    } catch (e) {
      viewerScriptIntegrity = INTEGRITY_RESULT.CAPTURE_UNAVAILABLE;
      integrityReason = 'capture-threw';
      viewerScriptCaptureRecord = null;
      errorLedger.record({ kind: 'required-resource-failure', reason: 'viewer-script-integrity-capture-threw', error: describeError(e) });
    }
  }

  const ledgerFatal = (errorLedger.events || []).some((event) => {
    try { return classifyLedgerEvent(event, { closeIntent: 'cleanup' }).fatal === true; } catch { return true; }
  });
  fatalErrorObserved = fatalErrorObserved || ledgerFatal;

  // computeOverall -- ONLY ever invoked after BOTH remote-asset (viewerScriptIntegrity)
  // finalization AND cleanup have both completed (plan §8's own explicit ordering requirement,
  // enforced here structurally: neither viewerScriptIntegrity nor cleanupFailures/
  // cleanupUnresolvedOwnership could have been computed before this line).
  // Fix wave (Important I4): computeOverall's own input contract is Stage 1's frozen, pure,
  // extensively-tested bare-string `checks[name] === CHECK_VERDICT.FAIL/PASS` comparison --
  // confirmed unchanged by direct read, deliberately never reopened (codex-advisor, medium,
  // this fix wave: "Do not change computeOverall... Passing records would silently corrupt
  // overall verdict computation"). `checks` itself is now the canonical rich-record structure
  // (persisted into the result below); `projectCheckVerdicts` derives the bare-string shape
  // ONLY for this one call, from a single source of truth, never a second independently-
  // maintained map.
  // Task 10 (bounded completion pass, area 3 shared foundation): `sessionTainted` feeds
  // `computeOverall` the SAME way an ordinary fatal-failure signal already does (second
  // codex-advisor consult, request 20260928-180527-75769-27344, recommendation) -- inline at
  // THIS call site only, never by mutating the `fatalErrorObserved` variable itself (which stays
  // the narrower, already-established signal `errorLedger.fatalErrorObserved` in the persisted
  // result below reflects) and never by touching `computeOverall`'s own frozen internals.
  const overall = computeOverall({
    fatalErrorObserved: fatalErrorObserved || sessionTainted, cleanupUnresolvedOwnership, viewerScriptIntegrity,
    classifier: classifierResult ? classifierResult.classifier : null,
    checks: projectCheckVerdicts(checks), controls: controlResults, cleanupFailures,
  });

  // Merge the just-finalized remote-asset identity into harnessIntegrity (plan §8: "remoteAssets
  // cannot be written before any browser action: it is populated during Phase 0 and finalized
  // after Phase 11's page close and before computeOverall()" -- the sha256/branch/headSha/
  // servedModuleManifest fields were already written first, by the caller, unchanged; only
  // remoteAssets is assembled here). viewerStyle/otherObservedRemoteAssets are not separately
  // captured by this stage (deps carries only captureViewerScriptIntegrity, not a style/other-
  // assets capture hook -- a disclosed, documented gap, see this stage's own report) --
  // defaulted to a schema-valid, honestly-unavailable shape rather than fabricated.
  const finalizedHarnessIntegrity = {
    ...(harnessIntegrityInput || {}),
    remoteAssets: {
      // Fix wave (Important I4): expectedSha256/requestedUrl/capture added -- previously only
      // {integrityResult, reason}, which a future independent reviewer could read but never
      // independently recompute or audit against (plan §8's own explicit requirement). Known,
      // disclosed gap (not fixed in this fix wave -- see task-8-report.md): `capture`'s own
      // per-response records (built in main()'s Phase 0) retain `redirectChainComplete` as a
      // boolean, never the actual requestedUrl/finalUrl/redirect-hop array plan §8's fuller
      // sketch names -- sufficient to recompute classifyViewerScriptIntegrity's own verdict
      // (which is all validateResultSchema's own new recompute-check, below, needs), but not a
      // full independent audit of the reconstructed chain itself.
      viewerScript: {
        integrityResult: viewerScriptIntegrity, reason: integrityReason,
        expectedSha256: EXPECTED_VIEWER_SHA256, requestedUrl: VIEWER_SCRIPT_URL,
        capture: viewerScriptCaptureRecord,
      },
      viewerStyle: { identityScope: 'CAPTURE_UNAVAILABLE', identityGatesOverall: false },
      otherObservedRemoteAssets: [],
    },
  };

  const finishedAt = new Date().toISOString();
  const result = {
    script: 'g1-svf2-f1-f8-verification.mjs',
    harnessIntegrity: finalizedHarnessIntegrity,
    runtimeEnvelope: {
      viewerVersion: config.viewerVersion || null, chromium: config.chromium || null,
      node: config.node || process.version, modelUrn: urn,
      initializer: config.initializer || null,
    },
    classifier: classifierResult ? classifierResult.classifier : CLASSIFIER.INDETERMINATE_UNAVAILABLE,
    runtime: { isOTG: signalSnapshot ? signalSnapshot.isOTG : null, isSVF2: signalSnapshot ? signalSnapshot.isSVF2 : null },
    checks,
    controls: controlResults,
    staleContinuationsDropped,
    // codex-review (medium, round 3, High): every event array is now passed through
    // redactLedgerEventForEvidence (Part B's own redaction helper, built for the Phase 0 failure
    // path this same round) -- previously ONLY the Phase 0 failure path redacted ledger events;
    // this SUCCESS path spread `errorLedger.summary()` verbatim, so a raw secret-shaped `url`
    // (required-resource-failure) or `text` (console) could reach a normal, successful run's own
    // persisted evidence unredacted. Applying the SAME already-tested redaction function to both
    // paths closes that asymmetry with no new logic. (`allowListedFingerprints` is never
    // populated by `errorLedger.summary()` itself -- always `[]` -- so there is nothing to
    // redact there.)
    errorLedger: (() => {
      const summary = errorLedger.summary ? errorLedger.summary() : {};
      const redactArray = (arr) => (Array.isArray(arr) ? arr.map(redactLedgerEventForEvidence) : []);
      return {
        pageErrors: redactArray(summary.pageErrors),
        unhandledRejections: redactArray(summary.unhandledRejections),
        requiredResourceFailures: redactArray(summary.requiredResourceFailures),
        contextLoss: redactArray(summary.contextLoss),
        consoleErrors: redactArray(summary.consoleErrors),
        consoleWarnings: redactArray(summary.consoleWarnings),
        allowListedFingerprints: Array.isArray(summary.allowListedFingerprints) ? summary.allowListedFingerprints : [],
        fatalErrorObserved,
      };
    })(),
    cleanupFailures, cleanupUnresolvedOwnership,
    overall,
    startedAt, finishedAt,
    // Non-§8-named, additive diagnostic evidence (retained, never gates anything): the merged
    // 22-step cleanup ledger and the classified viewer-script-integrity reason.
    cleanupStepStatus: mergedStepStatus,
    viewerScriptIntegrityReason: integrityReason,
    // Task 10 addition, same "additive diagnostic evidence" category as the two fields above:
    // whether ANY control-taint cause (`sessionTainted`'s own doc comment, above, lists the full
    // set: outer-watchdog timeout, in-page TIMED_OUT/RESTORE_FAILED, `executed && !restored`, or
    // -- Task 15 -- a generic control-fn throw) ever tainted this run (`runControlSafely`'s own
    // catches, above) -- the causing control's OWN `controls.<name>.reason` and the error ledger
    // already record the SPECIFIC cause (`'outer-watchdog-timeout'`, `'control-threw'`, etc.);
    // this top-level field makes it possible to see AT A GLANCE, without hunting through every
    // control, whether the remainder of the Phase 3c-10 sequence was ever short-circuited for ANY
    // of those reasons. Never gates `overall` itself beyond what `fatalErrorObserved ||
    // sessionTainted` already fed `computeOverall`, above.
    sessionTainted,
  };

  if (typeof writeResultAtomically === 'function') {
    await writeResultAtomically(result);
  }

  return result;
}

// ------------------------------------------------------------------------------------------
// §8 evidence-schema validation
// ------------------------------------------------------------------------------------------

const REQUIRED_STRING_ENVELOPE_FIELDS = Object.freeze(['script', 'startedAt', 'finishedAt']);
const VALID_CLASSIFIER_VALUES = new Set(Object.values(CLASSIFIER));
const VALID_OVERALL_VALUES = new Set(Object.values(OVERALL_VERDICT));

/**
 * `validateResultSchema(result)` -- pure, Node-side. Checks the COMPLETE §8 JSON shape (plan
 * lines 1140-1229) against everything every prior stage actually produces: `harnessIntegrity`
 * (including `servedModuleManifest`/`remoteAssets`), `runtimeEnvelope`, `classifier`, `runtime`,
 * all 8 `checks.F*`, all 9 `controls.*` (validated via Stage 1's own `validateControlResult`,
 * never re-implemented here), `staleContinuationsDropped`, `errorLedger`,
 * `cleanupFailures`/`cleanupUnresolvedOwnership`, `overall`, `startedAt`/`finishedAt`.
 *
 * Returns `{ valid: boolean, errors: string[] }` -- never throws (a malformed `result` is
 * exactly the input this function exists to reject, not to crash on).
 */
function validateResultSchema(result) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['result must be an object'] };
  }

  for (const field of REQUIRED_STRING_ENVELOPE_FIELDS) {
    if (typeof result[field] !== 'string' || result[field] === '') fail(`'${field}' must be a non-empty string`);
  }

  // harnessIntegrity
  const hi = result.harnessIntegrity;
  if (!hi || typeof hi !== 'object') {
    fail("'harnessIntegrity' must be an object");
  } else {
    if (typeof hi.path !== 'string' || hi.path === '') fail("'harnessIntegrity.path' must be a non-empty string");
    if (typeof hi.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(hi.sha256)) fail("'harnessIntegrity.sha256' must be a 64-hex-char SHA-256 string");
    if (typeof hi.branch !== 'string') fail("'harnessIntegrity.branch' must be a string");
    if (typeof hi.headSha !== 'string') fail("'harnessIntegrity.headSha' must be a string");
    if (typeof hi.gitStatusPorcelain !== 'string') fail("'harnessIntegrity.gitStatusPorcelain' must be a string");
    if (!hi.servedModuleManifest || typeof hi.servedModuleManifest !== 'object' || Array.isArray(hi.servedModuleManifest)) {
      fail("'harnessIntegrity.servedModuleManifest' must be an object");
    } else {
      for (const [modPath, digest] of Object.entries(hi.servedModuleManifest)) {
        if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) fail(`'harnessIntegrity.servedModuleManifest["${modPath}"]' must be a 64-hex-char SHA-256 string`);
      }
    }
    const ra = hi.remoteAssets;
    if (!ra || typeof ra !== 'object') {
      fail("'harnessIntegrity.remoteAssets' must be an object");
    } else {
      const vs = ra.viewerScript;
      if (!vs || typeof vs !== 'object') {
        fail("'harnessIntegrity.remoteAssets.viewerScript' must be an object");
      } else {
        if (!VALID_INTEGRITY_VALUES.has(vs.integrityResult)) {
          fail(`'harnessIntegrity.remoteAssets.viewerScript.integrityResult' must be one of ${[...VALID_INTEGRITY_VALUES].join('|')}`);
        }
        if (vs.reason !== null && typeof vs.reason !== 'string') fail("'harnessIntegrity.remoteAssets.viewerScript.reason' must be null or a string");
        // Fix wave (Important I4): expectedSha256/requestedUrl now required; capture (when
        // non-null) must actually reproduce the recorded classification when recomputed through
        // the SAME pure classifier -- plan §8's own explicit requirement ("the future
        // independent run-review must recompute viewerScript.integrityResult from the retained
        // digest/status/chain fields and reject the run's evidence if the recomputation
        // disagrees with the recorded value").
        if (typeof vs.expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(vs.expectedSha256)) {
          fail("'harnessIntegrity.remoteAssets.viewerScript.expectedSha256' must be a 64-hex-char SHA-256 string");
        }
        if (typeof vs.requestedUrl !== 'string' || vs.requestedUrl === '') {
          fail("'harnessIntegrity.remoteAssets.viewerScript.requestedUrl' must be a non-empty string");
        }
        if (vs.capture !== null && (typeof vs.capture !== 'object' || Array.isArray(vs.capture))) {
          fail("'harnessIntegrity.remoteAssets.viewerScript.capture' must be null or an object");
        } else if (vs.capture !== null) {
          const recomputed = classifyViewerScriptIntegrity(vs.capture);
          if (recomputed.integrityResult !== vs.integrityResult || recomputed.reason !== vs.reason) {
            fail("'harnessIntegrity.remoteAssets.viewerScript' classification disagrees with recomputing classifyViewerScriptIntegrity from its own retained 'capture' record");
          }
        }
      }
      if (!ra.viewerStyle || typeof ra.viewerStyle !== 'object') fail("'harnessIntegrity.remoteAssets.viewerStyle' must be an object");
      else if (ra.viewerStyle.identityGatesOverall !== false) fail("'harnessIntegrity.remoteAssets.viewerStyle.identityGatesOverall' must be exactly false");
      if (!Array.isArray(ra.otherObservedRemoteAssets)) fail("'harnessIntegrity.remoteAssets.otherObservedRemoteAssets' must be an array");
    }
  }

  // runtimeEnvelope
  const re = result.runtimeEnvelope;
  if (!re || typeof re !== 'object') {
    fail("'runtimeEnvelope' must be an object");
  } else {
    for (const field of ['viewerVersion', 'chromium', 'node', 'modelUrn']) {
      if (!(field in re)) fail(`'runtimeEnvelope.${field}' is required (may be null, but must be present)`);
    }
    if (!re.initializer || typeof re.initializer !== 'object') fail("'runtimeEnvelope.initializer' must be an object");
  }

  // classifier / runtime
  if (!VALID_CLASSIFIER_VALUES.has(result.classifier)) fail(`'classifier' must be one of ${[...VALID_CLASSIFIER_VALUES].join('|')}`);
  if (!result.runtime || typeof result.runtime !== 'object') fail("'runtime' must be an object");

  // checks.F1-F8 -- fix wave (final whole-branch review, Important I4): tightened to REQUIRE
  // the full `{verdict, reason, fields, evidence}` record (plan §8's own JSON sketch); the
  // prior bare-verdict-string fallback is removed now that runHarness's own output was brought
  // up to match (never the schema loosened to paper over the weaker shape -- the review's own
  // explicit framing of this gap).
  if (!result.checks || typeof result.checks !== 'object' || Array.isArray(result.checks)) {
    fail("'checks' must be an object");
  } else {
    for (const name of F_CHECK_NAMES) {
      const c = result.checks[name];
      if (c === undefined || c === null) { fail(`'checks.${name}' is missing (plan §8: every check is always written, never a missing object)`); continue; }
      if (typeof c !== 'object' || Array.isArray(c)) { fail(`'checks.${name}' must be a {verdict, reason, fields, evidence} object, never a bare string/array`); continue; }
      if (!Object.values(CHECK_VERDICT).includes(c.verdict)) fail(`'checks.${name}.verdict' must be one of ${Object.values(CHECK_VERDICT).join('|')}`);
      if (c.reason !== null && typeof c.reason !== 'string') fail(`'checks.${name}.reason' must be null or a string`);
      if (!c.fields || typeof c.fields !== 'object' || Array.isArray(c.fields)) fail(`'checks.${name}.fields' must be an object`);
      if (!c.evidence || typeof c.evidence !== 'object' || Array.isArray(c.evidence)) {
        fail(`'checks.${name}.evidence' must be an object`);
      } else {
        if (!['observed', 'observation-failed', 'not-run'].includes(c.evidence.status)) {
          fail(`'checks.${name}.evidence.status' must be one of observed|observation-failed|not-run`);
        }
        if (c.evidence.blockedBy !== null && !['classifier', 'fatal-error'].includes(c.evidence.blockedBy)) {
          fail(`'checks.${name}.evidence.blockedBy' must be null, 'classifier', or 'fatal-error'`);
        }
      }
    }
  }

  // controls.* -- validated via Stage 1's own validateControlResult, never re-implemented here.
  if (!result.controls || typeof result.controls !== 'object') {
    fail("'controls' must be an object");
  } else {
    for (const name of CONTROL_NAMES) {
      const record = result.controls[name];
      if (record === undefined || record === null) { fail(`'controls.${name}' is missing (plan §8: every control is always written, never a missing object)`); continue; }
      const { valid, errors: controlErrors } = validateControlResult(name, record);
      if (!valid) fail(`'controls.${name}' invalid: ${controlErrors.join('; ')}`);
    }
  }

  if (!Array.isArray(result.staleContinuationsDropped)) fail("'staleContinuationsDropped' must be an array");

  // errorLedger
  const el = result.errorLedger;
  if (!el || typeof el !== 'object') {
    fail("'errorLedger' must be an object");
  } else {
    for (const field of ['pageErrors', 'unhandledRejections', 'requiredResourceFailures', 'contextLoss', 'consoleErrors', 'consoleWarnings', 'allowListedFingerprints']) {
      if (!Array.isArray(el[field])) fail(`'errorLedger.${field}' must be an array`);
    }
    if (typeof el.fatalErrorObserved !== 'boolean') fail("'errorLedger.fatalErrorObserved' must be a boolean");
  }

  if (!Array.isArray(result.cleanupFailures)) fail("'cleanupFailures' must be an array");
  if (typeof result.cleanupUnresolvedOwnership !== 'boolean') fail("'cleanupUnresolvedOwnership' must be a boolean");

  // Task 10 (bounded completion pass, area 3 shared foundation): `sessionTainted` is additive
  // diagnostic evidence (same category as `cleanupStepStatus`/`viewerScriptIntegrityReason`,
  // neither of which this function validates either), but per the second codex-advisor consult
  // (request 20260928-180527-75769-27344), finding 1, its own TYPE is still checked here --
  // otherwise a malformed or missing taint signal would silently pass schema validation.
  if (typeof result.sessionTainted !== 'boolean') fail("'sessionTainted' must be a boolean");

  if (!VALID_OVERALL_VALUES.has(result.overall)) fail(`'overall' must be one of ${[...VALID_OVERALL_VALUES].join('|')}`);

  return { valid: errors.length === 0, errors };
}

// ------------------------------------------------------------------------------------------
// Guarded entrypoint stub (item 8) -- a later stage replaces main()'s body.
// ------------------------------------------------------------------------------------------

/**
 * Node-side, pure. Every in-page function this file's own real-run wiring needs installed on a
 * real page, once, at Phase 0, before navigation -- explicit stable string keys (codex-advisor
 * consult, Stage 8: "Dispatch through explicit stable keys... never `fn.name`" -- avoids both
 * ~35 bare-global-identifier pollution AND any risk of a minifier/bundler-renamed `fn.name`
 * silently breaking dispatch). `main()`'s own bootstrap script assigns each entry as a property
 * of one dedicated registry object (`window.__g1HarnessFns`), reconstructed from its own
 * `fn.toString()` source -- the SAME technique every one of this file's own test files already
 * uses via their own `createPageRealm` helper, just targeting a real page instead of a `node:vm`
 * context. A sibling in-page function referenced by bare identifier (e.g. `onSuccess` calling
 * `pushLoadTransition`) resolves correctly because BOTH are installed in the same bootstrap
 * script's own lexical scope (an IIFE containing every one of these function declarations
 * verbatim), not because either is looked up through the registry object itself.
 */
const IN_PAGE_FUNCTION_REGISTRY = Object.freeze({
  // Fix wave (final whole-branch review, Important I2): `sessionErrOf` was missing here --
  // `setupSharedSessionResources` and `observeF1` both call it as a free identifier, which
  // reproduces as a genuine ReferenceError once `buildBootstrapScriptSource()` is actually used
  // (confirmed: the old `session.test.mjs` realm hand-injected `sessionErrOf` into its own test
  // context instead of building it from the SAME bootstrap the real code uses, which is exactly
  // what hid this).
  sessionErrOf,
  pageErrOf, pushLoadTransition, isLateModelsAllGone, createLoadRecord, onDeadline, onSuccess,
  onError, disposeLateArrival, sealLoads, isOwnershipClean, readLoadRecordSnapshot,
  f11DrainOwnershipCleanPredicate,
  captureModelFormatSignals, setupSharedSessionResources, installG1Modules,
  observeF1, observeF2, observeF4, observeF7, observeF8,
  f6InstallUnloadWiring, f6TriggerUnload, f6UnloadSettledPredicate, f6ReadUnloadSnapshot,
  f6InstallReloadProbe, f6ReloadProbeSettledPredicate, f6FinalizeReloadProbe, f6Reregister,
  f6RunLateUnloadControl, f6Cleanup,
  f3InstallProbe, f3ProbeSettledPredicate, f3FinalizeProbe,
  documentLoadStarter, loadDocumentNodeStarter, runInPageResourceCleanup,
  // Task 10 (bounded completion pass, area 3 shared foundation): the control-bridging in-page
  // foundation -- `acquireControlLease`/`releaseControlLease` reference `recordControlPatch` by
  // free identifier nowhere themselves, but `recordControlPatch` itself must still be declared
  // in the SAME bootstrap IIFE scope as whatever future bridged control handler (Tasks 11/12)
  // calls it by name, exactly like `sessionErrOf` above.
  recordControlPatch, acquireControlLease, releaseControlLease,
  createControlScratchSession, disposeControlScratchSession,
  // Task 12 (bounded completion pass, area 3): the two shared in-page helpers extracted from
  // Task 11's own three bridged functions (`raceWithInnerTimeout`/`checkSessionLiveness`) --
  // must be registered BEFORE any function that calls them by free identifier (every bridged
  // control below, Task 11's three retrofitted plus Task 12's own three), matching this file's
  // own established "declare shared helpers before their callers" bootstrap convention.
  raceWithInnerTimeout, checkSessionLiveness,
  // Task 11 (bounded completion pass, area 3): the three bridged in-page control functions
  // themselves -- `observeF1`/`observeF2` (already above) are called by free identifier from
  // `wrongOwnerControlInPage`/`hiddenFragmentControlInPage` respectively, so both must already
  // share this same bootstrap IIFE scope (confirmed true, both already registered above).
  treeUnavailableControlInPage, wrongOwnerControlInPage, hiddenFragmentControlInPage,
  // Task 12 (bounded completion pass, area 3): the three remaining bridged in-page control
  // functions -- capacityBreachControlInPage/invalidBoundsControlInPage/
  // boundsBeyondToleranceControlInPage (below). `observeF1`/`observeF7` (already above) are
  // called by free identifier from these, so both must already share this same bootstrap IIFE
  // scope (confirmed true, both already registered above).
  capacityBreachControlInPage, invalidBoundsControlInPage, boundsBeyondToleranceControlInPage,
});

/**
 * Node-side, pure. Builds the bootstrap script SOURCE TEXT `main()` hands to
 * `page.addInitScript({content})` (real run only -- never evaluated by this stage's own tests,
 * which exercise every in-page function above directly via `node:vm`, exactly like every prior
 * stage). An IIFE: declares every registry function verbatim (their own real source, via
 * `fn.toString()`), then assigns each onto `window.__g1HarnessFns` by its own registry key.
 * Deliberately does NOT initialize `window.__g1` itself (codex-advisor consult, Stage 8: doing
 * so here would make `window.__g1` truthy before `createLoadRecord`'s own required
 * `{closing, nextGen, loads, docs, models}` shape exists) -- `createLoadRecord`/the load
 * starters already lazily construct it themselves, unchanged, exactly as Stages 2/8 already
 * wrote them.
 */
function buildBootstrapScriptSource(registry = IN_PAGE_FUNCTION_REGISTRY) {
  const decls = Object.entries(registry).map(([key, fn]) => `const ${key} = ${fn.toString()};`).join('\n');
  const assigns = Object.keys(registry).map((key) => `  window.__g1HarnessFns.${key} = ${key};`).join('\n');
  return `(() => {\n${decls}\n  window.__g1HarnessFns = window.__g1HarnessFns || {};\n${assigns}\n})();`;
}

/**
 * Node-side. Builds a real `pageEvaluate(fn, arg)`/`pageWaitForFunction(fn, arg, opts)` pair
 * bound to a real Playwright `page`, dispatching through the bootstrap registry's own stable
 * keys (never `fn.name`) via a Node-side `Map<function, key>` built once from
 * `IN_PAGE_FUNCTION_REGISTRY`. Matches Stage 2/3's own established `pageEvaluate`/
 * `pageWaitForFunction` two/three-argument shape exactly, so `runHarness`/`startLoad`/
 * `runF6UnloadReload` need no changes to consume a real `page` versus a test fake.
 */
function buildRealPageDeps(page, registry = IN_PAGE_FUNCTION_REGISTRY) {
  const keyOf = new Map(Object.entries(registry).map(([key, fn]) => [fn, key]));
  const resolveKey = (fn) => {
    const key = keyOf.get(fn);
    if (!key) throw new Error(`buildRealPageDeps: function '${fn && fn.name}' is not registered in IN_PAGE_FUNCTION_REGISTRY`);
    return key;
  };
  return {
    pageEvaluate: (fn, arg) => page.evaluate(({ key, arg: a }) => window.__g1HarnessFns[key](a), { key: resolveKey(fn), arg }),
    pageWaitForFunction: (fn, arg, opts) => page.waitForFunction(({ key, arg: a }) => window.__g1HarnessFns[key](a), { key: resolveKey(fn), arg }, opts),
  };
}

/**
 * Node-side. Task 13 (bounded completion pass, area 3 final integration). Builds `runHarness`'s
 * `deps.controls` object for a REAL run -- the six mandatory model-data controls Tasks 11/12
 * already ported into the browser realm (`treeUnavailableControlInPage`/`wrongOwnerControlInPage`/
 * `hiddenFragmentControlInPage`/`capacityBreachControlInPage`/`invalidBoundsControlInPage`/
 * `boundsBeyondToleranceControlInPage`, plus their own Node-side wrapper factories
 * `buildTreeUnavailableControlDep`/`buildWrongOwnerControlDep`/`buildHiddenFragmentControlDep`/
 * `buildCapacityBreachControlDep`/`buildInvalidBoundsControlDep`/
 * `buildBoundsBeyondToleranceControlDep`, ALL unmodified by this task).
 *
 * Why this is a factory of THIN PER-CALL ADAPTERS, not a directly-built object of already-bound
 * dep functions: every one of the six `buildXControlDep` factories is closure-bound to
 * `{sessionId, tokenId, gen}` (and, for the two F7-dependent controls, `primaryF7Fields`) AT BUILD
 * TIME -- confirmed by direct re-read of Tasks 11/12's own code and asserted directly by
 * `mandatorycontrols1.test.mjs`/`mandatorycontrols2.test.mjs` ("sessionId/tokenId/gen are
 * closure-bound, controlTimeoutMs comes from ctx"), a contract this task must not disturb. But
 * `main()` (the only real caller of this function) constructs `deps` and calls `runHarness` ONCE,
 * BEFORE any of those values exist -- `sessionId` is established only at `runHarness`'s own Phase
 * 2.5 (`setupSharedSessionResources`), `primaryF7Fields` only at Phase 8 (`checks.F7.fields`).
 * `runHarness` itself is therefore the only place that ever genuinely HAS these values, and it
 * already forwards them through `runControlSafely`'s own (Task 13 addition) `extraCtx` third
 * argument -- see `runControlSafely`'s own doc comment for the full reasoning. Each adapter below
 * simply reads `ctx.sessionId`/`ctx.tokenId`/`ctx.gen`/`ctx.primaryF7Fields` and rebuilds the
 * (unmodified) factory fresh on every call -- cheap (a handful of object-literal closures), and
 * correct, since a real run only ever invokes any one control exactly once.
 *
 * `pageEvaluate` is the only value genuinely known upfront (bound once, here, at `main()`-call
 * time via `buildRealPageDeps`) -- passed through unchanged to every one of the six factories.
 */
function buildRealControls(pageEvaluate) {
  return {
    treeUnavailable: (ctx) => buildTreeUnavailableControlDep({ pageEvaluate, sessionId: ctx.sessionId, tokenId: ctx.tokenId, gen: ctx.gen })(ctx),
    wrongOwner: (ctx) => buildWrongOwnerControlDep({ pageEvaluate, sessionId: ctx.sessionId, tokenId: ctx.tokenId, gen: ctx.gen })(ctx),
    hiddenFragment: (ctx) => buildHiddenFragmentControlDep({ pageEvaluate, sessionId: ctx.sessionId, tokenId: ctx.tokenId, gen: ctx.gen })(ctx),
    capacityBreach: (ctx) => buildCapacityBreachControlDep({ pageEvaluate, sessionId: ctx.sessionId, tokenId: ctx.tokenId, gen: ctx.gen })(ctx),
    invalidBounds: (ctx) => buildInvalidBoundsControlDep({ pageEvaluate, sessionId: ctx.sessionId, tokenId: ctx.tokenId, gen: ctx.gen, primaryF7Fields: ctx.primaryF7Fields })(ctx),
    boundsBeyondTolerance: (ctx) => buildBoundsBeyondToleranceControlDep({ pageEvaluate, sessionId: ctx.sessionId, tokenId: ctx.tokenId, gen: ctx.gen, primaryF7Fields: ctx.primaryF7Fields })(ctx),
  };
}

/**
 * `parseLiveActivation({argv, env})` -- pure, Node-side, the activation interlock's own decision
 * logic extracted from `main()` so it is genuinely dynamically testable without ever calling
 * `main()` itself (this stage's own absolute constraint). Both the `--execute-live-f1-f8` CLI
 * flag (checked via `argv.includes(...)`, matching `process.argv`'s own shape) AND the
 * `G1_F1_F8_LIVE_AUTHORIZED=YES` environment variable (exact string match, never truthy-coerced)
 * are REQUIRED; either missing is unauthorized. Returns `{authorized, reason}` -- never throws,
 * so `main()`'s own call site owns the actual fail-closed throw/message. `reason` is one of
 * `'flag-and-env-missing' | 'flag-missing' | 'env-missing' | null` (null iff authorized).
 */
function parseLiveActivation({ argv, env } = {}) {
  const flagPresent = Array.isArray(argv) && argv.includes('--execute-live-f1-f8');
  const envPresent = Boolean(env) && env.G1_F1_F8_LIVE_AUTHORIZED === 'YES';
  if (flagPresent && envPresent) return { authorized: true, reason: null };
  if (!flagPresent && !envPresent) return { authorized: false, reason: 'flag-and-env-missing' };
  if (!flagPresent) return { authorized: false, reason: 'flag-missing' };
  return { authorized: false, reason: 'env-missing' };
}

/**
 * `main()` -- the ONLY place real Playwright objects get constructed, anywhere in this file.
 * Small by design (plan/brief's own explicit requirement): steps 1-2 below, in this exact
 * order, checking the activation interlock BEFORE step 2, via `parseLiveActivation` (above) --
 * the guard's own decision logic is dynamically unit-tested there; `main()` itself contributes
 * only the fail-closed throw and is never invoked. No top-level `import 'playwright'` exists
 * anywhere in this file -- the import below is the ONLY one, dynamic, reached only past the
 * guard -- which is what makes "`chromium.launch` unreachable before activation validation" a
 * checkable, testable property (this stage's own offline tests verify exactly this, both via
 * `parseLiveActivation`'s own exhaustive tests and a static source-order check on `main()`
 * itself, never by code review alone).
 *
 * Never actually invoked anywhere in this stage's own code or tests (the brief's own strongest-
 * yet restatement of every prior stage's authorization boundary).
 */
// ============================================================================================
// Bounded completion pass, Part B -- durable evidence on a Phase 0 failure.
//
// Both functions below are Node-side, dependency-injected, and fully offline-testable (no
// Playwright import, no real page/context/browser) -- exactly this file's own established
// pattern of keeping production-shaped logic in pure/injectable functions and reserving `main()`
// itself only for wiring real Playwright objects into them.
// ============================================================================================

// codex-review (medium, round 2, High): an unbounded `await target.close()` can hang forever
// (e.g. an unresponsive browser process after a renderer crash) -- Phase 0 evidence would then
// never be written at all, and main() would hang indefinitely instead of rethrowing the primary
// failure. Each close() now races against this bound; a timeout is recorded as an ordinary
// cleanup failure (never silently swallowed, never blocks the next resource).
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * `closeAllBestEffort({ page, context, browser, timeoutMs })` -- Part B's replacement for
 * `main()`'s prior inline `bestEffortCloseAll`, which blanket-swallowed every close() failure via
 * `.catch(() => {})`, discarding exactly the information the authorization requires ("cleanup
 * failures must be recorded, not silently discarded"). Closes all three, best-effort (a failure
 * OR TIMEOUT closing one never prevents attempting the next two, same as before), and returns
 * which (if any) failed, each already passed through `describeError` (never a raw Error/live
 * object). Works against any object exposing an async `close()` -- a real Playwright
 * Page/BrowserContext/Browser in `main()`, or a plain fake in a test. `timeoutMs` (default
 * `CLOSE_TIMEOUT_MS`) is overridable so a test can exercise the timeout path quickly rather than
 * actually waiting out the real production bound.
 *
 * Note: `Promise.race` bounds how long THIS FUNCTION waits, not the underlying `close()` call
 * itself -- Playwright's real API offers no cancellation, so a timed-out close() may still be
 * running in the background after this function returns. This is the same limitation codex-
 * review's own recommended fix accepts (racing each close against an independent deadline); it
 * is still strictly better than blocking evidence-writing/rethrow indefinitely.
 */
async function closeAllBestEffort({ page, context, browser, timeoutMs = CLOSE_TIMEOUT_MS } = {}) {
  const closeFailures = [];
  const resources = [['page', page], ['context', context], ['browser', browser]];
  for (const [resource, target] of resources) {
    if (!target || typeof target.close !== 'function') continue;
    let timer;
    try {
      await Promise.race([
        target.close(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`closeAllBestEffort: ${resource}.close() did not settle within ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (e) {
      closeFailures.push({ resource, error: describeError(e) });
    } finally {
      // Clear the timer whichever branch won -- otherwise a successful close() still leaves a
      // pending timer alive until it fires uselessly, which can keep the process/event loop
      // alive longer than necessary.
      clearTimeout(timer);
    }
  }
  return { closeFailures };
}

// Part B: the exact, real catch sites in main()'s own Phase 0 sequence (below) -- `phase0Step`
// is set immediately before each awaited call, never a guessed/invented category. codex-review
// (medium, this pass): the original 3-step version only covered goto/bootstrap-ready/
// module-install, leaving browser launch, context/page creation, and route/init-script
// registration -- all genuine "harness assembly failure" per the authorization's own §2 list --
// completely unguarded (a real failure there would leak the browser process and write no
// evidence at all). Widened to cover the FULL Phase 0 sequence main() actually performs.
const PHASE0_FAILURE_CATEGORIES = Object.freeze({
  // codex-review (medium, round 2, High): 'harness-integrity' and 'playwright-import' added --
  // the widened try block (main()) now covers these two steps too, which previously ran entirely
  // unguarded, before any try/catch existed.
  'harness-integrity': 'harness-integrity-compute-failed',
  'playwright-import': 'playwright-import-failed',
  'browser-launch': 'browser-launch-failed',
  'context-create': 'context-create-failed',
  'page-create': 'page-create-failed',
  'route-setup': 'route-or-init-script-setup-failed',
  goto: 'goto-failed',
  'bootstrap-ready': 'bootstrap-ready-failed',
  'module-install': 'module-install-failed',
});

// codex-review (medium, this pass): a hardcoded '-timeout' suffix for goto/bootstrap-ready
// mislabels a genuine non-timeout failure (e.g. a real `net::ERR_CONNECTION_REFUSED` on
// `page.goto`, or a page crash during `page.waitForFunction`) as a timeout, when neither call's
// own explicit `timeout: 30_000` option was necessarily what actually fired. Only promotes the
// category to the '-timeout' variant when the caught error is ACTUALLY a Playwright timeout
// (`error.name === 'TimeoutError'`, Playwright's own documented name for this case) -- never
// inferred from which step failed alone.
const PHASE0_TIMEOUT_CAPABLE_STEPS = Object.freeze(new Set(['goto', 'bootstrap-ready']));
function isPlaywrightTimeoutError(err) {
  return Boolean(err) && (err.name === 'TimeoutError' || /\btimeout\b/i.test(String(err && err.message || '')));
}
function categorizePhase0Failure(step, err) {
  const base = PHASE0_FAILURE_CATEGORIES[step] || 'phase-0-unknown-failure';
  if (PHASE0_TIMEOUT_CAPABLE_STEPS.has(step) && isPlaywrightTimeoutError(err)) {
    return base.replace(/-failed$/, '-timeout');
  }
  return base;
}

// codex-review (medium, round 2, High): the errorLedger events merged into Phase 0 evidence
// (below) can carry RAW, unredacted strings -- a `required-resource-failure` event's `url` (a
// failed request's full URL, which can carry a secret-shaped query parameter) and a `console`
// event's `text` (arbitrary page-logged text, which can carry a secret-shaped header line). Every
// OTHER string this file ever persists as evidence goes through `describeError`'s own
// `redactString`/`truncateStringBytes` (Stage 1, already exhaustively tested); these two ledger
// fields are the sole exception, because they were never passed through `describeError` at all
// (they are plain listener-captured strings, not Error objects). `redactLedgerString` closes that
// gap by reusing the EXACT SAME redactString/truncateStringBytes functions, given a small
// throwaway state object, rather than inventing a second, independently-maintained redaction
// regime.
function redactLedgerString(str) {
  if (typeof str !== 'string') return str;
  const state = { truncated: false, redactions: [], totalBytes: 0 };
  const redacted = redactString(str, 'ledgerEvent', state);
  // Ledger text/url fields are free-form, comparably-sized strings to an error's own `stack`
  // field -- reusing DESCRIBE_ERROR_MAX_STACK_BYTES as this field's own bound (not the larger
  // whole-error DESCRIBE_ERROR_MAX_TOTAL_BYTES budget, which is per-error, not per-field).
  const { value } = truncateStringBytes(redacted, DESCRIBE_ERROR_MAX_STACK_BYTES);
  return value;
}

/** Applies `redactLedgerString` to the only two raw-string fields an errorLedger event can carry
 * (`url` on a required-resource-failure event, `text` on a console event) -- every other field
 * (e.g. a `pageerror` event's `error`) is already `describeError`-shaped at the SOURCE (main()'s
 * own listener), so it is passed through unchanged here, never re-processed. Never mutates the
 * input event. */
function redactLedgerEventForEvidence(event) {
  if (!event || typeof event !== 'object') return event;
  const out = { ...event };
  if (typeof out.url === 'string') out.url = redactLedgerString(out.url);
  if (typeof out.text === 'string') out.text = redactLedgerString(out.text);
  return out;
}

/**
 * `handlePhase0Failure(...)` -- Part B: on any Phase 0 failure, builds a durable,
 * schema-shaped-as-far-as-possible FAIL evidence object (reusing the SAME `computeOverall`,
 * `buildCheckRecord`, `createControlResult`, `classifyViewerScriptIntegrity`, and `describeError`
 * every other stage already uses -- never a hand-set `overall: 'FAIL'` literal, never a
 * bespoke/unbounded error serialization), writes it through the injected `writeResultAtomically`
 * (the SAME atomic write-temp-then-rename mechanism the success path uses, never a second
 * evidence location), and returns without throwing (the caller, `main()`'s own catch block,
 * remains solely responsible for rethrowing the PRIMARY Phase 0 error -- this function's own
 * failure paths, e.g. a close() failure or a write failure, must never be promoted to primary or
 * silently swallow it).
 *
 * `captureViewerScriptIntegrity` is safely callable here even though close (via `closeAllFn`)
 * has just run -- it only awaits already-collected in-page listener state (see its own doc
 * comment where `main()` constructs it), never re-touches the live page/context/browser.
 *
 * Ordering (deliberate, matches the authorization's own requirements): `closeAllFn` runs FIRST
 * (cleanup should not be delayed further by evidence assembly), then Viewer-script identity is
 * finalized, then evidence is assembled via `computeOverall`, then written. A write failure is
 * captured and returned as `evidenceWriteError` (already `describeError`-shaped) rather than
 * thrown from here, so it can never overwrite/obscure the primary Phase 0 error the caller is
 * about to rethrow; the caller is expected to surface it distinctly (see `main()`, below).
 */
async function handlePhase0Failure({
  error, failureCategory, startedAt, harnessIntegrityInput, runtimeEnvelope = {},
  captureViewerScriptIntegrity, browserExisted = true, pageExisted = true, contextExisted = true,
  closeAllFn, writeResultAtomically, consoleErrorFn = console.error,
  // codex-review (medium, this pass): the page.on(pageerror/console/requestfailed) listeners
  // main() already registers before Phase 0's own goto (existing code, unchanged) had genuinely
  // observed events discarded by this function -- e.g. a required static resource's own
  // requestfailed event, or a page error, that actually EXPLAINS why goto/bootstrap-ready timed
  // out. `errorLedger` (main()'s own ledger object, exposing `.summary()` -- the SAME shape/
  // method the success path already calls) is now merged in, never silently dropped. Optional --
  // a test exercising handlePhase0Failure in isolation may omit it, and the merge degrades to
  // empty arrays, exactly as before.
  errorLedger = null,
} = {}) {
  const closeResult = typeof closeAllFn === 'function' ? await closeAllFn() : { closeFailures: [] };
  const closeFailures = (closeResult && closeResult.closeFailures) || [];

  // Viewer-script identity: same shape/finalization as runHarness's own Phase 11 (below),
  // deliberately duplicated rather than shared, since runHarness's own copy runs strictly AFTER
  // Phase 0 succeeds and is not itself callable from here without restructuring runHarness's own
  // already-reviewed Phase 11 boundary (out of this task's minimal-refactor scope).
  let viewerScriptIntegrity = INTEGRITY_RESULT.CAPTURE_UNAVAILABLE;
  let integrityReason = 'capture-function-not-injected';
  let viewerScriptCaptureRecord = null;
  if (typeof captureViewerScriptIntegrity === 'function') {
    try {
      viewerScriptCaptureRecord = await captureViewerScriptIntegrity();
      const classified = classifyViewerScriptIntegrity(viewerScriptCaptureRecord);
      viewerScriptIntegrity = classified.integrityResult;
      integrityReason = classified.reason;
    } catch (captureErr) {
      viewerScriptIntegrity = INTEGRITY_RESULT.CAPTURE_UNAVAILABLE;
      integrityReason = 'capture-threw';
      viewerScriptCaptureRecord = null;
    }
  }

  // checks.F1-F8 / controls.* -- none ran (Phase 0 is strictly before Phase 1), so every entry
  // is the SAME fail-closed "not reached" shape runHarness's own mid-sequence fatal-error branch
  // already uses for exactly this situation (see runHarness's own `blockedBy: 'fatal-error'`
  // usage) -- never a missing object (validateResultSchema's own "every check/control is always
  // written" requirement).
  const checks = {};
  for (const name of F_CHECK_NAMES) {
    checks[name] = buildCheckRecord({
      verdict: CHECK_VERDICT.BLOCKED,
      reason: `not-reached:phase-0-failure:${failureCategory}`,
      evidence: { status: 'not-run', blockedBy: 'fatal-error' },
    });
  }
  const controls = {};
  for (const name of CONTROL_NAMES) {
    controls[name] = createControlResult(name, {
      state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null,
      reason: `phase-0-failure:${failureCategory}`,
    });
  }

  // computeOverall -- fatalErrorObserved:true alone forces branch 1 -> FAIL, regardless of every
  // other input (plan §6.3's own reviewed precedence, "fatal runtime/page/console failure ->
  // FAIL" -- a Phase 0 failure IS exactly this). classifier is honestly
  // INDETERMINATE_UNAVAILABLE: Phase 0 never reaches the point where readFormat() could run.
  const overall = computeOverall({
    fatalErrorObserved: true,
    cleanupUnresolvedOwnership: false, // Phase 0 never establishes any shared-session ownership.
    viewerScriptIntegrity,
    classifier: CLASSIFIER.INDETERMINATE_UNAVAILABLE,
    checks: projectCheckVerdicts(checks),
    controls,
    cleanupFailures: closeFailures,
  });

  const finishedAt = new Date().toISOString();
  const describedError = describeError(error);
  const evidence = {
    script: 'g1-svf2-f1-f8-verification.mjs',
    phase: 'PHASE_0',
    failureCategory,
    error: describedError,
    harnessIntegrity: {
      ...(harnessIntegrityInput || {}),
      remoteAssets: {
        viewerScript: {
          integrityResult: viewerScriptIntegrity, reason: integrityReason,
          expectedSha256: EXPECTED_VIEWER_SHA256, requestedUrl: VIEWER_SCRIPT_URL,
          capture: viewerScriptCaptureRecord,
        },
        viewerStyle: { identityScope: 'CAPTURE_UNAVAILABLE', identityGatesOverall: false },
        otherObservedRemoteAssets: [],
      },
    },
    runtimeEnvelope: {
      viewerVersion: runtimeEnvelope.viewerVersion ?? null,
      chromium: runtimeEnvelope.chromium ?? null,
      node: runtimeEnvelope.node || process.version,
      modelUrn: runtimeEnvelope.modelUrn ?? null,
      initializer: runtimeEnvelope.initializer || {},
    },
    classifier: CLASSIFIER.INDETERMINATE_UNAVAILABLE,
    runtime: { isOTG: null, isSVF2: null },
    checks,
    controls,
    staleContinuationsDropped: [],
    errorLedger: (() => {
      const ledgerSummary = errorLedger && typeof errorLedger.summary === 'function' ? errorLedger.summary() : null;
      // codex-review (medium, round 2, High): every already-observed event is passed through
      // redactLedgerEventForEvidence before being persisted -- a raw `url`/`text` field could
      // otherwise carry a secret-shaped query parameter or header line straight into the
      // evidence file (verified by a direct synthetic check this round). The synthetic
      // phase-0-failure entry itself is already describeError-shaped, so it is not re-processed.
      const arr = (field) => (ledgerSummary && Array.isArray(ledgerSummary[field])
        ? ledgerSummary[field].map(redactLedgerEventForEvidence)
        : []);
      return {
        pageErrors: arr('pageErrors'),
        unhandledRejections: arr('unhandledRejections'),
        // The synthetic phase-0-failure entry is APPENDED after whatever was already genuinely
        // observed -- never replaces it, and is always last (the primary failure, reported
        // last/most-recently, same convention runHarness's own mid-sequence fatal path uses).
        requiredResourceFailures: [...arr('requiredResourceFailures'), { kind: 'phase-0-failure', category: failureCategory, error: describedError }],
        contextLoss: arr('contextLoss'),
        consoleErrors: arr('consoleErrors'),
        consoleWarnings: arr('consoleWarnings'),
        allowListedFingerprints: arr('allowListedFingerprints'),
        fatalErrorObserved: true,
      };
    })(),
    cleanupFailures: closeFailures,
    cleanupUnresolvedOwnership: false,
    overall,
    startedAt, finishedAt,
    // Non-§8-named, additive diagnostic evidence (never gates anything, same convention as
    // runHarness's own `cleanupStepStatus`/`viewerScriptIntegrityReason`): explicit record of
    // which resources existed and that cleanup was attempted, per the authorization's own
    // "record it as an explicit field, not an assumption" requirement.
    resourcesExisted: { browser: Boolean(browserExisted), page: Boolean(pageExisted), context: Boolean(contextExisted) },
    cleanupAttempted: true,
    viewerScriptIntegrityReason: integrityReason,
    // Task 10 (bounded completion pass, area 3 shared foundation) addition: `validateResultSchema`
    // now requires this field's TYPE (never its presence alone -- see that function's own doc
    // comment). A Phase 0 failure never reaches Phase 2.5/control-bridging at all, so `false` is
    // the honestly-correct value here, not a hack to satisfy the validator.
    sessionTainted: false,
  };

  let evidenceWriteError = null;
  if (typeof writeResultAtomically === 'function') {
    try {
      await writeResultAtomically(evidence);
    } catch (writeErr) {
      evidenceWriteError = describeError(writeErr);
      if (typeof consoleErrorFn === 'function') {
        consoleErrorFn('g1-svf2-f1-f8-verification.mjs: FAILED to write Phase 0 failure evidence file (original Phase 0 failure below remains primary)', writeErr);
      }
    }
  }

  return { evidence, closeFailures, evidenceWriteError };
}

async function main() {
  // Step 1 -- activation interlock, checked FIRST, before anything else (including this
  // function's own step 2). Delegates its decision to parseLiveActivation (above); either
  // condition missing throws immediately, before any dynamic import, browser launch, or
  // file/network I/O of any kind.
  const activation = parseLiveActivation({ argv: process.argv, env: process.env });
  if (!activation.authorized) {
    throw new Error(
      'g1-svf2-f1-f8-verification.mjs: live execution requires BOTH the --execute-live-f1-f8 '
      + 'CLI flag AND the G1_F1_F8_LIVE_AUTHORIZED=YES environment variable. These are '
      + 'MECHANICAL SAFEGUARDS ONLY -- their presence is NOT proof of owner authorization. Live '
      + 'F1-F8 execution requires separate, explicit owner authorization per '
      + `docs/prompts/g1-f1-f8-harness-implementation-authorization.md. (${activation.reason})`,
    );
  }

  // Part B: startedAt captured at the earliest point main() begins its own real work (matching
  // runHarness's own convention of capturing `startedAt` at the very start of ITS own
  // responsibility) -- reused as the Phase 0 failure evidence's own `startedAt` if Phase 0 never
  // reaches runHarness at all.
  const startedAt = new Date().toISOString();

  // codex-review (medium, round 2, High): the evidence writer is now constructed HERE,
  // immediately after activation succeeds and BEFORE anything else that could itself fail (the
  // dynamic `import('playwright')`, harnessIntegrity computation, browser launch, etc.) -- it has
  // no dependency on any of those, so it must be available for even the EARLIEST possible Phase 0
  // failure. Previously this was constructed much later (after the playwright import and
  // harnessIntegrity computation had already run, unguarded), so a failure in either of those had
  // no writer available at all and produced no evidence whatsoever.
  // Atomic write (plan §8): write-temp-then-rename to the existing, git-ignored
  // test/acceptance/results/ convention (§5's own file table).
  const resultPath = path.join(REPO_ROOT, 'test', 'acceptance', 'results', 'g1-svf2-f1-f8-verification-result.json');
  const writeResultAtomically = async (result) => {
    await nodeMkdir(path.dirname(resultPath), { recursive: true });
    const tmpPath = `${resultPath}.tmp-${randomUUID()}`;
    try {
      await nodeWriteFile(tmpPath, JSON.stringify(result, null, 2), 'utf8');
      await nodeRename(tmpPath, resultPath);
    } catch (writeOrRenameErr) {
      // codex-review (medium, round 1, Low): a failed write or rename previously left the temp
      // file behind indefinitely (repeated failures would accumulate `.tmp-*` files in the
      // results directory). Best-effort unlink here, then rethrow the ORIGINAL error unchanged --
      // an unlink failure (including "never existed" if writeFile itself never got that far) is
      // swallowed, since it must never mask the real failure being reported.
      await nodeUnlink(tmpPath).catch(() => {});
      throw writeOrRenameErr;
    }
  };

  // codex-review (medium, round 1, Critical; round 2, High): browser/context/page/
  // harnessIntegrity are all nullable OUTER bindings, assigned inside the widened Phase 0 try
  // block below (was: unguarded `const` declarations, and a harnessIntegrity computed entirely
  // before any try/catch existed at all -- a `chromium.launch()`/`newContext()`/`newPage()`, an
  // `import('playwright')`, or a `buildServedModuleManifest` rejection was entirely unguarded,
  // leaking whatever partially launched and writing no evidence). `pageEvaluate`/
  // `pageWaitForFunction` are nullable for the same reason (built from `page`, which may not
  // exist yet on a failure this early).
  let browser = null;
  let context = null;
  let page = null;
  let pageEvaluate = null;
  let pageWaitForFunction = null;
  let harnessIntegrity = null;

  // Fix wave (final whole-branch review, Critical C1): best-effort outer cleanup guard.
  // codex-advisor (medium, this fix wave): a goto/readiness/module-install failure in the new
  // Phase 0 sequence below happens strictly BEFORE runHarness is ever called, so runHarness's
  // own Phase 11 cleanup (which only guards its own Phase 1-10 sequence, once entered) can never
  // run for it -- without this guard a Phase 0 failure would leak the browser process. This does
  // NOT change runHarness's own cleanup contract; it only ensures a browser main() opened is
  // always closed even if main() never reaches the point of handing it to runHarness at all.
  // Part B: now delegates to closeAllBestEffort (above), which reports which close(s) failed
  // instead of blanket-swallowing every failure via `.catch(() => {})` -- required so a Phase 0
  // failure's own evidence can record a genuine cleanup failure rather than silently discarding
  // it. Reads `page`/`context`/`browser` at CALL time (closure over the `let` bindings above), so
  // it correctly closes only whichever of the three actually got created, however far Phase 0 got.
  const bestEffortCloseAll = () => closeAllBestEffort({ page, context, browser });

  const errorLedgerEvents = [];
  const errorLedger = {
    events: errorLedgerEvents,
    record(event) { errorLedgerEvents.push(event); },
    summary() {
      const byKind = (kind) => errorLedgerEvents.filter((e) => e.kind === kind);
      return {
        pageErrors: byKind('pageerror'), unhandledRejections: byKind('unhandledrejection'),
        requiredResourceFailures: byKind('required-resource-failure'), contextLoss: byKind('webglcontextlost'),
        consoleErrors: byKind('console').filter((e) => e.level === 'error'),
        consoleWarnings: byKind('console').filter((e) => e.level === 'warn'),
        allowListedFingerprints: [],
      };
    },
  };

  // Fix wave (C1): Viewer-script integrity capture state -- Node-side only, never re-evaluates
  // the page. runHarness's own Phase 11 calls `captureViewerScriptIntegrity` AFTER
  // page/context/browser are already closed (confirmed by direct read of runHarness's own Phase
  // 11 ordering, this file), so this state must be fully populated by these listeners alone,
  // all registered before `page.goto` below (codex-advisor's own required ordering, this fix
  // wave: "All registration must precede goto; relative registration order otherwise does not
  // matter").
  const integrityState = {
    requestFailed: false, autodeskViewingDefined: false, attributableResponses: [], responseBodyTasks: [],
  };
  const RESPONSE_BODY_CAPTURE_TIMEOUT_MS = 10_000;
  const captureViewerScriptIntegrity = async () => {
    await Promise.allSettled(integrityState.responseBodyTasks);
    return {
      requestFailed: integrityState.requestFailed,
      autodeskViewingDefined: integrityState.autodeskViewingDefined,
      attributableResponses: integrityState.attributableResponses,
    };
  };

  // Fix wave (C1): the real Phase 0 navigation/readiness/module-install sequence -- previously
  // entirely absent (the reviewer's own finding: no page.goto, no Initializer/viewer.start()
  // call, no window.__g1.mod population). Wrapped in the outer best-effort cleanup guard above:
  // any failure here closes the browser before rethrowing, never a leaked process (codex-advisor,
  // this fix wave).
  // codex-review (medium, round 1, Critical): WIDENED to cover browser launch, context/page
  // creation, and every route/init-script registration too -- previously only goto/bootstrap-
  // ready/module-install were guarded, so a browser-launch, context/page-creation, or route/
  // init-script-registration rejection was entirely unguarded: no cleanup attempt, no evidence
  // written, a genuine "harness assembly failure" (explicitly listed
  // in the authorization's own §2 failure-category list) silently falling through this file's own
  // safety net.
  // codex-review (medium, round 2, High): FURTHER WIDENED to cover harnessIntegrity's own
  // computation and the dynamic `import('playwright')` itself, now the very first two steps --
  // previously BOTH ran entirely before any try/catch existed in this function, so a missing
  // 'playwright' package, an unreadable harness file, or a `buildServedModuleManifest` failure (a
  // genuinely possible "required module import failure" if a served module's own static import
  // graph references a file that no longer exists on disk) reached only main()'s own top-level
  // stderr `.catch`, with no durable evidence written at all.
  // `phase0Step` is set immediately before each awaited call below, and is the ONLY source
  // `categorizePhase0Failure` (above `main()`) uses to derive the failure's exact category --
  // never a guess from the error's own message/type alone (it also inspects the caught error
  // itself, to distinguish an actual timeout from e.g. a connection failure -- see
  // `categorizePhase0Failure`'s own doc comment).
  let phase0Step = 'harness-integrity';
  try {
    // harnessIntegrity (plan §8): computed FIRST, before any browser/Playwright action --
    // git/hash/manifest fields only, never anything requiring a page. `servedModuleManifest`
    // walks the SAME entry points the harness actually serves (SERVED_MODULE_ENTRY_POINTS,
    // above), via the already-built, pure buildServedModuleManifest -- no new hashing logic here.
    // codex-review (medium, round 3, High): assigned INCREMENTALLY now (was: a single object
    // literal assigned only once every field -- including the fallible buildServedModuleManifest
    // walk -- had already succeeded). `buildServedModuleManifest` can genuinely throw (a served
    // module's own static import graph referencing a file that no longer exists on disk, per its
    // own doc comment) -- if it does, `harnessIntegrity` previously stayed entirely `null` even
    // though `path`/`sha256`/`branch`/`headSha`/`gitStatusPorcelain` were already known,
    // genuinely valid values by that point. Now every field is written into `harnessIntegrity` as
    // soon as it is computed, so a manifest-walk failure (the realistic case) still leaves
    // Phase 0 evidence schema-valid for every OTHER integrity field, with only
    // `servedModuleManifest` honestly empty (`{}` -- itself schema-valid: an empty object,
    // structurally never fails `validateResultSchema`'s per-key check, since there are no keys to
    // check).
    phase0Step = 'harness-integrity';
    harnessIntegrity = {
      path: 'test/acceptance/g1-svf2-f1-f8-verification.mjs',
      sha256: null, branch: '', headSha: '', gitStatusPorcelain: '', servedModuleManifest: {},
    };
    const harnessSha256 = createHash('sha256').update(await nodeReadFile(new URL(import.meta.url), 'utf8')).digest('hex');
    harnessIntegrity.sha256 = harnessSha256;
    const gitField = (args) => {
      try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; }
    };
    // '' (never null) on a git-command failure -- validateResultSchema requires a string; an
    // empty value is itself informative (git unavailable), never a missing/non-string field.
    harnessIntegrity.branch = gitField(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '';
    harnessIntegrity.headSha = gitField(['rev-parse', 'HEAD']) ?? '';
    harnessIntegrity.gitStatusPorcelain = gitField(['status', '--porcelain']) ?? '';
    harnessIntegrity.servedModuleManifest = await buildServedModuleManifest(SERVED_MODULE_ENTRY_POINTS, {});

    // Only past this point: dynamic import('playwright'), a real browser launch, and every other
    // real side effect this file performs.
    phase0Step = 'playwright-import';
    const { chromium } = await import('playwright');

    phase0Step = 'browser-launch';
    browser = await chromium.launch();
    phase0Step = 'context-create';
    context = await browser.newContext({ serviceWorkers: 'block' });
    phase0Step = 'page-create';
    page = await context.newPage();

    page.on('pageerror', (err) => errorLedger.record({ kind: 'pageerror', error: describeError(err) }));
    page.on('console', (msg) => errorLedger.record({ kind: 'console', level: msg.type(), text: msg.text() }));
    page.on('requestfailed', (request) => errorLedger.record({ kind: 'required-resource-failure', url: request.url() }));

    page.on('response', (response) => {
      const request = response.request();
      if (request.resourceType() !== 'script') return;
      // Only the TERMINAL response of a possible redirect chain is attributable. codex-advisor
      // (this fix wave): a 3xx redirect hop's own `response` event can fire before Playwright has
      // populated that request's own `redirectedTo()`, so status-code filtering (never
      // `redirectedTo()`) is what reliably distinguishes an intermediate hop from the final
      // response; `walkRedirectRootUrl` (above) then confirms the chain traces back to the
      // pinned Viewer script URL.
      const status = response.status();
      if (status >= 300 && status < 400) return;
      if (walkRedirectRootUrl(request) !== VIEWER_SCRIPT_URL) return;
      const record = {
        status, redirectChainComplete: true, fromServiceWorker: response.fromServiceWorker(),
        bodyOutcome: 'pending-at-close', decodedByteLength: null, sha256: null,
      };
      integrityState.attributableResponses.push(record);
      // response.body() is async and page.on(...) never awaits its listener (EventEmitter
      // semantics, codex-advisor's own finding) -- tracked here as a bounded (timeout-raced) task
      // so `captureViewerScriptIntegrity` can safely await every task AFTER the page/context/
      // browser have already closed, without itself depending on a live page.
      // codex-review (medium, round 3, Low): the timeout timer is now cleared as soon as
      // response.body() itself settles -- previously it stayed live for the full
      // RESPONSE_BODY_CAPTURE_TIMEOUT_MS regardless, which could keep the event loop alive
      // needlessly if Phase 0 fails shortly after a fast, successful capture.
      let bodyTimeoutTimer;
      const bodyTask = Promise.race([
        response.body().then((buf) => {
          record.bodyOutcome = buf.length > 0 ? 'captured' : 'empty';
          record.decodedByteLength = buf.length;
          if (buf.length > 0) record.sha256 = createHash('sha256').update(buf).digest('hex');
        }).catch(() => { record.bodyOutcome = 'capture-failed'; }),
        new Promise((resolve) => { bodyTimeoutTimer = setTimeout(resolve, RESPONSE_BODY_CAPTURE_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(bodyTimeoutTimer));
      integrityState.responseBodyTasks.push(bodyTask);
    });
    page.on('requestfailed', (request) => {
      // Chain-based, exactly like the response listener above -- a failure can occur on any hop
      // of a redirect chain, not only a request whose own url() is the pinned Viewer script URL.
      if (request.resourceType() !== 'script') return;
      if (walkRedirectRootUrl(request) !== VIEWER_SCRIPT_URL) return;
      integrityState.requestFailed = true;
    });

    phase0Step = 'route-setup';
    // Fix wave (Minor M1): origin check applied to both routes below (T3's own guard,
    // `clashtest-viewer-adapter.acceptance.mjs:933`, `handleClashtestRoute`'s own doc comment
    // named this exact gap) -- a cross-origin request matching either glob is passed through via
    // `route.continue()` rather than served by this harness.
    await context.route('**/clashtest/**', (route) => handleClashtestRoute(route, { baseUrl: BASE_URL }));
    // Stage 8 fix: F7's own observeF7 (Stage 6) reads window.__g1.mod['/clashpanel/viewer/
    // viewerApi.js'] (createViewerApi) -- a module OUTSIDE clashtest/, which
    // resolveClashtestModulePath/handleClashtestRoute (hardwired to CLASHTEST_DIR) cannot resolve.
    // Mirrors the exact same security pattern (path-traversal + extension check, serve from disk,
    // 404 on anything else) scoped to clashpanel/ instead, inline here since it is real-wiring-
    // only and never exercised by any offline test (those fake pageEvaluate/window.__g1.mod
    // directly, per every prior stage's own convention).
    const clashpanelDir = path.join(REPO_ROOT, 'clashpanel');
    await context.route('**/clashpanel/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(BASE_URL).origin) return route.continue(); // fix wave M1
      const rel = decodeURIComponent(url.pathname).replace(/^\/clashpanel\//, '');
      const abs = path.resolve(clashpanelDir, rel);
      if (!abs.startsWith(clashpanelDir + path.sep) || !abs.endsWith('.js')) {
        return route.fulfill({ status: 404, body: 'not served by g1-svf2-f1-f8-verification' });
      }
      try {
        await nodeReadFile(abs);
      } catch {
        return route.fulfill({ status: 404, body: 'not found' });
      }
      return route.fulfill({ path: abs, contentType: 'text/javascript' });
    });
    // Fix wave (C1): the harness's own bare synthetic page (mirrors
    // g1-svf2-initializer-diagnostic.mjs's own `page.route('**/__g1-diagnostic__', ...)` pattern).
    // Registered with the EXACT URL (no glob wildcard), per codex-advisor's own finding (this fix
    // wave, "apply origin protection to the synthetic page too") -- Playwright matches a plain,
    // wildcard-free string as a full-URL match, so this can only ever serve that one exact URL,
    // never a cross-origin or path-varied request.
    await page.route(`${BASE_URL}/__g1-f1f8__`, (route) => route.fulfill({ contentType: 'text/html', body: BARE_PAGE_HTML }));
    await page.addInitScript({ content: buildBootstrapScriptSource() });

    ({ pageEvaluate, pageWaitForFunction } = buildRealPageDeps(page));

    phase0Step = 'goto';
    await page.goto(`${BASE_URL}/__g1-f1f8__`, { waitUntil: 'load', timeout: 30_000 });
    phase0Step = 'bootstrap-ready';
    await page.waitForFunction(() => window.__g1Bootstrap && window.__g1Bootstrap.ready === true, { timeout: 30_000 });
    // Reaching bootstrap readiness requires Autodesk.Viewing to already be defined (its own
    // Initializer callback is what sets window.__g1Bootstrap.ready) -- the only reliable signal
    // available Node-side, since the page cannot be re-queried once closed (see
    // captureViewerScriptIntegrity's own doc comment above).
    integrityState.autodeskViewingDefined = true;

    // Fix wave (C1): populates window.__g1.mod for every module F1-F8 checks read via it
    // (SERVED_MODULE_ENTRY_POINTS, above -- e.g. observeF7's own '/clashpanel/viewer/
    // viewerApi.js' read). codex-advisor (this fix wave): every result must be validated, never
    // merely awaited -- a failed import must not be allowed to continue silently into runHarness.
    phase0Step = 'module-install';
    const moduleInstallResult = await pageEvaluate(installG1Modules, SERVED_MODULE_ENTRY_POINTS);
    const failedModules = Object.entries(moduleInstallResult || {}).filter(([, r]) => !r || r.ok !== true);
    if (failedModules.length > 0) {
      throw new Error(`g1-svf2-f1-f8-verification.mjs: installG1Modules failed for: ${failedModules.map(([spec]) => spec).join(', ')}`);
    }
  } catch (e) {
    // Part B: any Phase 0 failure now writes durable, schema-shaped FAIL evidence (via
    // handlePhase0Failure, above) BEFORE rethrowing, through the exact same atomic-write
    // mechanism the success path uses -- previously this branch only ran best-effort cleanup and
    // rethrew, leaving nothing durable but a stderr stack trace.
    const failureCategory = categorizePhase0Failure(phase0Step, e);
    let chromiumVersion = null;
    if (browser) {
      try { chromiumVersion = browser.version(); } catch { /* browser may already be in a bad state; chromium stays null, never fabricated */ }
    }
    const { evidenceWriteError } = await handlePhase0Failure({
      error: e, failureCategory, startedAt,
      harnessIntegrityInput: harnessIntegrity,
      runtimeEnvelope: {
        viewerVersion: VIEWER_VERSION, chromium: chromiumVersion, node: process.version,
        modelUrn: MODEL_URN, initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
      },
      captureViewerScriptIntegrity,
      // codex-review (medium, this pass): previously hardcoded `true` for all three -- now the
      // REAL existence state (a browser-launch failure, for instance, leaves all three false).
      browserExisted: Boolean(browser), pageExisted: Boolean(page), contextExisted: Boolean(context),
      closeAllFn: bestEffortCloseAll,
      writeResultAtomically,
      errorLedger,
    });
    // The primary Phase 0 failure (`e`) is rethrown unchanged, still the sole primary/reported
    // failure -- an evidence-write failure is attached as a non-enumerable-shaped extra property
    // (surfaced to main()'s own top-level `.catch` below, never silently dropped) rather than
    // replacing or wrapping `e`.
    if (evidenceWriteError) {
      e.phase0EvidenceWriteError = evidenceWriteError;
    }
    throw e;
  }

  const config = {
    // Fix wave (C1): the already-reviewed fixture URN (MODEL_URN, above), replacing the prior
    // env-var-derived fallback (empty string when unset), which would have run every check
    // against an empty/undefined URN on any real invocation -- this file's own activation
    // interlock made that categorically unreachable, but the config itself was still wrong.
    urn: MODEL_URN,
    loadTimeoutMs: 60_000,
    unloadEventName: 'beforeModelUnload',
    addedEventName: 'modelAdded',
    initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
    node: process.version,
    // Fix wave (Important I4): previously both null -- runtimeEnvelope must record the actual
    // pinned Viewer version and the real launched Chromium's own version string, never a
    // placeholder.
    viewerVersion: VIEWER_VERSION,
    chromium: browser.version(),
  };

  const result = await runHarness({
    pageEvaluate, pageWaitForFunction,
    loadStarter: { documentLoad: documentLoadStarter, loadDocumentNode: loadDocumentNodeStarter },
    installF3Probe: () => pageEvaluate(f3InstallProbe, undefined),
    finalizeF3Probe: (arg) => pageEvaluate(f3FinalizeProbe, arg),
    setupSharedSessionResources: (tokenId) => pageEvaluate(setupSharedSessionResources, tokenId),
    // Task 13 (bounded completion pass, area 3 final integration): the 6 real in-page-bridged
    // model-data control wrappers (previously `{}`, the disclosed scope boundary Tasks 9-12 left
    // open -- see `buildRealControls`'s own doc comment for why this is a factory of per-call
    // adapters, not a directly-built object). invalid-geometry-consumer/late-completion-
    // after-timeout need no entry here -- runHarness calls them directly (see its own Phase 4c/6c
    // comments), unchanged.
    controls: buildRealControls(pageEvaluate),
    nodeCleanupResources: { page, context, browser },
    // Fix wave (C1): previously not passed at all -- runHarness's own Phase 11
    // viewerScriptIntegrity finalization silently defaulted to CAPTURE_UNAVAILABLE /
    // 'capture-function-not-injected' on every real invocation.
    captureViewerScriptIntegrity,
    errorLedger,
    harnessIntegrity,
    writeResultAtomically,
  }, config);

  return result;
}

if (import.meta.url === `file://${process.argv[1]}` && !process.env.NODE_TEST_CONTEXT) {
  main().catch((err) => {
    console.error('g1-svf2-f1-f8-verification.mjs: fatal error', err);
    process.exitCode = 1;
  });
}

export {
  closeAllBestEffort,
  CLOSE_TIMEOUT_MS,
  PHASE0_FAILURE_CATEGORIES,
  PHASE0_TIMEOUT_CAPABLE_STEPS,
  isPlaywrightTimeoutError,
  categorizePhase0Failure,
  redactLedgerString,
  redactLedgerEventForEvidence,
  handlePhase0Failure,
  CLASSIFIER,
  CHECK_VERDICT,
  OVERALL_VERDICT,
  CONTROL_STATE,
  INTEGRITY_RESULT,
  TOKEN_STATE,
  READ_FORMAT_UNAVAILABLE,
  readFormat,
  DESCRIBE_ERROR_MAX_STACK_BYTES,
  DESCRIBE_ERROR_MAX_DEPTH,
  DESCRIBE_ERROR_MAX_ARRAY_ITEMS,
  DESCRIBE_ERROR_MAX_OBJECT_KEYS,
  DESCRIBE_ERROR_MAX_TOTAL_BYTES,
  describeError,
  createToken,
  transitionToken,
  isTokenLive,
  TokenTransitionError,
  CONTROL_RESTORATION_REQUIRED,
  CONTROL_NAMES,
  createControlResult,
  validateControlResult,
  computeOverall,
  LOAD_RECORD_STATUS,
  LOAD_API,
  DRAIN_TIMEOUT_MS,
  FINAL_DRAIN_TIMEOUT_MS,
  pageErrOf,
  pushLoadTransition,
  isLateModelsAllGone,
  createLoadRecord,
  onDeadline,
  onSuccess,
  onError,
  disposeLateArrival,
  sealLoads,
  isOwnershipClean,
  readLoadRecordSnapshot,
  startLoad,
  drainLoadToken,
  sealLoadRecords,
  finalizeLoadTokens,
  CLEANUP_STEP_NAMES,
  AggregateCleanupError,
  runCleanup,
  tokenEscalatesToUnresolvedOwnership,
  REPO_ROOT,
  CLASHTEST_DIR,
  CHECK_TIMEOUT_MS,
  resolveClashtestModulePath,
  handleClashtestRoute,
  SERVED_MODULE_ENTRY_POINTS,
  buildServedModuleManifest,
  EXPECTED_VIEWER_SHA256,
  PORT,
  BASE_URL,
  VIEWER_VERSION,
  VIEWER_SCRIPT_URL,
  VIEWER_STYLE_URL,
  MODEL_URN,
  BARE_PAGE_HTML,
  walkRedirectRootUrl,
  classifyViewerScriptIntegrity,
  CONSOLE_ERROR_ALLOWLIST,
  classifyLedgerEvent,
  scoreF3Readiness,
  captureModelFormatSignals,
  buildFormatSignalShim,
  runTreeUnavailableControl,
  runSetupThroughClassification,
  SESSION_K,
  SESSION_MODEL_VERSION,
  sessionErrOf,
  setupSharedSessionResources,
  recordControlPatch,
  acquireControlLease,
  releaseControlLease,
  createControlScratchSession,
  disposeControlScratchSession,
  mapControlAttemptOutcome,
  runBridgedControl,
  observeF1,
  scoreF1,
  observeF2,
  scoreF2,
  runWrongOwnerControl,
  runHiddenFragmentControl,
  raceWithInnerTimeout,
  checkSessionLiveness,
  treeUnavailableControlInPage,
  wrongOwnerControlInPage,
  hiddenFragmentControlInPage,
  buildTreeUnavailableControlDep,
  buildWrongOwnerControlDep,
  buildHiddenFragmentControlDep,
  capacityBreachControlInPage,
  invalidBoundsControlInPage,
  boundsBeyondToleranceControlInPage,
  buildCapacityBreachControlDep,
  buildInvalidBoundsControlDep,
  buildBoundsBeyondToleranceControlDep,
  CENSUS_TIMEOUT_MS,
  classifyWeldResult,
  observeF4,
  scoreF4,
  deriveOrganicBreach,
  scoreF5,
  jsonDeepEqual,
  runInvalidGeometryConsumerControl,
  runCapacityBreachControl,
  F7_TOLERANCE_CONSTANTS,
  observeF7,
  scoreF7,
  selectBoundsBeyondToleranceTarget,
  runInvalidBoundsControl,
  runBoundsBeyondToleranceControl,
  observeF8,
  scoreF8,
  f6InstallUnloadWiring,
  f6TriggerUnload,
  f6UnloadSettledPredicate,
  f6ReadUnloadSnapshot,
  f6InstallReloadProbe,
  f6ReloadProbeSettledPredicate,
  f6FinalizeReloadProbe,
  f6Reregister,
  f6RunLateUnloadControl,
  f6Cleanup,
  runF6UnloadReload,
  scoreF6,
  buildStaleOldModelEventControlResult,
  f3InstallProbe,
  f3ProbeSettledPredicate,
  f3FinalizeProbe,
  installG1Modules,
  f11DrainOwnershipCleanPredicate,
  documentLoadStarter,
  loadDocumentNodeStarter,
  runInPageResourceCleanup,
  runLateCompletionAfterTimeoutControl,
  runHarness,
  validateResultSchema,
  buildCheckRecord,
  projectCheckVerdicts,
  IN_PAGE_FUNCTION_REGISTRY,
  buildBootstrapScriptSource,
  buildRealPageDeps,
  buildRealControls,
  parseLiveActivation,
  main,
};
