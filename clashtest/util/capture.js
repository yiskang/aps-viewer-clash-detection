// clashtest/util/capture.js
//
// Detached, data-only capture of an untrusted value (spec 5.3 capture algorithm, generalised to
// Result Sets in 13.6). Iterative (explicit stack, never recursive), descriptor-based: every own key
// list is read once with Reflect.ownKeys, every own property DESCRIPTOR is read once, and a getter
// is never invoked. Nothing the caller holds is touched again after captureData returns, so the
// copy is the one value that is validated, digested, planned, embedded and persisted.
//
// Simplification versus the spec (allowed by the master plan): validation of schema keys runs on
// the COPY in the owning phase (P2 definitions, P5 result sets), not inside this traversal. This
// module only guarantees the structural invariants (plain data, no accessors, no symbols, no
// holes, no cycles, no non-finite numbers, bounded depth/nodes/lengths). Bounds are charged before
// the corresponding copy is allocated.

export const CAPTURE_CODES = Object.freeze([
  'accessor', 'symbol-key', 'sparse-array', 'array-extra-key', 'not-plain', 'cyclic',
  'unreadable', 'depth', 'too-many-nodes', 'string-too-long', 'array-too-long', 'gated',
  'unknown-field-bytes',
]);

// UTF-8 byte length of a JS string, computed by scanning code units: no encoder, no Buffer, and no
// copy of the string is ever allocated. Returns Infinity without scanning when the string cannot fit
// in `limit` bytes (every UTF-16 code unit encodes to >= 1 UTF-8 byte). A lone surrogate is 3 bytes
// (it encodes as U+FFFD), which matches Buffer.byteLength.
function utf8Length(s, limit) {
  if (s.length > limit) return Infinity;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const pointerEscape = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

function pointerOf(frame, key) {
  const segs = [];
  if (key !== undefined) segs.push(pointerEscape(typeof key === 'symbol' ? (key.description ?? 'symbol') : key));
  for (let f = frame; f && f.parent; f = f.parent) segs.push(pointerEscape(f.key));
  return segs.length ? `/${segs.reverse().join('/')}` : '';
}

const isIndexKey = (k, length) => {
  if (typeof k !== 'string' || k === '' || (k.length > 1 && k[0] === '0')) return false;
  const n = Number(k);
  return Number.isInteger(n) && n >= 0 && n < length && String(n) === k;
};

const define = (obj, key, value) => {
  // `obj[key] = v` would invoke the __proto__ setter; defineProperty makes it an own data property.
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
};

/**
 * @param {unknown} root
 * @param {object} opts
 * @param {number} opts.maxNodes        REQUIRED. Every value (container or primitive) is one node.
 * @param {number} [opts.maxDepth=64] container nesting; the root container is depth 1
 * @param {number} [opts.maxIssues=1]   stop after this many issues; `issuesTruncated` when more exist.
 * @param {number} [opts.maxStringLength=Infinity]
 * @param {number} [opts.maxKeyLength=1024]
 * @param {number} [opts.maxArrayLength=Infinity]
 * @param {(pointer: string) => number | undefined} [opts.stringLimitFor] per-path override (opt-in cost)
 * @param {(pointer: string) => number | undefined} [opts.arrayLimitFor]  per-path override (opt-in cost)
 * @param {{ key: string, check: (value: unknown) => boolean }} [opts.rootGate] the root's `key` is read
 *        FIRST; if it is a data property whose primitive value fails `check`, capture stops at once
 *        with issue code 'gated' and NO other property is read (spec 13.6 schemaVersion rule).
 * @param {{ isOpenPath: (pathSegments: readonly string[]) => boolean, maxBytes: number }} [opts.openFieldBudget]
 *        The spec 13.6 unknown-field byte budget, enforced DURING capture. Every value at or below a
 *        path for which `isOpenPath(segments)` is true (segments are unescaped keys; array indices are
 *        decimal strings; the root is `[]`) is charged to ONE cumulative counter BEFORE it is copied:
 *        a string by its UTF-8 byte length, each property key of such a value by its UTF-8 length,
 *        a number/boolean/null by 8 bytes, an object/array container by 8 bytes. If the running total
 *        would exceed `maxBytes`, capture stops at once with issue 'unknown-field-bytes' at the
 *        offending value's pointer; no later value's descriptor is read and nothing later is copied.
 *        Omitted => no accounting and no `isOpenPath` call (behaviour identical to before).
 * @returns {{ ok: true, value: any, nodes: number, openFieldBytes?: number } |
 *           { ok: false, issues: Array<{ path: string, code: string, message: string }>, issuesTruncated: boolean, nodes: number, openFieldBytes?: number, gate?: { key: string, value: unknown } }}
 *          `nodes` (on failure too) is the number of values admitted, each charged immediately before it
 *          was copied, so it is the count of values actually copied when capture stopped.
 *          `openFieldBytes` is present only when `openFieldBudget` was supplied.
 */
export function captureData(root, opts) {
  if (!opts || !Number.isFinite(opts.maxNodes) || opts.maxNodes < 1) {
    throw new TypeError('captureData: opts.maxNodes (a positive number) is required');
  }
  const {
    maxNodes, maxDepth = 64, maxIssues = 1, maxStringLength = Infinity, maxKeyLength = 1024,
    maxArrayLength = Infinity, stringLimitFor, arrayLimitFor, rootGate, openFieldBudget,
  } = opts;
  // Fail closed on a malformed limit: a NaN / zero / non-integer limit would silently disable its comparison
  // (e.g. `maxIssues: 0` returned `ok: true` for a truncated capture) and must never reach the traversal.
  const badLimit = (k, v, ok) => { if (v !== undefined && !ok(v)) throw new TypeError(`captureData: opts.${k} is invalid`); };
  badLimit('maxDepth', opts.maxDepth, (v) => Number.isInteger(v) && v >= 1);
  badLimit('maxIssues', opts.maxIssues, (v) => Number.isInteger(v) && v >= 1);
  badLimit('maxKeyLength', opts.maxKeyLength, (v) => Number.isInteger(v) && v >= 0);
  badLimit('maxStringLength', opts.maxStringLength, (v) => typeof v === 'number' && v >= 0);
  badLimit('maxArrayLength', opts.maxArrayLength, (v) => typeof v === 'number' && v >= 0);
  badLimit('stringLimitFor', stringLimitFor, (v) => typeof v === 'function');
  badLimit('arrayLimitFor', arrayLimitFor, (v) => typeof v === 'function');
  badLimit('rootGate', rootGate, (v) => v !== null && typeof v === 'object' && typeof v.key === 'string' && typeof v.check === 'function');
  // A per-path callback's result is a limit like any other: `undefined` defers to the fixed cap, anything else must be a
  // number >= 0 (NaN would silently disable the comparison, so it is rejected here rather than compared). The throw is
  // caught by the traversal's own try, so a malformed callback fails CLOSED as `unreadable`, like a throwing callback.
  const pathLimit = (k, fn, path, fallback) => {
    const v = fn ? fn(path) : undefined;
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !(v >= 0)) throw new TypeError(`captureData: opts.${k} returned an invalid limit`);
    return v;
  };
  const budgeted = openFieldBudget !== undefined;
  if (budgeted && (openFieldBudget === null || typeof openFieldBudget.isOpenPath !== 'function'
      || !Number.isFinite(openFieldBudget.maxBytes) || openFieldBudget.maxBytes < 0)) {
    throw new TypeError('captureData: opts.openFieldBudget must be {isOpenPath: function, maxBytes: number >= 0}');
  }
  const isOpenPath = budgeted ? openFieldBudget.isOpenPath : null;
  const maxBytes = budgeted ? openFieldBudget.maxBytes : 0;

  const issues = [];
  let truncated = false;
  let stopped = false;
  let nodes = 0;
  let gate = null;
  let openBytes = 0;
  const visited = new Set();

  const report = (code, path) => {
    if (issues.length >= maxIssues) { truncated = true; stopped = true; return; }
    issues.push({ path, code, message: code });
  };
  // Returns true when the node is admitted (charged) and false when a ceiling was hit.
  const charge = (n, path) => {
    if (nodes + n > maxNodes) { report('too-many-nodes', path); stopped = true; return false; }
    nodes += n;
    return true;
  };
  // The unknown-field byte budget: charged BEFORE the copy it pays for; on overflow capture stops.
  const chargeBytes = (n, path) => {
    if (openBytes + n > maxBytes) { report('unknown-field-bytes', path); stopped = true; return false; }
    openBytes += n;
    return true;
  };
  const chargeString = (s, path) => chargeBytes(utf8Length(s, maxBytes - openBytes), path);
  // Unescaped path segments of `key` under `frame` (a fresh, frozen array per call; depth <= maxDepth).
  const segmentsOf = (frame, key) => {
    const segs = [];
    if (key !== undefined) segs.push(String(key));
    for (let f = frame; f && f.parent; f = f.parent) segs.push(String(f.key));
    return Object.freeze(segs.reverse());
  };
  // A value is open when its parent is open (everything below an open path is open) or when the
  // caller's predicate says its own path is. isOpenPath is the caller's code: if it throws, the
  // surrounding try reports `unreadable` (never an escape).
  const openAt = (parentOpen, frame, key) => budgeted && (parentOpen || isOpenPath(segmentsOf(frame, key)) === true);

  let result;

  // A frame is the traversal state of one container. `dst` is the detached copy being filled.
  const openContainer = (src, parent, key, assign, open) => {
    const path = pointerOf(parent, key);
    if (parent && parent.depth + 1 > maxDepth) { report('depth', path); return null; }
    if (visited.has(src)) { report('cyclic', path); return null; }
    visited.add(src);
    if (Array.isArray(src)) {
      const lenDesc = Reflect.getOwnPropertyDescriptor(src, 'length');
      const length = lenDesc && lenDesc.value;
      if (!Number.isSafeInteger(length) || length < 0) { report('unreadable', path); return null; }
      const limit = pathLimit('arrayLimitFor', arrayLimitFor, path, maxArrayLength);
      if (length > limit) { report('array-too-long', path); return null; }
      if (nodes + 1 + length > maxNodes) { report('too-many-nodes', path); stopped = true; return null; }
      if (open && !chargeBytes(8, path)) return null;
      if (!charge(1, path)) return null;
      const ownKeys = Reflect.ownKeys(src);
      for (const k of ownKeys) {
        if (typeof k === 'symbol') { report('symbol-key', path); return null; }
        if (k !== 'length' && !isIndexKey(k, length)) { report('array-extra-key', path); return null; }
      }
      const dst = new Array(length);
      assign(dst);
      return { src, dst, isArray: true, keys: null, length, i: 0, parent, key, open, depth: parent ? parent.depth + 1 : 1 };
    }
    const proto = Reflect.getPrototypeOf(src);
    if (proto !== Object.prototype && proto !== null) { report('not-plain', path); return null; }
    if (open && !chargeBytes(8, path)) return null;
    if (!charge(1, path)) return null;
    const keys = Reflect.ownKeys(src);
    if (nodes + keys.length > maxNodes) { report('too-many-nodes', path); stopped = true; return null; }
    if (rootGate && !parent) {
      const at = keys.indexOf(rootGate.key);
      if (at > 0) { keys.splice(at, 1); keys.unshift(rootGate.key); }
    }
    const dst = {};
    assign(dst);
    return { src, dst, isArray: false, keys, length: keys.length, i: 0, parent, key, open, depth: parent ? parent.depth + 1 : 1 };
  };

  const admitPrimitive = (value, path, open) => {
    if (typeof value === 'string') {
      const limit = pathLimit('stringLimitFor', stringLimitFor, path, maxStringLength);
      if (value.length > limit) { report('string-too-long', path); return false; }
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) { report('not-plain', path); return false; }
    } else if (typeof value !== 'boolean' && value !== null) {
      report('not-plain', path); // undefined, function, symbol, bigint
      return false;
    }
    if (open && !(typeof value === 'string' ? chargeString(value, path) : chargeBytes(8, path))) return false;
    return charge(1, path);
  };

  const stack = [];
  try {
    const first = (() => {
      if (root === null || typeof root !== 'object') {
        if (admitPrimitive(root, '', openAt(false, null, undefined))) result = root;
        return null;
      }
      return openContainer(root, null, undefined, (d) => { result = d; }, openAt(false, null, undefined));
    })();
    if (first) stack.push(first);
  } catch {
    report('unreadable', '');
  }

  while (stack.length && !stopped) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.length) { stack.pop(); continue; }
    let key;
    let path = '';
    try {
      key = frame.isArray ? String(frame.i) : frame.keys[frame.i];
      frame.i++;
      // A hostile key is never copied whole into a diagnostic path (the check precedes the escape/join): an
      // over-long key is reported at the parent pointer and a symbol's description is truncated to 64 units,
      // so it costs O(1) here, not O(key length).
      if (typeof key === 'symbol') { report('symbol-key', pointerOf(frame, (key.description ?? 'symbol').slice(0, 64))); continue; }
      if (!frame.isArray && key.length > maxKeyLength) { report('string-too-long', pointerOf(frame)); continue; }
      path = pointerOf(frame, key);
      const childOpen = openAt(frame.open, frame, key);
      // An open object's property keys are unknown-field bytes too; charged before the descriptor is read.
      if (childOpen && !frame.isArray && !chargeString(key, path)) break;
      const desc = Reflect.getOwnPropertyDescriptor(frame.src, key);
      if (desc === undefined) { report(frame.isArray ? 'sparse-array' : 'unreadable', path); continue; }
      if ('get' in desc || 'set' in desc) { report('accessor', path); continue; }
      const value = desc.value;
      if (frame.depth === 1 && rootGate && key === rootGate.key && (value === null || typeof value !== 'object')) {
        if (!rootGate.check(value)) { gate = { key, value }; report('gated', path); stopped = true; break; }
      }
      const put = (v) => (frame.isArray ? (frame.dst[Number(key)] = v) : define(frame.dst, key, v));
      if (value !== null && typeof value === 'object') {
        const child = openContainer(value, frame, key, put, childOpen);
        if (child) stack.push(child);
      } else if (admitPrimitive(value, path, childOpen)) {
        put(value);
      }
    } catch {
      // A throwing trap / revoked proxy / hostile getter on a reflective call. The thrown value is
      // never propagated or inspected (spec 5.3: reported as `unreadable`, never an escape).
      report('unreadable', path);
      stack.pop();
    }
  }

  if (issues.length > 0) {
    const out = { ok: false, issues, issuesTruncated: truncated, nodes };
    if (budgeted) out.openFieldBytes = openBytes;
    if (gate) out.gate = gate;
    return out;
  }
  return budgeted ? { ok: true, value: result, nodes, openFieldBytes: openBytes } : { ok: true, value: result, nodes };
}

/** Synchronous iterative deep freeze. Returns its argument. */
export function deepFreeze(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    Object.freeze(v);
    for (const k of Reflect.ownKeys(v)) stack.push(v[k]);
  }
  return value;
}

/**
 * Deep freeze in deadline-aware slices (spec 17.3): one `slicer.tick('freeze')` per node.
 * @param {{ tick: (label?: string) => (undefined | Promise<void>) }} slicer
 */
export async function deepFreezeSliced(value, slicer) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    Object.freeze(v);
    for (const k of Reflect.ownKeys(v)) stack.push(v[k]);
    const pending = slicer.tick('freeze');
    if (pending) await pending;
  }
  return value;
}

/** Test/diagnostic helper: true iff `value` and everything reachable from it is frozen. */
export function isDeepFrozen(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (!Object.isFrozen(v)) return false;
    for (const k of Reflect.ownKeys(v)) stack.push(v[k]);
  }
  return true;
}
