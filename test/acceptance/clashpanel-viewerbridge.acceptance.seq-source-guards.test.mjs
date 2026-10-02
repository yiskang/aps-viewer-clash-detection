// test/acceptance/clashpanel-viewerbridge.acceptance.seq-source-guards.test.mjs
//
// Before-live Medium 4: STATIC guards against a second authoritative sequence source being introduced by a
// (future) consumer of the single Node allocator. Complements the narrower structural guards in
// clashpanel-viewerbridge.acceptance.sequencing-guards.test.mjs (which pin the allocator, its one call site
// and the page/Node split); these guards are pattern-generic so a NEW consumer or helper is covered too.
//
//   s0  the accepted Node allocator implementation is byte-for-byte unchanged.
//   s1  every function that RECEIVES an injected sequence source (`nextSeq` / `seqOf` parameter, any alias)
//       honours it: calls it or forwards it as a sequence source. A consumer that keeps the parameter but
//       only type-checks / compares it (i.e. ignores it) fails. Known consumers must keep receiving it.
//   s2  every value written into an ordering-bearing field (`seq`, `*Seq`, `ord`, `*Ord`, `tick`, `*Tick`) is never SYNTHESIZED locally: no arithmetic / ++ / -- / += / -=, no number literal,
//       no `.length`, no clock reading, no `peek()` (re-reading without allocating), no template / tuple /
//       object composite, and no identifier that is a local counter (incremented in the same top-level
//       function, a `for` loop variable, or an array-callback index). Copies of existing authoritative seqs
//       (`e.seq`, `Math.max(A.endSeq, B.endSeq)`, `mapped`, ...), `null` and calls of the injected source pass.
//   s3  no allocator-SHAPED closure anywhere (any name): "increment X then return X" / "return ++X" /
//       "=> X += 1" / ... Only the accepted Node allocator and two documented legacy/offline fallbacks match.
//   s4  no composite ORDER reconstruction: a `.sort()` comparator that orders by a seq field may subtract only
//       seq fields (plus the stable `[1]` index tie-break) -- never a local round/index/phase counter.
//
// Deliberately allowed (no finding): diagnostic counters that never reach an ordering field (retry/round/drain
// counts, fatalCount, refCounter ids, opIndex/callIndex, loop indexes, tokenizer cursors, pageFatalSent ids).
// The explicit allowlists below are the complete set of tolerated matches on the current harness, each justified.
//
// Every guard is a pure `(source) => string[]`, clean on the real harness source and proven non-vacuous by
// mutation. Nothing here executes the harness, launches a browser or touches the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/** Replaces exactly one occurrence of `needle` (throws otherwise, so harness drift fails loudly). */
function mutate(src, needle, replacement) {
  const parts = src.split(needle);
  if (parts.length !== 2) throw new Error(`mutation needle must occur exactly once (found ${parts.length - 1}): ${needle}`);
  return parts.join(replacement);
}

/** Replaces EVERY occurrence of `needle` inside the named top-level declaration only (at least one must exist). */
function mutateAllIn(src, fnName, needle, replacement) {
  const d = analyze(src).byName.get(fnName);
  if (!d) throw new Error(`mutateAllIn: no function ${fnName}`);
  const body = src.slice(d.start, d.end);
  if (!body.includes(needle)) throw new Error(`mutateAllIn: needle not in ${fnName}: ${needle}`);
  return src.slice(0, d.start) + body.split(needle).join(replacement) + src.slice(d.end);
}

function analyze(src) {
  const tokens = H.tokenizeJs(src);
  const decls = H.findFunctionDeclarations(tokens);
  const byName = new Map();
  for (const d of decls) {
    d.text = src.slice(d.start, d.end);
    if (!byName.has(d.name)) byName.set(d.name, d);
  }
  const outermostAt = (off) => {
    let best = null;
    for (const d of decls) if (d.start <= off && off < d.end && (best === null || d.start < best.start)) best = d;
    return best;
  };
  const innermostAt = (off) => {
    let best = null;
    for (const d of decls) if (d.start <= off && off < d.end && (best === null || d.start > best.start)) best = d;
    return best;
  };
  return { src, tokens, decls, byName, outermostAt, innermostAt };
}

const isP = (t, v) => Boolean(t) && t.type === 'punct' && (v === undefined || t.value === v);
const isId = (t, v) => Boolean(t) && t.type === 'ident' && (v === undefined || t.value === v);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index of the token closing the bracket opened at `i`. */
function matchClose(tokens, i) {
  let depth = 0;
  for (let k = i; k < tokens.length; k += 1) {
    if (!isP(tokens[k])) continue;
    if (OPEN.has(tokens[k].value)) depth += 1;
    else if (CLOSE.has(tokens[k].value)) { depth -= 1; if (depth === 0) return k; }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// s0: the accepted single Node allocator is unchanged
// ---------------------------------------------------------------------------------------------
const ACCEPTED_ALLOCATOR = [
  'function createRunSeqAllocator() {',
  '  let last = 0;',
  '  return {',
  '    next() {',
  "      if (last + 1 >= PAGE_LOCAL_BASE) throw new RangeError('run seq allocator exhausted');",
  '      last += 1;',
  '      return last;',
  '    },',
  '    peek: () => last,',
  '  };',
  '}',
].join('\n');

function guardAllocatorUnchanged(src) {
  const d = analyze(src).byName.get('createRunSeqAllocator');
  if (!d) return ['missing-function:createRunSeqAllocator'];
  const v = d.text === ACCEPTED_ALLOCATOR ? [] : ['s0:node-allocator-implementation-changed'];
  // ...and the binding is never redefined / reassigned (a later `createRunSeqAllocator = () => ...` would replace it)
  const t = analyze(src).tokens;
  for (let k = 0; k < t.length; k += 1) {
    if (!isId(t[k], 'createRunSeqAllocator') || isP(t[k - 1], '.')) continue;
    const prev = t[k - 1];
    if (isId(prev) && ['function', 'const', 'let', 'var', 'class'].includes(prev.value) && t[k].start !== d.start + 'function '.length) v.push('s0:node-allocator-redeclared');
    if (isP(t[k + 1]) && /^(?:=|\+=|-=|\|\|=|&&=|\?\?=)$/.test(t[k + 1].value)) v.push('s0:node-allocator-rebound');
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// s1: a function that receives an injected sequence source honours it
// ---------------------------------------------------------------------------------------------
const SOURCE_PARAM_NAMES = new Set(['nextSeq', 'seqOf']);
// Every function that today receives the run's single counter (or the recorder's) as a parameter. Losing the
// parameter (e.g. renaming it to dodge s1) must fail closed: the Node call sites pass it by these names.
const REQUIRED_CONSUMERS = Object.freeze([
  'prepareC1Gate', 'createOperationLedger', 'finalizeNetworkLedgerAtCloseout', 'createFatalEventSink',
  'createCallRecorder', 'runChecksInPhaseOrder', 'createNetworkInstrumentation', 'applyPhaseRunFailureToState',
]);

const NOT_A_FUNCTION_HEAD = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'typeof', 'await', 'new']);

/**
 * Every function-like construct -- declaration, function expression, method, arrow (parenthesised parameter list) --
 * whose parameter list takes `nextSeq`/`seqOf` (any destructured alias): `[{name, aliases:Set, body:[from, to)}]`
 * in global token indexes.
 */
function sourceConsumers(a) {
  const t = a.tokens;
  const out = [];
  for (let k = 0; k < t.length; k += 1) {
    if (!isP(t[k], '(')) continue;
    const close = matchClose(t, k);
    if (close === -1) continue;
    const after = t[close + 1];
    let body = null;
    if (isP(after, '=>')) {
      if (isP(t[close + 2], '{')) body = [close + 3, matchClose(t, close + 2)];
      else { // expression body: up to the first depth-0 terminator
        let q = close + 2;
        let depth = 0;
        for (; q < t.length; q += 1) {
          if (!isP(t[q])) continue;
          if (OPEN.has(t[q].value)) depth += 1;
          else if (CLOSE.has(t[q].value)) { if (depth === 0) break; depth -= 1; } else if ((t[q].value === ',' || t[q].value === ';') && depth === 0) break;
        }
        body = [close + 2, q];
      }
    } else if (isP(after, '{') && (isId(t[k - 1]) && !NOT_A_FUNCTION_HEAD.has(t[k - 1].value))) {
      body = [close + 2, matchClose(t, close + 1)];
    }
    if (body === null) continue;
    const aliases = new Set();
    for (let q = k + 1; q < close; q += 1) {
      if (!isId(t[q]) || !SOURCE_PARAM_NAMES.has(t[q].value)) continue;
      if (!(isP(t[q - 1], '(') || isP(t[q - 1], '{') || isP(t[q - 1], ','))) continue; // a parameter / destructured key, not a default value
      // `{ nextSeq: alias = null }` renames; otherwise the parameter keeps its own name.
      if (isP(t[q + 1], ':') && isId(t[q + 2])) aliases.add(t[q + 2].value);
      else aliases.add(t[q].value);
    }
    if (aliases.size === 0) continue;
    // name: `function NAME(` / method `NAME(` / `NAME = (...) =>` / `NAME: (...) =>` / `NAME = function (`
    let j = k - 1;
    if (isId(t[j], 'async')) j -= 1;
    let name = '<anonymous>';
    if (isId(t[j]) && t[j].value !== 'function') name = t[j].value;
    else {
      let h = isId(t[j], 'function') ? j - 1 : j;
      if (isId(t[h], 'async')) h -= 1;
      if ((isP(t[h], '=') || isP(t[h], ':')) && isId(t[h - 1])) name = t[h - 1].value;
    }
    out.push({ name, aliases, body });
  }
  return out;
}

/** The alias token at `k` is a real use of the source: called, or forwarded as a sequence source (`nextSeq: ...alias...`, `{ seqOf }`). */
function honoursSource(t, k) {
  if (isP(t[k - 1], '.')) return false;
  if (isP(t[k + 1], '(') || (isP(t[k + 1], '?.') && isP(t[k + 2], '('))) return true; // call
  if (SOURCE_PARAM_NAMES.has(t[k].value) && (isP(t[k - 1], '{') || isP(t[k - 1], ',')) && (isP(t[k + 1], ',') || isP(t[k + 1], '}'))) return true; // shorthand forward
  // forwarded as the VALUE of a `nextSeq:` / `seqOf:` property: walk back to the start of the property value
  let depth = 0;
  for (let q = k - 1; q >= 0; q -= 1) {
    const x = t[q];
    if (!isP(x)) continue;
    if (CLOSE.has(x.value)) { depth += 1; continue; }
    if (OPEN.has(x.value)) { if (depth === 0) return false; depth -= 1; continue; }
    if (depth > 0) continue;
    if (x.value === ',' || x.value === ';') return false;
    if (x.value === ':' && isId(t[q - 1]) && SOURCE_PARAM_NAMES.has(t[q - 1].value) && (isP(t[q - 2], '{') || isP(t[q - 2], ','))) {
      // the alias must be a value operand there, not merely type-checked / compared (`typeof nextSeq === ...`)
      return !(isId(t[k - 1], 'typeof') || (isP(t[k + 1]) && ['===', '!==', '==', '!='].includes(t[k + 1].value)) || (isP(t[k - 1]) && ['===', '!==', '==', '!='].includes(t[k - 1].value)));
    }
  }
  return false;
}

function guardInjectedSourceHonored(src) {
  const a = analyze(src);
  const v = [];
  const consumers = sourceConsumers(a);
  const names = new Set(consumers.map((c) => c.name));
  for (const n of REQUIRED_CONSUMERS) if (!names.has(n)) v.push(`s1:consumer-no-longer-receives-injected-source:${n}`);
  for (const { name, aliases, body } of consumers) {
    for (const alias of aliases) {
      let honoured = 0;
      for (let k = body[0]; k < body[1]; k += 1) if (isId(a.tokens[k], alias) && honoursSource(a.tokens, k)) honoured += 1;
      if (honoured === 0) v.push(`s1:injected-source-ignored:${name}:${alias}`);
    }
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// s2: no locally synthesized value in an ordering-bearing field
// ---------------------------------------------------------------------------------------------
// (`order` is deliberately NOT included: the harness uses it for constant priority lists, never for a sequence value.)
const ORDER_FIELD_RE = /^(?:seq|ord|tick)$|(?:Seq|Ord|Tick)$/;
const ARITH = new Set(['+', '-', '*', '/', '%', '**', '<<', '>>', '>>>', '|', '&', '^', '++', '--', '+=', '-=', '*=', '|=', '<<=']);
const CLOCK_IDENTS = new Set(['Date', 'now', 'performance', 'hrtime', 'monotonicMs', 'nowIso']);
// Complete, justified set of tolerated synthesized values on the current harness (`fn|field|rhs` -> max count).
const S2_ALLOWED = new Map([
  // offline fixture builder (never on the live path): literal seqs describe a canned state.
  ['createOfflineRunStateFixture|finalizedSeq|1', 1],
  ['createOfflineRunStateFixture|startSeq|10 + 2 * i', 1],
  ['createOfflineRunStateFixture|terminalSeq|11 + 2 * i', 1],
  ['createOfflineRunStateFixture|gateSeq|2', 1],
  ['createOfflineRunStateFixture|c1FinalizedSeq|1', 1],
  ['createOfflineRunStateFixture|seq|1', 1],
  // validation probe descriptor in beginMutation: shape-checked then discarded (the real record uses nextSeq()).
  ['createOperationLedger|startSeq|1', 1],
  ['createOperationLedger|ackSeq|2', 2],
  // documented placeholder default ("before any sequenced event"); only in states that already fail closed.
  ['notStartedControlRun|seq|0', 1],
  ['failClosedControlRun|seq|0', 1],
  // legacy local numbering of the offline oracle event log when no recorder is supplied (live passes env.recorder).
  ['createMonotonicEventLog|seq|entries . length', 1],
  // THE page-local NON-authoritative ordinal source (> PAGE_LOCAL_BASE; Node remaps every ordinal at ingestion).
  ['createPageOrdinalSource|ord|last', 1],
]);

/** Counter-like identifiers / member paths per top-level function: incremented, `for` loop variables, callback indexes. */
function localCounters(a) {
  const by = new Map();
  const add = (off, name) => {
    const f = a.outermostAt(off);
    const key = f ? f.name : '<top>';
    if (!by.has(key)) by.set(key, new Set());
    by.get(key).add(name);
  };
  const t = a.tokens;
  const pathEndingAt = (k) => { // `a.b.c` ending at token k
    const parts = [t[k].value];
    let j = k - 1;
    while (isP(t[j], '.') && isId(t[j - 1])) { parts.unshift(t[j - 1].value); j -= 2; }
    return parts.join('.');
  };
  const pathStartingAt = (k) => {
    const parts = [t[k].value];
    let j = k + 1;
    while (isP(t[j], '.') && isId(t[j + 1])) { parts.push(t[j + 1].value); j += 2; }
    return parts.join('.');
  };
  for (let k = 0; k < t.length; k += 1) {
    if (isP(t[k]) && ['++', '--', '+=', '-='].includes(t[k].value)) {
      if (isId(t[k - 1])) add(t[k].start, pathEndingAt(k - 1));
      if ((t[k].value === '++' || t[k].value === '--') && isId(t[k + 1])) add(t[k].start, pathStartingAt(k + 1));
    }
    // X = X + n
    if (isId(t[k]) && isP(t[k + 1], '=') && isId(t[k + 2], t[k].value) && isP(t[k + 3]) && (t[k + 3].value === '+' || t[k + 3].value === '-')) add(t[k].start, t[k].value);
    if (isId(t[k], 'for') && isP(t[k + 1], '(') && isId(t[k + 2]) && ['let', 'var'].includes(t[k + 2].value) && isId(t[k + 3]) && isP(t[k + 4], '=')) add(t[k].start, t[k + 3].value);
    // `.map((e, i) =>` / `.forEach((x, idx) =>` ... index parameter
    if (isP(t[k], '.') && isId(t[k + 1]) && ['map', 'forEach', 'flatMap', 'filter', 'reduce', 'some', 'every', 'find', 'findIndex'].includes(t[k + 1].value)
      && isP(t[k + 2], '(') && isP(t[k + 3], '(') && isId(t[k + 4]) && isP(t[k + 5], ',') && isId(t[k + 6]) && (isP(t[k + 7], ')') || isP(t[k + 7], ','))) {
      add(t[k].start, t[k + 1].value === 'reduce' ? null : t[k + 6].value);
    }
  }
  for (const s of by.values()) s.delete(null);
  return by;
}

/** Every ordering-field write `X = rhs` / `{ X: rhs }` / `obj.X = rhs`: `[{fn, field, rhs:tokens, rhsText, off}]`. */
function orderFieldWrites(a) {
  const t = a.tokens;
  const out = [];
  for (let k = 0; k < t.length; k += 1) {
    if (!isId(t[k]) || !ORDER_FIELD_RE.test(t[k].value)) continue;
    const n = t[k + 1];
    if (!isP(n) || !(n.value === '=' || n.value === ':')) continue;
    if (n.value === ':' && !(isP(t[k - 1], '{') || isP(t[k - 1], ','))) continue; // ternary / label / type position
    const rhs = [];
    let depth = 0;
    let fnValued = false;
    for (let j = k + 2; j < t.length; j += 1) {
      const x = t[j];
      if (isP(x)) {
        if (OPEN.has(x.value)) depth += 1;
        else if (CLOSE.has(x.value)) { if (depth === 0) break; depth -= 1; } else if ((x.value === ',' || x.value === ';') && depth === 0) break;
        if (x.value === '=>' && depth === 0) fnValued = true;
      }
      rhs.push(x);
    }
    if (fnValued || rhs.length === 0) continue; // a function-valued binding is s3's domain
    const f = a.innermostAt(t[k].start);
    out.push({ fn: f ? f.name : '<top>', outer: (a.outermostAt(t[k].start) || { name: '<top>' }).name, field: t[k].value, rhs, rhsText: rhs.map((x) => (x.type === 'string' ? `'${x.value}'` : x.value)).join(' '), off: t[k].start });
  }
  return out;
}

function synthesisReasons(rhs, counters) {
  const why = [];
  if (isP(rhs[0], '{') || isP(rhs[0], '[')) why.push('composite-literal');
  let depth = 0;
  for (let j = 0; j < rhs.length; j += 1) {
    const x = rhs[j];
    if (isP(x) && OPEN.has(x.value)) depth += 1;
    if (isP(x) && CLOSE.has(x.value)) depth -= 1;
    if (isP(x) && ARITH.has(x.value)) why.push('arithmetic');
    if (x.type === 'template' && depth === 0) why.push('template'); // a template label passed INTO the source call is fine
    if (x.type === 'number' && !isP(rhs[j - 1], '[')) why.push('number-literal');
    if (isId(x, 'length') && isP(rhs[j - 1], '.') && !(rhs[j - 2] && rhs[j - 2].type === 'string')) why.push('length');
    if (isId(x) && CLOCK_IDENTS.has(x.value)) why.push('clock');
    if (isId(x, 'peek')) why.push('peek');
  }
  // a local counter used as (part of) the value: `seq: n`, `seq: g.count`, `seq: i` -- not as an index `arr[i].seq`
  const text = rhs.map((x) => (x.type === 'string' ? "''" : x.value)).join(' ').replace(/ \. /g, '.');
  for (const c of counters) {
    // not part of a longer name / member access, not an index (`[ i ]`), not itself accessed or called (`n.x`, `i[0]`, `f(`)
    const re = new RegExp(`(?<![\\w$.\\[] ?)(?<![\\w$.])${escRe(c)}(?![\\w$])(?! ?[.\\[(])`);
    if (re.test(text)) { why.push(`local-counter:${c}`); break; }
  }
  return [...new Set(why)];
}

function guardNoSynthesizedOrderValue(src) {
  const a = analyze(src);
  const v = [];
  const counters = localCounters(a);
  const used = new Map();
  for (const w of orderFieldWrites(a)) {
    const why = synthesisReasons(w.rhs, counters.get(w.outer) || new Set());
    if (why.length === 0) continue;
    const key = `${w.fn}|${w.field}|${w.rhsText}`;
    const max = S2_ALLOWED.get(key) || 0;
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    if (n <= max) continue;
    v.push(`s2:synthesized-order-value:${w.fn}:${w.field}:${why.join('+')}`);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// s3: no allocator-shaped closure under any name
// ---------------------------------------------------------------------------------------------
const P = '([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)';
const ALLOC_SHAPES = [
  // X += n; [no block boundary] return X;   /   X++; return X;   /   ++X; return X;   /   X = X + n; return X;
  new RegExp(`(?<![\\w$.])${P}\\s*(?:\\+=\\s*[\\w$.]+|\\+\\+)\\s*;[^{};]*?(?:;[^{};]*?)*?\\breturn\\s+\\1\\s*;`, 'g'),
  new RegExp(`\\+\\+\\s*${P}\\s*;\\s*return\\s+\\1\\s*;`, 'g'),
  new RegExp(`(?<![\\w$.])${P}\\s*=\\s*\\1\\s*\\+\\s*[\\w$.]+\\s*;\\s*return\\s+\\1\\s*;`, 'g'),
  // return ++X / return X++ / return X += n / return (X += n) / return X = X + n   (and the same as an arrow body)
  new RegExp(`(?:\\breturn\\b|=>)\\s*\\(?\\s*(?:\\+\\+\\s*${P}|${P}\\s*(?:\\+\\+|\\+=\\s*[\\w$.]+)|${P}\\s*=\\s*\\3\\s*\\+\\s*[\\w$.]+)`, 'g'),
];
// Complete, justified set of tolerated allocator-shaped closures (`fn|X` -> count).
const S3_ALLOWED = new Map([
  ['createRunSeqAllocator|last', 1], // THE single authoritative Node allocator
  // legacy offline fallback when NO external source is injected (live/page recorders are fed: guard (a) + s1)
  ['createCallRecorder|seqCounter', 1],
]);

function guardNoAllocatorShapedClosure(src) {
  const a = analyze(src);
  const v = [];
  const at = new Map(); // `fn|X@offset` -> `fn|X` (one hit per matched position)
  for (const re of ALLOC_SHAPES) {
    for (const m of src.matchAll(re)) {
      const f = a.innermostAt(m.index);
      const key = `${f ? f.name : '<top>'}|${m[1] || m[2] || m[3]}`;
      at.set(`${key}@${m.index}`, key);
    }
  }
  const byKey = new Map();
  for (const key of at.values()) byKey.set(key, (byKey.get(key) || 0) + 1);
  for (const [key, n] of byKey) if (n > (S3_ALLOWED.get(key) || 0)) v.push(`s3:allocator-shaped-closure:${key.replace('|', ':')}`);
  return v;
}

// ---------------------------------------------------------------------------------------------
// s4: no composite order reconstruction in seq-ordered sorts
// ---------------------------------------------------------------------------------------------
const SEQ_PROP_RE = /^(?:seq|\w*Seq)$/;
// Secondary keys of a seq-ordered comparator that are identities, never counters (only consulted on an equal seq).
const S4_ALLOWED_TIEBREAK_KEYS = new Set([
  'modelId', // buildPrefixSourceLedger: (startSeq, modelId 'A'|'B') -- a string identity tie-break
]);

function guardNoCompositeOrderSort(src) {
  const a = analyze(src);
  const v = [];
  const t = a.tokens;
  for (let k = 0; k + 2 < t.length; k += 1) {
    if (!(isP(t[k], '.') && (isId(t[k + 1], 'sort') || isId(t[k + 1], 'toSorted')) && isP(t[k + 2], '('))) continue;
    const close = matchClose(t, k + 2);
    const cmp = t.slice(k + 3, close);
    if (!cmp.some((x, j) => isId(x) && SEQ_PROP_RE.test(x.value) && isP(cmp[j - 1], '.'))) continue; // not a seq-ordered sort
    // every subtraction `<operand> - <operand>` whose operands are member paths must compare seq fields (or the
    // stable `[1]` index tie-break); a parenthesised / call / literal operand is not a field key and is skipped.
    const lastSegmentBackward = (j) => { // operand ending at cmp[j]
      const x = cmp[j];
      if (isId(x)) return x.value;
      if (isP(x, ']')) return cmp[j - 1] && cmp[j - 1].type === 'number' && isP(cmp[j - 2], '[') ? `[${cmp[j - 1].value}]` : '[?]';
      return null;
    };
    const lastSegmentForward = (j) => { // operand starting at cmp[j]
      if (!isId(cmp[j])) return null;
      let seg = cmp[j].value;
      let q = j + 1;
      for (;;) {
        if (isP(cmp[q], '.') && isId(cmp[q + 1])) { seg = cmp[q + 1].value; q += 2; continue; }
        if (isP(cmp[q], '[')) { const c = matchClose(cmp, q); seg = c === q + 2 && cmp[q + 1].type === 'number' ? `[${cmp[q + 1].value}]` : '[?]'; q = c + 1; continue; }
        break;
      }
      return isP(cmp[q], '(') ? null : seg; // a call result is not a field key
    };
    for (let j = 1; j + 1 < cmp.length; j += 1) {
      if (!(isP(cmp[j]) && ['-', '<', '>', '<=', '>='].includes(cmp[j].value))) continue; // subtraction or relational ordering decision
      for (const key of [lastSegmentBackward(j - 1), lastSegmentForward(j + 1)]) {
        if (key === null || SEQ_PROP_RE.test(key) || key === '[1]' || S4_ALLOWED_TIEBREAK_KEYS.has(key)) continue;
        v.push(`s4:composite-order-key:${(a.innermostAt(t[k].start) || { name: '<top>' }).name}:${key}`);
      }
    }
  }
  return [...new Set(v)];
}

// ---------------------------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------------------------

function expectClean(guard, name) {
  assert.deepEqual(guard(SOURCE), [], `${name}: the real harness must satisfy the guard`);
}
function expectDetects(guard, mutated, codePrefix, label) {
  const found = guard(mutated);
  assert.ok(found.length > 0, `${label}: mutation was NOT detected (vacuous guard)`);
  assert.ok(found.some((c) => c.includes(codePrefix)), `${label}: expected a "${codePrefix}" finding, got ${JSON.stringify(found)}`);
}
const ALL_GUARDS = { guardAllocatorUnchanged, guardInjectedSourceHonored, guardNoSynthesizedOrderValue, guardNoAllocatorShapedClosure, guardNoCompositeOrderSort };
/** Some guard reports a finding containing `codePrefix`. */
function expectAnyDetects(mutated, codePrefix, label) {
  const found = Object.values(ALL_GUARDS).flatMap((g) => g(mutated));
  assert.ok(found.some((c) => c.includes(codePrefix)), `${label}: expected a "${codePrefix}" finding, got ${JSON.stringify(found)}`);
}

test('seq-source guards: the real harness is clean under every guard', () => {
  for (const [name, g] of Object.entries(ALL_GUARDS)) expectClean(g, name);
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
});

test('seq-source guards: discovery is non-vacuous (every known consumer, counter and order-field write is seen)', () => {
  const a = analyze(SOURCE);
  const consumers = new Map(sourceConsumers(a).map((c) => [c.name, [...c.aliases]]));
  for (const n of REQUIRED_CONSUMERS) assert.ok(consumers.has(n), `consumer ${n} discovered`);
  // exactly these today: a NEW consumer of the injected source must be reviewed and listed (never silent)
  assert.deepEqual([...consumers.keys()].sort(), [...REQUIRED_CONSUMERS].sort(), 'injected-source consumers are exactly the reviewed set');
  assert.deepEqual(consumers.get('createCallRecorder'), ['externalNextSeq'], 'renamed destructured source resolved to its alias');
  assert.deepEqual(consumers.get('prepareC1Gate'), ['seqOf']);
  const writes = orderFieldWrites(a);
  assert.ok(writes.length > 60, `order-field writes discovered (${writes.length})`);
  for (const [fn, field] of [['createFatalEventSink', 'seq'], ['createOperationLedger', 'endSeq'], ['createRunAuthority', 'seq'], ['createNetworkInstrumentation', 'responseSeq'], ['runChecksInPhaseOrder', 'dispositionSeq']]) {
    assert.ok(writes.some((w) => w.fn === fn && w.field === field), `write ${fn}.${field} discovered`);
  }
  const counters = localCounters(a);
  // legitimate diagnostic counters ARE recognised as counters (and allowed only because they never reach an order field)
  assert.ok(counters.get('createFatalEventSink').has('errorLedger.fatalCount'));
  assert.ok(counters.get('createCallRecorder').has('refCounter'));
  assert.ok(counters.get('createRunAuthority').has('drainCount'));
  assert.ok(counters.get('g2FinalizeRunTransfer').has('round'));
  // every allowlist entry is actually used (no stale tolerance)
  const s2Keys = new Map();
  for (const w of writes) { const why = synthesisReasons(w.rhs, counters.get(w.outer) || new Set()); if (why.length) { const k = `${w.fn}|${w.field}|${w.rhsText}`; s2Keys.set(k, (s2Keys.get(k) || 0) + 1); } }
  assert.deepEqual([...s2Keys.entries()].sort(), [...S2_ALLOWED.entries()].sort(), 's2 allowlist is exactly the current set of tolerated values');
  // s4: the tie-break allowlist is live
  for (const key of [...S4_ALLOWED_TIEBREAK_KEYS]) {
    S4_ALLOWED_TIEBREAK_KEYS.delete(key);
    try { assert.ok(guardNoCompositeOrderSort(SOURCE).some((c) => c.endsWith(`:${key}`)), `s4 allowlist entry ${key} is live`); } finally { S4_ALLOWED_TIEBREAK_KEYS.add(key); }
  }
  // s3: the allowlist is exactly the current set of allocator-shaped closures (removing an entry makes the guard fail)
  for (const key of [...S3_ALLOWED.keys()]) {
    const [fn, x] = key.split('|');
    const n = S3_ALLOWED.get(key);
    S3_ALLOWED.delete(key);
    try { assert.ok(guardNoAllocatorShapedClosure(SOURCE).includes(`s3:allocator-shaped-closure:${fn}:${x}`), `s3 allowlist entry ${key} is live`); } finally { S3_ALLOWED.set(key, n); }
  }
});

test('s0: the accepted Node allocator implementation is unchanged', () => {
  expectDetects(guardAllocatorUnchanged, mutate(SOURCE, '      last += 1;\n      return last;\n    },\n    peek: () => last,', '      last += 2;\n      return last;\n    },\n    peek: () => last,'), 'node-allocator-implementation-changed', 'allocator stride changed');
  expectDetects(guardAllocatorUnchanged, `${SOURCE}\ncreateRunSeqAllocator = () => ({ next: () => Date.now(), peek: () => 0 });\n`, 's0:node-allocator-rebound', 'allocator binding replaced after its declaration');
  expectDetects(guardAllocatorUnchanged, `${SOURCE}\n{ const createRunSeqAllocator = () => ({ next: () => 1 }); void createRunSeqAllocator; }\n`, 's0:node-allocator-redeclared', 'allocator name shadowed by a second definition');
});

test('s1 mutation: a consumer that receives nextSeq but ignores it fails', () => {
  // ignored nextSeq: the sink keeps the parameter (and its typeof check) but numbers entries itself
  expectDetects(guardInjectedSourceHonored, mutate(SOURCE, "if (typeof nextSeq === 'function') entry.seq = nextSeq();", "if (typeof nextSeq === 'function') entry.seq = errorLedger.entries.length + 1;"), 'injected-source-ignored:createFatalEventSink:nextSeq', 'sink ignores nextSeq');
  // ignored nextSeq without any arithmetic: every allocation in the operation ledger switches to a clock
  expectDetects(guardInjectedSourceHonored, mutateAllIn(SOURCE, 'createOperationLedger', 'nextSeq()', 'clock.monotonicMs()'), 'injected-source-ignored:createOperationLedger:nextSeq', 'ops ledger ignores nextSeq');
  // ignored renamed alias: the recorder keeps `nextSeq: externalNextSeq` but always uses its own counter
  expectDetects(guardInjectedSourceHonored, mutate(SOURCE, "const nextSeq = typeof externalNextSeq === 'function' ? (kind, label) => externalNextSeq(attributionOf(), typeof kind === 'string' ? kind : 'alloc', typeof label === 'string' ? label : null) : () => { seqCounter += 1; return seqCounter; };", "const nextSeq = () => { seqCounter += 1; return seqCounter; };"), 'injected-source-ignored:createCallRecorder:externalNextSeq', 'recorder ignores the injected source');
  // a forwarder that stops forwarding (runner builds its recorder on the legacy local counter)
  expectDetects(guardInjectedSourceHonored, mutate(SOURCE, "createCallRecorder({ clock, nextSeq: typeof nextSeq === 'function' ? nextSeq : null })", 'createCallRecorder({ clock, nextSeq: null })'), 'injected-source-ignored:runChecksInPhaseOrder:nextSeq', 'runner drops the forwarded source');
  // a NEW consumer that takes nextSeq and ignores it
  expectDetects(guardInjectedSourceHonored, `${SOURCE}\nfunction createShadowLedger({ nextSeq }) { let n = 0; return { add(e) { if (typeof nextSeq !== 'function') return; n += 1; e.seq = n; } }; }\n`, 'injected-source-ignored:createShadowLedger:nextSeq', 'new consumer ignores nextSeq');
  // a mere reference is not honouring the source (void / coercion / logging)
  const SINK_ALLOC = "if (typeof nextSeq === 'function') entry.seq = nextSeq();";
  for (const [label, repl] of [['void', 'void nextSeq;'], ['coercion', 'entry.sequenced = Boolean(nextSeq);'], ['logging', 'console.debug(nextSeq);']]) {
    expectDetects(guardInjectedSourceHonored, mutate(SOURCE, SINK_ALLOC, repl), 'injected-source-ignored:createFatalEventSink:nextSeq', `sink only references nextSeq (${label})`);
  }
  // an ARROW-function consumer with a symbolically-incremented shadow allocator (no number literal anywhere)
  const SHADOW = `${SOURCE}\nconst makeShadowSource = () => {\n  let shadow = 0;\n  const step = 1;\n  return () => {\n    shadow += step;\n    return shadow;\n  };\n};\nconst createShadowLedger = ({ nextSeq }) => {\n  const own = makeShadowSource();\n  return { add(e) { e.seq = own(); } };\n};\n`;
  expectDetects(guardInjectedSourceHonored, SHADOW, 'injected-source-ignored:createShadowLedger:nextSeq', 'arrow consumer ignores nextSeq');
  expectDetects(guardNoAllocatorShapedClosure, SHADOW, ':shadow', 'symbolically-incremented shadow allocator');
  // a method-shorthand consumer
  expectDetects(guardInjectedSourceHonored, `${SOURCE}\nconst shadowApi = { build({ seqOf }) { return { seq: 7 }; } };\n`, 'injected-source-ignored:build:seqOf', 'method consumer ignores seqOf');
  // dodging s1 by renaming the parameter fails closed
  expectDetects(guardInjectedSourceHonored, mutate(SOURCE, 'function createFatalEventSink(errorLedger, { nextSeq = null } = {}) {', 'function createFatalEventSink(errorLedger, { counter = null } = {}) {\n  const nextSeq = counter;'), 'consumer-no-longer-receives-injected-source:createFatalEventSink', 'parameter renamed away');
});

test('s2 mutation: local authoritative increment / synthesized number in an ordering field fails', () => {
  // local authoritative increment bypassing the injected allocator (inside a consumer)
  expectDetects(guardNoSynthesizedOrderValue, mutate(SOURCE, '      rec.endSeq = nextSeq();\n      rec.endedAt = clock.nowIso();\n      rec.expectedRequestWindow', '      rec.endSeq = rec.startSeq + 1;\n      rec.endedAt = clock.nowIso();\n      rec.expectedRequestWindow'), 's2:synthesized-order-value:createOperationLedger:endSeq:arithmetic', 'endLoad increments startSeq locally');
  // runPostReservation feeds a consumer from a local counter instead of runSeq.next: the seq-named local counter is an
  // s2 finding (number literal in a *Seq binding) and the feeding closure is an allocator-shaped s3 finding.
  const LOCAL_FEED = mutate(SOURCE, 'const sink = createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });', 'let localSeq = 0;\n  const sink = createFatalEventSink(state.errorLedger, { nextSeq: () => { localSeq += 1; return localSeq; } });');
  expectDetects(guardNoSynthesizedOrderValue, LOCAL_FEED, 's2:synthesized-order-value:runPostReservation:localSeq:number-literal', 'runPostReservation seq-named local counter');
  expectDetects(guardNoAllocatorShapedClosure, LOCAL_FEED, 's3:allocator-shaped-closure:runPostReservation:localSeq', 'runPostReservation feeds a local counter closure');
  // the same with an innocuous name (no *Seq binding): still the s3 allocator shape
  expectDetects(guardNoAllocatorShapedClosure, mutate(SOURCE, 'const sink = createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });', 'let k = 0;\n  const sink = createFatalEventSink(state.errorLedger, { nextSeq: () => ++k });'), 's3:allocator-shaped-closure:runPostReservation:k', 'runPostReservation feeds an innocuously-named counter');
  expectDetects(guardNoSynthesizedOrderValue, mutate(SOURCE, "const seq = allocator.next();", 'const seq = ++ingestCount;'), 's2:synthesized-order-value:createRunAuthority:seq:arithmetic', 'authority numbers ingestions itself');
  expectDetects(guardNoSynthesizedOrderValue, mutate(SOURCE, "  const m = { seq: rec.nextSeq('alloc', `marker:${name}`), name };", '  markerCount += 1;\n  const m = { seq: markerCount, name };'), 'local-counter:markerCount', 'runner marker numbered by a local counter');
  expectDetects(guardNoSynthesizedOrderValue, mutate(SOURCE, '        const responseSeq = nextSeq();', '        const responseSeq = Date.now();'), 'clock', 'network response seq from the clock');
  expectDetects(guardNoSynthesizedOrderValue, mutate(SOURCE, "  state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' });", "  state.errorLedger.markers.push({ seq: runSeq.peek(), name: 'closeout' });"), 'peek', 'closeout marker re-reads instead of allocating');
  expectDetects(guardNoSynthesizedOrderValue, `${SOURCE}\nfunction g9(list) { return list.map((e, i) => ({ ...e, seq: i })); }\n`, 'local-counter:i', 'seq from a callback index');
  expectDetects(guardNoSynthesizedOrderValue, `${SOURCE}\nfunction g10(list) { const out = []; for (let k = 0; k < list.length; k += 1) out.push({ ord: k }); return out; }\n`, 'g10:ord', 'ordinal from a loop variable');
});

test('s3 mutation: a second allocator helper under any name fails', () => {
  expectDetects(guardNoAllocatorShapedClosure, `${SOURCE}\nfunction makeTicker() { let t = 0; return () => { t += 1; return t; }; }\n`, 's3:allocator-shaped-closure:makeTicker:t', 'second allocator helper (block body)');
  expectDetects(guardNoAllocatorShapedClosure, `${SOURCE}\nfunction makeTicker2() { let t = 0; return { next: () => ++t }; }\n`, 'makeTicker2:t', 'second allocator helper (++ arrow)');
  expectDetects(guardNoAllocatorShapedClosure, `${SOURCE}\nfunction makeTicker3() { let t = 0; return { next() { return (t += 1); } }; }\n`, 'makeTicker3:t', 'second allocator helper (return +=)');
  expectDetects(guardNoAllocatorShapedClosure, `${SOURCE}\nfunction makeTicker4() { const s = { n: 0 }; return () => { s.n = s.n + 1; return s.n; }; }\n`, 'makeTicker4:s.n', 'second allocator helper (member path)');
  // inside an existing consumer, under an innocuous name
  expectDetects(guardNoAllocatorShapedClosure, mutate(SOURCE, '  let sealed = false;\n  const byId = new Map();', '  let sealed = false;\n  let opNo = 0;\n  function bump() { opNo += 1; return opNo; }\n  const byId = new Map();'), 's3:allocator-shaped-closure:bump:opNo', 'helper-local allocator inside the operation ledger');
  // a second copy of the accepted allocator shape also fails (count-limited allowlist)
  expectDetects(guardNoAllocatorShapedClosure, `${SOURCE}\nfunction createRunSeqAllocatorCopy() { let last = 0; return { next() { last += 1; return last; } }; }\n`, 'createRunSeqAllocatorCopy:last', 'allocator copy');
});

test('s4 mutation: composite local ordering reconstruction fails', () => {
  const SORT = 'const eventLog = rec.events.slice().sort((a, b) => a.seq - b.seq);';
  expectDetects(guardNoCompositeOrderSort, mutate(SOURCE, SORT, 'const eventLog = rec.events.slice().sort((a, b) => (a.round - b.round) || (a.seq - b.seq));'), 's4:composite-order-key:runChecksInPhaseOrder:round', 'eventLog re-ordered by (round, seq)');
  expectDetects(guardNoCompositeOrderSort, `${SOURCE}\nfunction g11b(xs) { return xs.toSorted((a, b) => a.round - b.round || a.seq - b.seq); }\n`, 'g11b:round', 'toSorted composite comparator');
  expectDetects(guardNoCompositeOrderSort, `${SOURCE}\nfunction g11c(xs) { return xs.sort((a, b) => (a.round < b.round ? -1 : a.round > b.round ? 1 : a.seq - b.seq)); }\n`, 'g11c:round', 'relational composite comparator');
  expectDetects(guardNoCompositeOrderSort, `${SOURCE}\nfunction g11(xs) { return xs.sort((a, b) => a.phaseIdx - b.phaseIdx || a.seq - b.seq); }\n`, 'g11:phaseIdx', 'phase-major / seq-minor composite sort');
  // composite value reconstruction in an ordering field (page-major x local-minor) -- s2 composite/arithmetic
  expectAnyDetects(`${SOURCE}\nfunction g12(e, round, idx) { return { ...e, seq: round * 1000 + idx }; }\n`, 's2:synthesized-order-value:g12:seq:arithmetic', 'composite numeric seq');
  expectAnyDetects(`${SOURCE}\nfunction g13(e, round, idx) { return { ...e, seq: \`\${round}.\${idx}\` }; }\n`, 's2:synthesized-order-value:g13:seq:template', 'composite string seq');
  expectAnyDetects(`${SOURCE}\nfunction g14(e, round, idx) { return { ...e, seq: [round, idx] }; }\n`, 's2:synthesized-order-value:g14:seq:composite-literal', 'composite tuple seq');
  expectAnyDetects(mutate(SOURCE, "  state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' });", "  let closeRound = 0; closeRound += 1;\n  state.errorLedger.markers.push({ seq: { major: runSeq.next(), minor: closeRound }, name: 'closeout' });"), 'composite-literal', 'composite major/minor object seq');
});

test('seq-source guards stay narrow: legitimate diagnostic counters added to a consumer are allowed', () => {
  // a retry/round counter and an id counter inside a consumer, never written to an ordering field
  const ok = mutate(SOURCE, '  let sealed = false;\n  const byId = new Map();', '  let sealed = false;\n  let retries = 0;\n  let opIndex = 0;\n  const bumpRetry = () => { retries += 1; };\n  const byId = new Map();');
  const ok2 = mutate(ok, "      rec.endSeq = nextSeq();\n      rec.endedAt = clock.nowIso();\n      rec.terminalOutcome = terminalOutcome;", "      rec.endSeq = nextSeq();\n      opIndex += 1;\n      rec.opIndex = opIndex;\n      rec.retryCount = retries;\n      rec.endedAt = clock.nowIso();\n      rec.terminalOutcome = terminalOutcome;");
  for (const [name, g] of Object.entries(ALL_GUARDS)) assert.deepEqual(g(ok2), [], `${name} must allow diagnostic counters`);
  // copying an authoritative seq is allowed; an index tie-break in a seq sort is allowed
  const ok3 = `${SOURCE}\nfunction g15(xs) { return xs.map((e, i) => [e, i]).sort((a, b) => a[0].seq - b[0].seq || a[1] - b[1]).map(([e]) => ({ seq: e.seq, endSeq: Math.max(e.seq, e.endSeq) })); }\n`;
  for (const [name, g] of Object.entries(ALL_GUARDS)) assert.deepEqual(g(ok3), [], `${name} must allow copies and stable tie-breaks`);
});
