// clashtest/derive/validate.js
import { InvalidOptionsError } from '../errors.js';
export const invalid = (code, path, message = code) => new InvalidOptionsError({ issues: [{ path, code, message }] });

/** A caller key in an issue path: bounded (the first 64 code units — lossy beyond that, like the engine's), a non-identifier key JSON-quoted, and a symbol never stringified (every symbol key reads `[symbol]`). */
export function keyPath(path, key) {
  if (typeof key !== 'string') return `${path}[symbol]`;
  const k = key.slice(0, 64);
  return /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
}

/**
 * The ONE closed-options capture of the derivation layer (§18 closed options; §5.3/R11-1 reflection rules; the engine's
 * `readReadOptions`/`readRerunOptions` pattern). `obj` must be a plain object (prototype `Object.prototype` or `null`);
 * ALL own keys are inspected (`Reflect.ownKeys` via the descriptors): a symbol key or a string key outside `allowed` —
 * enumerable or not — is `unknown-key`; an allowed key must be an ordinary enumerable DATA property (an accessor is refused
 * and its getter is NEVER invoked). A throwing Proxy trap (or a revoked Proxy) is `bad-shape`, never the trap's own error.
 * Returns a DETACHED copy — a fresh plain object holding each present allowed value, read exactly once from its descriptor.
 * Callers use the copy and never re-read `obj` (validated value === used value). Values are copied shallowly: a nested
 * caller object (a signal, a facet spec, a clause array, …) is captured by its own consumer.
 * @throws {InvalidOptionsError}
 */
export function captureClosed(obj, allowed, path, notObjectCode = 'not-an-object') {
  if (obj === null || typeof obj !== 'object') throw invalid(notObjectCode, path);
  let own;
  try {
    if (Array.isArray(obj)) throw invalid(notObjectCode, path);                  // (Array.isArray throws on a revoked Proxy)
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) throw invalid(notObjectCode, path);
    own = Object.getOwnPropertyDescriptors(obj);                                   // ownKeys + getOwnPropertyDescriptor traps, once
  } catch (e) {
    if (e instanceof InvalidOptionsError) throw e;
    throw invalid('bad-shape', path, 'unreadable');                                // a throwing / revoked Proxy: the trap's error is dropped
  }
  const issues = []; const copy = {};
  for (const key of Reflect.ownKeys(own)) {                                        // `own` is an ordinary object this function built
    const d = own[key];
    if (typeof key !== 'string' || !allowed.includes(key)) issues.push({ path: keyPath(path, key), code: 'unknown-key', message: 'unknown-key' });
    else if (!('value' in d) || !d.enumerable) issues.push({ path: keyPath(path, key), code: 'bad-shape', message: 'data-property-required' });
    else copy[key] = d.value;
  }
  if (issues.length) throw new InvalidOptionsError({ issues });
  return copy;
}

/**
 * The array equivalent of `captureClosed`: `arr` must be an array; its `length` is read once from its descriptor and passed to
 * `onLength` (which may throw a bound error BEFORE any element is read); every own key must be `length` or an index below it
 * (anything else is `unknown-key`); each element is read once from its own descriptor and must be an ordinary enumerable data
 * property (`bad-shape`; a hole reads as `undefined`, for the element's consumer to refuse). A throwing / revoked Proxy is
 * `bad-shape`. Returns a fresh array of the captured elements.
 * @throws {InvalidOptionsError}
 */
export function captureArray(arr, path, notArrayCode, onLength = () => {}) {
  let isArr;
  try { isArr = Array.isArray(arr); } catch { throw invalid('bad-shape', path, 'unreadable'); }
  if (!isArr) throw invalid(notArrayCode, path);
  let length; let keys;
  try {
    const ld = Reflect.getOwnPropertyDescriptor(arr, 'length');
    length = ld && ld.value;
    if (!Number.isSafeInteger(length) || length < 0) throw invalid('bad-shape', path, 'unreadable');
  } catch (e) {
    if (e instanceof InvalidOptionsError) throw e;
    throw invalid('bad-shape', path, 'unreadable');
  }
  onLength(length);
  const out = new Array(length); const issues = [];
  try {
    keys = Reflect.ownKeys(arr);
    for (const k of keys) {
      if (k === 'length') continue;
      if (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= length) issues.push({ path: keyPath(path, k), code: 'unknown-key', message: 'unknown-key' });
    }
    for (let i = 0; i < length; i++) {
      const d = Reflect.getOwnPropertyDescriptor(arr, String(i));
      if (d === undefined) out[i] = undefined;
      else if (!('value' in d) || !d.enumerable) issues.push({ path: `${path}[${i}]`, code: 'bad-shape', message: 'data-property-required' });
      else out[i] = d.value;
    }
  } catch {
    throw invalid('bad-shape', path, 'unreadable');
  }
  if (issues.length) throw new InvalidOptionsError({ issues });
  return out;
}

const isJsonLeaf = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });   // a '__proto__' key stays an own data key

/** One container node, read ONCE (guarded): its entries [key, value] from own enumerable DATA descriptors, and its empty copy. */
const TOO_MANY = Symbol('too-many');
function openJsonNode(src, room) {
  if (Array.isArray(src)) {                                                        // (throws on a revoked Proxy: caught by the caller)
    const ld = Reflect.getOwnPropertyDescriptor(src, 'length'); const length = ld && ld.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    if (length > room) return TOO_MANY;                                           // each element is >= 1 node: charged before reading
    const keys = Reflect.ownKeys(src);
    if (keys.length !== length + 1) return null;                                   // sparse, or a named / symbol own property
    const entries = new Array(length);
    for (let i = 0; i < length; i++) {
      const d = Reflect.getOwnPropertyDescriptor(src, String(i));
      if (!d || !('value' in d) || !d.enumerable) return null;                     // hole, accessor (never invoked) or non-enumerable
      entries[i] = [i, d.value];
    }
    for (const k of keys) if (k !== 'length' && (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= length)) return null;
    return { src, copy: new Array(length), entries, i: 0 };
  }
  const proto = Object.getPrototypeOf(src);
  if (proto !== Object.prototype && proto !== null) return null;                   // Date, Map, class instances, …
  const entries = []; const own = Reflect.ownKeys(src);
  if (own.length > room) return TOO_MANY;
  for (const k of own) {
    if (typeof k !== 'string') return null;                                        // symbol key
    const d = Reflect.getOwnPropertyDescriptor(src, k);
    if (!d || !('value' in d) || !d.enumerable) return null;                       // accessor (never invoked) or non-enumerable
    entries.push([k, d.value]);
  }
  return { src, copy: {}, entries, i: 0 };
}

/** §5.3/§13.6 capture contract: container nesting depth <= 64, the root container being depth 1 (as P0 `captureData`'s
 *  default and validateResultSet's MAX_DEPTH) — a data-format bound of every captured untrusted value, not a new limit. */
export const OPERAND_MAX_DEPTH = 64;

/**
 * An OWNED, detached, JSON-safe copy of a caller's filter operand (M2), taken ONCE during synchronous preparation.
 * ITERATIVE (explicit stack — nesting never touches the call stack), descriptor-based (every property is read once from its
 * own descriptor; an accessor is refused and NEVER invoked), and cycle-aware (a node already on the current path is a cycle;
 * a node reached again by another path — a shared, non-cyclic reference — reuses its finished copy, so a DAG stays a DAG and
 * its value is its tree expansion). Accepts exactly JSON data: null, strings, booleans, finite numbers, dense undecorated
 * arrays and plain objects (prototype Object.prototype or null) with string keys; anything else — a cycle, an accessor, a
 * symbol key, a non-enumerable property, a sparse or decorated array, a non-plain object, a non-finite number, undefined /
 * function / bigint / symbol, or a throwing / revoked Proxy — is `bad-value` (a trap's own error never escapes).
 * Bounded-resource safety is EXPLICIT (§5.3/§13.6: ceilings are charged BEFORE the copy is allocated):
 *  - container depth > OPERAND_MAX_DEPTH (64) is `operand-too-deep`, detected on the path (a shared node also by its height);
 *  - the EXPANDED (tree) node count — every value at every occurrence is one node, the `captureData` convention — is charged
 *    against `budget` as the walk goes (a shared node adds its memoised expanded size; a container is charged 1 + its entry
 *    count before its entries are read), so a heavily shared DAG over budget is `operand-too-large` promptly, never expanded.
 * Returns `{ value, nodes }`: the owned copy and its expanded node count (<= budget).
 * @throws {InvalidOptionsError}
 */
export function captureJsonOperand(root, path, budget) {
  const refuse = (code = 'bad-value') => invalid(code, path);
  if (!(budget >= 1)) throw refuse('operand-too-large');
  if (isJsonLeaf(root)) return { value: root, nodes: 1 };
  if (root === null || typeof root !== 'object') throw refuse();
  let charged = 0;
  const charge = (n) => { charged += n; if (charged > budget) throw refuse('operand-too-large'); };
  const open = (src) => {
    let f; try { f = openJsonNode(src, budget - charged - 1); } catch (e) { if (e instanceof InvalidOptionsError) throw e; throw refuse(); }
    if (f === null) throw refuse();
    if (f === TOO_MANY) throw refuse('operand-too-large');
    return f;
  };
  const onPath = new Set(); const finished = new Map();   // src -> { copy, size, height }
  const enter = (src) => {
    if (onPath.size + 1 > OPERAND_MAX_DEPTH) throw refuse('operand-too-deep');
    const f = open(src);                                                           // refuses a container whose entry count alone exceeds the room left
    charge(1);                                                                     // the container itself; each entry is charged as it is visited
    f.start = charged - 1; f.height = 1; onPath.add(src); return f;
  };
  const top = enter(root);
  const stack = [top];
  while (stack.length > 0) {
    const f = stack[stack.length - 1];
    if (f.i === f.entries.length) {
      stack.pop(); onPath.delete(f.src);
      const done = { copy: f.copy, size: charged - f.start, height: f.height };
      finished.set(f.src, done);
      const parent = stack[stack.length - 1]; if (parent && done.height + 1 > parent.height) parent.height = done.height + 1;
      continue;
    }
    const [k, v] = f.entries[f.i++];
    if (isJsonLeaf(v)) { charge(1); setOwn(f.copy, k, v); continue; }
    if (v === null || typeof v !== 'object') throw refuse();                       // undefined, function, bigint, symbol, NaN/±Infinity handled above
    if (onPath.has(v)) throw refuse();                                             // a cycle
    const seen = finished.get(v);
    if (seen !== undefined) {                                                      // shared, non-cyclic: reuse the finished copy
      if (onPath.size + seen.height > OPERAND_MAX_DEPTH) throw refuse('operand-too-deep');
      charge(seen.size); setOwn(f.copy, k, seen.copy);
      if (seen.height + 1 > f.height) f.height = seen.height + 1;
      continue;
    }
    const child = enter(v); setOwn(f.copy, k, child.copy); stack.push(child);
  }
  return { value: top.copy, nodes: charged };
}

/** Fail-closed (mirrors engine.js isAbortSignal, owner ruling #8): a value that throws while probed is not a signal. No method is invoked (the `aborted` getter is read). */
export function isAbortSignal(s) {
  if (s === null || typeof s !== 'object') return false;
  try {
    return typeof s.aborted === 'boolean' && typeof s.addEventListener === 'function';
  } catch {
    return false;
  }
}
