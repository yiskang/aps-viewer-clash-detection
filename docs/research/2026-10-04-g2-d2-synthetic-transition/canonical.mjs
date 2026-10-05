// Canonical JSON serialization + SHA-256 (spec §15). Pure ESM, no I/O, no time/randomness.
// Decisions: UTF-8, no insignificant whitespace, keys sorted by UTF-16 code unit order (default sort),
// arrays keep order, -0 serializes as 0, non-finite numbers / undefined / function / symbol / bigint /
// non-plain objects / sparse arrays / cycles throw. canonicalBytes has NO trailing newline.
import { createHash } from 'node:crypto';

function isPlain(v) {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function ser(v, stack, path) {
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError(`canonicalStringify: non-finite number at ${path}`);
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'object': {
      if (v === null) return 'null';
      if (stack.includes(v)) throw new TypeError(`canonicalStringify: cycle at ${path}`);
      stack.push(v);
      let out;
      if (Array.isArray(v)) {
        const parts = [];
        for (let i = 0; i < v.length; i += 1) {
          if (!(i in v)) throw new TypeError(`canonicalStringify: sparse array at ${path}[${i}]`);
          parts.push(ser(v[i], stack, `${path}[${i}]`));
        }
        out = `[${parts.join(',')}]`;
      } else {
        if (!isPlain(v)) throw new TypeError(`canonicalStringify: non-plain object at ${path}`);
        if (Object.getOwnPropertySymbols(v).length) throw new TypeError(`canonicalStringify: symbol key at ${path}`);
        const keys = Object.keys(v).sort();
        out = `{${keys.map((k) => `${JSON.stringify(k)}:${ser(v[k], stack, `${path}.${k}`)}`).join(',')}}`;
      }
      stack.pop();
      return out;
    }
    default:
      throw new TypeError(`canonicalStringify: unsupported type ${typeof v} at ${path}`);
  }
}

export function canonicalStringify(value) {
  return ser(value, [], '$');
}

/** UTF-8 bytes of the canonical string; NO trailing newline. */
export function canonicalBytes(value) {
  return Buffer.from(canonicalStringify(value), 'utf8');
}

export function sha256Hex(data) {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex');
}
