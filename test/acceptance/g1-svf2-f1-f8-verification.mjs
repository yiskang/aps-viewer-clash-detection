// test/acceptance/g1-svf2-f1-f8-verification.mjs
//
// ============================================================================================
//  VERIFICATION-ONLY HARNESS (Stage 1 of 8) -- NOT PART OF `npm test`, NOT WIRED INTO
//  server.js OR ANY ROUTE. Live F1-F8 execution is explicitly NOT authorized by this task.
//
//  Authorization: docs/prompts/g1-f1-f8-harness-implementation-authorization.md
//  Governing plan: docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md
//
//  This file is being built across 8 staged commits. THIS STAGE (1 of 8) implements ONLY the
//  pure, browser-free "contract" layer that every later stage (async Playwright wiring, the
//  runtime shell, F1-F8 evidence collection, mandatory-control perturbation/restoration logic)
//  calls into:
//    - the fail-closed format classifier (readFormat, plan §4.1)
//    - the bounded, JSON-safe, secret-redacting error serializer (describeError, plan §4.2)
//    - the generic per-operation Token state machine (plan §6.4a's two named paragraphs only --
//      NOT the browser-owned load-record wiring, which is a later stage)
//    - the overall-verdict precedence function (computeOverall, plan §6.3)
//    - the mandatory-control ControlResult model (plan §6.3a)
//
//  It does NOT implement async Playwright wiring, the runtime shell, F1-F8 evidence collection,
//  or the mandatory controls' own perturbation/restoration logic -- those are later stages.
//
//  `main()` below is a placeholder that throws until a later stage replaces it; the guarded
//  entrypoint at the bottom never fires on `import`, so this module's pure functions can be
//  safely imported and unit-tested offline (see the sibling
//  g1-svf2-f1-f8-verification.test.mjs, run under `npm run test:offline`).
//
//  Never touches wwwroot/viewer.js or any other production file. Never performs live
//  Playwright/browser/F1-F8 execution.
// ============================================================================================

import { randomUUID, createHash } from 'node:crypto';
import { readFile as nodeReadFile } from 'node:fs/promises';
import path from 'node:path';
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
    snapshot = await pageEvaluate(readRecordFn, { tokenId });
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
 * calls `pageEvaluate(sealFn, { claimed: claimedTokenIds })` (matching `SEAL_LOADS`'s own
 * argument shape) and returns the per-record snapshots.
 */
async function sealLoadRecords({ tokens, pageEvaluate, sealFn, claimedTokenIds = [] }) {
  for (const token of tokens) {
    if (token.state === TOKEN_STATE.ACTIVE) {
      transitionToken(token, TOKEN_STATE.TIMED_OUT);
    }
  }
  const snapshots = await pageEvaluate(sealFn, { claimed: claimedTokenIds });
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
 * `handleClashtestRoute(route, { clashtestDir, statFn } = {})` -- the thin Playwright adapter
 * around `resolveClashtestModulePath`. Per the authorization boundary above, this is fine to
 * leave UNTESTED against a real `route` object in this stage; it accepts `route` as a
 * parameter (never constructs one) so a later, separately-authorized stage's real
 * `page.route('**\/clashtest/**', handleClashtestRoute)` call needs no changes here.
 * `statFn` mirrors T3's own existence check (`fs.promises.stat`), injectable for the same
 * reason as `readFileFn` elsewhere in this file.
 *
 * NOTE for whoever wires the real `page.route` call in a later stage (deferred, Stage 3
 * review): T3's own handler additionally checks the request's origin against the harness's own
 * `BASE_URL` before resolving the path (`clashtest-viewer-adapter.acceptance.mjs:933`,
 * `if (url.origin !== new URL(BASE_URL).origin) return route.continue();`), so a cross-origin
 * request matching the `**\/clashtest/**` glob is passed through rather than served by this
 * handler. This function does not yet take a `baseUrl`/origin parameter to reproduce that
 * check -- add one when wiring the real route registration, matching T3's own guard exactly.
 */
async function handleClashtestRoute(route, { clashtestDir = CLASHTEST_DIR, statFn } = {}) {
  const url = new URL(route.request().url());
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

// ------------------------------------------------------------------------------------------
// Guarded entrypoint stub (item 8) -- a later stage replaces main()'s body.
// ------------------------------------------------------------------------------------------

async function main() {
  throw new Error('G1 F1-F8 harness: not yet implemented past Stage 1');
}

if (import.meta.url === `file://${process.argv[1]}` && !process.env.NODE_TEST_CONTEXT) {
  main().catch((err) => {
    console.error('g1-svf2-f1-f8-verification.mjs: fatal error', err);
    process.exitCode = 1;
  });
}

export {
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
  classifyViewerScriptIntegrity,
  CONSOLE_ERROR_ALLOWLIST,
  classifyLedgerEvent,
  scoreF3Readiness,
  captureModelFormatSignals,
  buildFormatSignalShim,
  runTreeUnavailableControl,
  runSetupThroughClassification,
  main,
};
