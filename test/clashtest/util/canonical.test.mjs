// test/clashtest/util/canonical.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DIGEST_VERSION, DIGEST_PREFIX, Sha256, canonicalJson, canonicalChunks, sha256Text, digestCanonical, digestCanonicalSliced,
} from '../../../clashtest/util/canonical.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';
import { createFakeClock } from '../support/index.mjs';

const nodeSha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

test('digest format constants', () => {
  assert.equal(DIGEST_VERSION, 1);
  assert.equal(DIGEST_PREFIX, 'sha256:');
  assert.match(digestCanonical({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
});

test('SHA-256: FIPS 180-4 vectors', () => {
  assert.equal(sha256Text(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Text('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    'sha256:248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256 agrees with node:crypto at every padding boundary and on multi-byte UTF-8', () => {
  for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1_000, 65_537]) {
    const s = 'x'.repeat(len);
    assert.equal(sha256Text(s), nodeSha(s), `len ${len}`);
  }
  const uni = 'é中\u{1F600}'.repeat(50);
  assert.equal(sha256Text(uni), nodeSha(uni));
});

test('SHA-256 is invariant under how the input is split into update() calls; finalised hashers refuse more input', () => {
  const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(40));
  const whole = new Sha256().update(bytes).digestHex();
  for (const step of [1, 3, 7, 63, 64, 65, 500]) {
    const h = new Sha256();
    for (let i = 0; i < bytes.length; i += step) h.update(bytes.subarray(i, i + step));
    assert.equal(h.digestHex(), whole, `step ${step}`);
  }
  const h = new Sha256(); h.digestHex();
  assert.throws(() => h.update(new Uint8Array(1)), /finalised/);
});

// Golden byte-level vectors (AC-1): entry permutations, Unicode, control characters, lone
// surrogates, -0 and exponent-form numbers. Expected strings are the normative output.
const GOLDEN = [
  ['key order', { b: 1, a: 2 }, '{"a":2,"b":1}'],
  ['nested key order + arrays keep order', { z: [3, 1, 2], a: { y: 1, x: 2 } }, '{"a":{"x":2,"y":1},"z":[3,1,2]}'],
  // U+1F600 is the code units D83D DE00, which sort BEFORE U+FF5E although its code point is larger.
  ['UTF-16 code-unit key order (not code point order)', { '\uFF5E': 2, '\u{1F600}': 1 }, '{"\u{1F600}":1,"\uFF5E":2}'],
  ['no insignificant whitespace, null/bool', { n: null, t: true, f: false, e: [], o: {} }, '{"e":[],"f":false,"n":null,"o":{},"t":true}'],
  ['non-ASCII is emitted raw', { k: 'é\u{1F600}' }, '{"k":"é\u{1F600}"}'],
  ['control characters: short forms and \\u00XX', 'a\u0000\b\t\n\f\r\u001f\u007f', '"a\\u0000\\b\\t\\n\\f\\r\\u001f\u007f"'],
  ['quote and backslash', 'q"b\\', '"q\\"b\\\\"'],
  ['lone surrogates are escaped, paired ones are not', '\ud800x\udc00\u{1F600}', '"\\ud800x\\udc00\u{1F600}"'],
  ['-0 normalises to 0', [-0, 0], '[0,0]'],
  ['exponent-form and shortest round-trip numbers', [1e21, 1e-7, 123456789012345680000, 0.1 + 0.2, 5e-324, 1.7976931348623157e308, 100, 1.5],
    '[1e+21,1e-7,123456789012345680000,0.30000000000000004,5e-324,1.7976931348623157e+308,100,1.5]'],
  ['entries permutation is NOT normalised here (normalisation is P2)', { entries: [{ kind: 'model', modelKey: 'b' }, { kind: 'model', modelKey: 'a' }] },
    '{"entries":[{"kind":"model","modelKey":"b"},{"kind":"model","modelKey":"a"}]}'],
];
for (const [name, value, expected] of GOLDEN) {
  test(`canonical golden: ${name}`, () => {
    assert.equal(canonicalJson(value), expected);
    assert.equal(digestCanonical(value), nodeSha(expected));       // digest == SHA-256 of exactly those UTF-8 bytes
    assert.equal([...canonicalChunks(value)].join(''), expected);
  });
}

test('pinned digests (regression pins; independently cross-checked against node:crypto above)', () => {
  assert.equal(digestCanonical({ b: 1, a: 2 }), 'sha256:d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772');
  assert.equal(digestCanonical([-0, 0]), 'sha256:3d5812abc84c11768aa73a732c85d75dbed439188f5bb3239e9b762ea31d9862');
});

test('key permutations give one digest; array order and role-tagging change it (swap of selectionA/selectionB differs)', () => {
  const x = { mode: 'volume-overlap', selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] }, selectionB: { entries: [{ kind: 'model', modelKey: 'b' }] } };
  const y = { selectionB: x.selectionB, mode: x.mode, selectionA: x.selectionA };
  const swapped = { mode: x.mode, selectionA: x.selectionB, selectionB: x.selectionA };
  assert.equal(digestCanonical(x), digestCanonical(y));
  assert.notEqual(digestCanonical(x), digestCanonical(swapped));
  assert.notEqual(digestCanonical([1, 2]), digestCanonical([2, 1]));
  assert.equal(digestCanonical(-0), digestCanonical(0));
});

test('canonical JSON parses back to the same value (round trip)', () => {
  const v = { a: [1, 'x', null, { b: true }], c: ' \ud800', d: 0.5 };
  assert.deepEqual(JSON.parse(canonicalJson(v)), v);
});

test('anything that is not plain JSON data is a TypeError (undefined, non-finite, function, symbol, bigint, Map, Date, class, cycle)', () => {
  class Foo {}
  const cyc = {}; cyc.self = cyc;
  for (const bad of [undefined, NaN, Infinity, -Infinity, () => 1, Symbol('s'), 1n, new Map(), new Date(0), new Foo(), cyc, { a: undefined }, [undefined]]) {
    assert.throws(() => canonicalJson(bad), TypeError, String(bad));
  }
});

test('sliced digest is byte-identical to the synchronous one, and yields on a large value', async () => {
  const value = { results: Array.from({ length: 5_000 }, (_, i) => ({ id: `r${i}`, p: [i, i / 3, -i], tags: ['a', 'b'] })) };
  const clock = createFakeClock({ tickMs: 1 });
  const slicer = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 4, checkEvery: 1 });
  const sliced = await digestCanonicalSliced(value, slicer);
  assert.equal(sliced, digestCanonical(value));
  assert.equal(sliced, nodeSha(canonicalJson(value)));
  assert.ok(clock.yieldCount > 0);
});

test('own properties outside plain data are a TypeError, never projected away or invoked (symbol key, non-enumerable, accessor)', () => {
  const sym = Symbol('hidden');
  const symKeyed = { x: 1, [sym]: 2 };
  assert.throws(() => canonicalJson(symKeyed), TypeError);
  assert.throws(() => digestCanonical(symKeyed), TypeError); // no digest collision with { x: 1 }
  assert.equal(digestCanonical({ x: 1 }), nodeSha('{"x":1}'));

  const hidden = { x: 1 };
  Object.defineProperty(hidden, 'h', { value: 2, enumerable: false });
  assert.throws(() => canonicalJson(hidden), TypeError);

  let calls = 0;
  const withGetter = { x: 1 };
  Object.defineProperty(withGetter, 'y', { get() { calls++; return 5; }, enumerable: true });
  assert.throws(() => canonicalJson(withGetter), TypeError);
  assert.throws(() => digestCanonical({ nested: [withGetter] }), TypeError);
  assert.equal(calls, 0, 'the getter is never invoked');
});

test('arrays: symbol keys, named own properties and index accessors / non-enumerable elements are a TypeError; plain arrays are unchanged', () => {
  const named = [1]; named.foo = 2;
  assert.throws(() => canonicalJson(named), TypeError);
  const symArr = [1]; symArr[Symbol('s')] = 2;
  assert.throws(() => canonicalJson(symArr), TypeError);
  let calls = 0;
  const acc = [0];
  Object.defineProperty(acc, 0, { get() { calls++; return 1; }, enumerable: true });
  assert.throws(() => canonicalJson(acc), TypeError);
  assert.equal(calls, 0, 'the index getter is never invoked');
  const hiddenEl = [0];
  Object.defineProperty(hiddenEl, 0, { value: 1, enumerable: false });
  assert.throws(() => canonicalJson(hiddenEl), TypeError);
  assert.throws(() => canonicalJson(new Array(2)), TypeError); // sparse
  assert.equal(canonicalJson([]), '[]');
  assert.equal(canonicalJson([1, [2, { b: 1, a: [3] }]]), '[1,[2,{"a":[3],"b":1}]]');
  assert.equal(canonicalJson(Object.create(null, { k: { value: 1, enumerable: true } })), '{"k":1}');
});

test('arrays behind a Proxy cannot smuggle a dropped element or a shifting length past validation', async () => {
  // ownKeys reports 'extra' in place of index 0: the count matches but the key set is not {length, 0}
  const swapped = new Proxy([1], { ownKeys: () => ['length', 'extra'] });
  assert.throws(() => canonicalJson(swapped), TypeError);
  // length read differently on each `get`: canonicalisation must not consult the get trap for it
  let reads = 0;
  const shifting = new Proxy([1], { get(t, k, r) { if (k === 'length') return reads++ === 0 ? 1 : 0; return Reflect.get(t, k, r); } });
  assert.doesNotThrow(() => canonicalJson(shifting));
  assert.equal(canonicalJson(shifting), '[1]');
  assert.equal(reads, 0, 'the array length is read from its descriptor, not through the get trap');
  assert.throws(() => digestCanonical(swapped), TypeError);
  const clock = createFakeClock();
  const slicer = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 4, checkEvery: 1 });
  const sound = await digestCanonicalSliced([1], slicer); // control: the same slicer accepts valid data
  assert.equal(sound, nodeSha('[1]'));
  await assert.rejects(() => digestCanonicalSliced(swapped, slicer), TypeError);
});
