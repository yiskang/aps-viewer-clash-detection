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

import { randomUUID } from 'node:crypto';

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
  if (typeof value === 'string') {
    const redacted = redactString(value, path, state);
    chargeBytes(state, redacted);
    return redacted;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    chargeBytes(state, value);
    return value;
  }
  // Unexpected shape in a scalar slot (e.g. a non-Error `reason` object) -- stringify
  // defensively rather than throwing or silently dropping it.
  const stringified = redactString(String(value), path, state);
  chargeBytes(state, stringified);
  return stringified;
}

function normalizeStack(stack, state) {
  if (stack === undefined || stack === null) return null;
  const str = typeof stack === 'string' ? stack : String(stack);
  const redacted = redactString(str, 'stack', state);
  const { value, truncated } = truncateStringBytes(redacted, DESCRIBE_ERROR_MAX_STACK_BYTES);
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
  if (typeof value === 'string') {
    const redacted = redactString(value, path, state);
    chargeBytes(state, redacted);
    return redacted;
  }
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
    const stringified = redactString(String(value), path, state);
    chargeBytes(state, stringified);
    return stringified;
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
 *    the depth nor the breadth cap has individually fired; anything beyond any of these caps is
 *    replaced with a `{ truncated: true }` marker (or an object/array gains `truncated: true`)
 *    and the top-level `truncated` flag is set -- informational loss is always visible, never
 *    silent;
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
    const message = redactString(String(e), 'message', state);
    chargeBytes(state, message);
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

const TOKEN_TRANSITIONS = Object.freeze({
  [TOKEN_STATE.ACTIVE]: new Set([TOKEN_STATE.COMPLETED, TOKEN_STATE.TIMED_OUT, TOKEN_STATE.DISPOSED]),
  [TOKEN_STATE.TIMED_OUT]: new Set([TOKEN_STATE.ABANDONED]),
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
 * timed-out | disposed)`, plus the one post-teardown transition `timed-out -> abandoned`.
 * No transition out of a terminal state (`completed`, `disposed`, `abandoned`) is ever
 * allowed; `abandoned` is only reachable from `timed-out`. Mutates `token.state` in place and
 * returns it on success; throws TokenTransitionError on an illegal transition (the token is
 * left unmodified).
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
  main,
};
