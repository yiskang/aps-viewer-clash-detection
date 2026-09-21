// clashtest/util/canonical.js
//
// Canonical JSON and the durable digest format (spec 5.4, 13.4). The OUTPUT BYTES are normative;
// the mechanism is not: this is a portable pure-JS incremental SHA-256 (no node:crypto, no Web
// Crypto), chosen because the same code must run in the browser and be sliceable to the
// `frameBudgetMs` span rule (spec 17.3).
//
// Canonical JSON: object keys sorted by UTF-16 code-unit order, no insignificant whitespace,
// strings by the ES2019 well-formed JSON.stringify algorithm (lone surrogates escaped, so every
// string has exactly one encoding), numbers by shortest round-trip Number#toString (finite only,
// -0 -> 0), arrays in their given order. `undefined`, functions, symbols, bigint, Map/Set, class
// instances and non-finite numbers are a TypeError: the engine only digests plain data it built.

export const DIGEST_VERSION = 1;
export const DIGEST_PREFIX = 'sha256:';

const MAX_CANONICAL_DEPTH = 128; // a cycle or an absurd nesting is a bug, not data

function* chunks(value, path, depth) {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError(`canonical: nesting deeper than ${MAX_CANONICAL_DEPTH} at ${path || '/'}`);
  if (value === null) { yield 'null'; return; }
  switch (typeof value) {
    case 'string': yield JSON.stringify(value); return;
    case 'boolean': yield value ? 'true' : 'false'; return;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonical: non-finite number at ${path || '/'}`);
      yield Object.is(value, -0) ? '0' : String(value);
      return;
    case 'object': break;
    default: throw new TypeError(`canonical: ${typeof value} is not serialisable at ${path || '/'}`);
  }
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) yield ',';
      yield* chunks(value[i], `${path}/${i}`, depth + 1);
    }
    yield ']';
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`canonical: non-plain object at ${path || '/'}`);
  const keys = Object.keys(value).sort(); // default sort = UTF-16 code-unit order
  yield '{';
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) yield ',';
    yield JSON.stringify(keys[i]);
    yield ':';
    yield* chunks(value[keys[i]], `${path}/${keys[i]}`, depth + 1);
  }
  yield '}';
}

/** Lazily yields the canonical JSON of `value` as string chunks (each chunk is whole tokens, never half a code point). */
export function canonicalChunks(value) { return chunks(value, '', 0); }

/** The canonical JSON string. */
export function canonicalJson(value) {
  let out = '';
  for (const c of chunks(value, '', 0)) out += c;
  return out;
}

// ---- SHA-256 (FIPS 180-4), incremental -------------------------------------------------------------------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

export class Sha256 {
  constructor() {
    this._h = Uint32Array.from(H0);
    this._buf = new Uint8Array(64);
    this._bufLen = 0;
    this._bytes = 0;
    this._w = new Uint32Array(64);
    this._done = false;
  }

  /** @param {Uint8Array} bytes */
  update(bytes) {
    if (this._done) throw new Error('Sha256: already finalised');
    const n = bytes.length;
    this._bytes += n;
    let i = 0;
    if (this._bufLen > 0) {
      const take = Math.min(64 - this._bufLen, n);
      this._buf.set(bytes.subarray(0, take), this._bufLen);
      this._bufLen += take;
      i = take;
      if (this._bufLen === 64) { this._block(this._buf, 0); this._bufLen = 0; }
    }
    for (; i + 64 <= n; i += 64) this._block(bytes, i);
    if (i < n) { this._buf.set(bytes.subarray(i), 0); this._bufLen = n - i; }
    return this;
  }

  _block(b, off) {
    const w = this._w;
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]; const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = w[t - 16] + s0 + w[t - 7] + s1; // Uint32Array store wraps mod 2^32
    }
    let [a, b1, c, d, e, f, g, h] = this._h;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b1) ^ (a & c) ^ (b1 & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b1; b1 = a; a = (t1 + t2) | 0;
    }
    const s = this._h;
    s[0] += a; s[1] += b1; s[2] += c; s[3] += d; s[4] += e; s[5] += f; s[6] += g; s[7] += h;
  }

  /** Finalise and return the 64-char lowercase hex digest. */
  digestHex() {
    const hi = Math.floor(this._bytes / 0x20000000);     // high 32 bits of the bit length
    const lo = (this._bytes % 0x20000000) * 8;            // low 32 bits of the bit length
    const padLen = (this._bufLen < 56 ? 56 - this._bufLen : 120 - this._bufLen) + 8;
    const pad = new Uint8Array(padLen);
    pad[0] = 0x80;
    for (let k = 0; k < 4; k++) { pad[padLen - 8 + k] = (hi >>> (24 - 8 * k)) & 0xff; pad[padLen - 4 + k] = (lo >>> (24 - 8 * k)) & 0xff; }
    this.update(pad);
    this._done = true;
    return Array.from(this._h, (v) => v.toString(16).padStart(8, '0')).join('');
  }
}

const encoder = new TextEncoder();

/** `"sha256:" + hex` of the UTF-8 bytes of `text` (test / small-input convenience). */
export function sha256Text(text) { return DIGEST_PREFIX + new Sha256().update(encoder.encode(text)).digestHex(); }

/** Synchronous digest of the canonical JSON of `value`. Use only for small values; large ones use the sliced form. */
export function digestCanonical(value) {
  const sha = new Sha256();
  for (const c of chunks(value, '', 0)) sha.update(encoder.encode(c));
  return DIGEST_PREFIX + sha.digestHex();
}

/**
 * Digest of the canonical JSON of `value`, in deadline-aware slices (spec 17.3): one `slicer.tick`
 * per ~8 KiB of canonical text. The result is byte-identical to `digestCanonical`.
 * @param {{ tick: (label?: string) => (undefined | Promise<void>) }} slicer
 */
export async function digestCanonicalSliced(value, slicer, { label = 'digest' } = {}) {
  const sha = new Sha256();
  let pending = '';
  for (const c of chunks(value, '', 0)) {
    pending += c;
    if (pending.length >= 8192) {
      sha.update(encoder.encode(pending));
      pending = '';
      const p = slicer.tick(label);
      if (p) await p;
    }
  }
  if (pending) sha.update(encoder.encode(pending));
  return DIGEST_PREFIX + sha.digestHex();
}
