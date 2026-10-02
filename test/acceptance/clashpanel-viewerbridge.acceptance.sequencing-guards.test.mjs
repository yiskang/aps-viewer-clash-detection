// test/acceptance/clashpanel-viewerbridge.acceptance.sequencing-guards.test.mjs
//
// Narrow STATIC guards over the harness source text for the accepted G2 H1 sequencing contract
// (single authoritative Node-side allocator; page-local ordinals are non-authoritative; awaited fences).
// Each guard is a pure `(source) => string[]` (violation codes). Every guard is proven non-vacuous: it
// returns [] on the real harness source and a specific code on a copy mutated to reintroduce the banned
// construct. Nothing here executes the harness, launches a browser or touches the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/** Replaces exactly one occurrence of `needle` (throws otherwise, so harness drift fails loudly, never silently). */
function mutate(src, needle, replacement) {
  const parts = src.split(needle);
  if (parts.length !== 2) throw new Error(`mutation needle must occur exactly once (found ${parts.length - 1}): ${needle}`);
  return parts.join(replacement);
}

function analyze(src) {
  const tokens = H.tokenizeJs(src);
  const decls = H.findFunctionDeclarations(tokens);
  const byName = new Map();
  for (const d of decls) {
    d.text = src.slice(d.start, d.end);
    d.identSet = new Set(d.tokens.filter((t) => t.type === 'ident').map((t) => t.value));
    if (!byName.has(d.name)) byName.set(d.name, d);
  }
  const outermostAt = (off) => {
    let best = null;
    for (const d of decls) if (d.start <= off && off < d.end && (best === null || d.start < best.start)) best = d;
    return best;
  };
  return { src, tokens, decls, byName, outermostAt };
}

function need(a, name, v) {
  const f = a.byName.get(name);
  if (!f) v.push(`missing-function:${name}`);
  return f || null;
}

const identsOf = (d) => d.tokens.filter((t) => t.type === 'ident');
const isPageSideName = (n) => n === 'createPageOrdinalSource' || n.startsWith('g2');
const countOf = (text, re) => (text.match(re) || []).length;

/** Token indexes of `name(` call sites (not declarations). */
function callSites(a, name) {
  const out = [];
  for (let i = 0; i < a.tokens.length; i += 1) {
    const t = a.tokens[i];
    if (t.type !== 'ident' || t.value !== name) continue;
    const next = a.tokens[i + 1];
    const prev = a.tokens[i - 1];
    if (!next || next.value !== '(') continue;
    if (prev && prev.type === 'ident' && prev.value === 'function') continue;
    out.push(t.start);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// (a) no authoritative page-side sequence allocator
// ---------------------------------------------------------------------------------------------
function guardNoPageAllocator(src) {
  const a = analyze(src);
  const v = [];
  const pageSrc = need(a, 'createPageOrdinalSource', v);
  if (pageSrc && !/\blet last = PAGE_LOCAL_BASE;/.test(pageSrc.text)) v.push('a:page-ordinal-source-not-based-above-PAGE_LOCAL_BASE');
  for (const d of a.decls) {
    if (!isPageSideName(d.name)) continue;
    // The in-page code can never reach the Node allocator or the authority (nothing it computes enters authoritative state un-ingested).
    for (const banned of ['createRunSeqAllocator', 'runSeq', 'createRunAuthority', 'authority', 'seqOfOrdinal', 'rewritePageRun', 'allocator']) {
      if (d.identSet.has(banned)) v.push(`a:page-code-references-node-allocator:${d.name}:${banned}`);
    }
    if (d.name === 'createPageOrdinalSource') continue;
    // ...and cannot hold its own seq counter.
    if (/\b\w*[sS]eq\w*\s*(\+=|-=|\+\+)|(\+\+|--)\s*\w*[sS]eq\b/.test(d.text)) v.push(`a:page-side-seq-increment:${d.name}`);
    if (/\b(?:let|var)\s+\w*(?:[sS]eq|[oO]rd)\w*\s*=\s*\d/.test(d.text)) v.push(`a:page-side-seq-counter-init:${d.name}`);
    // Any recorder built in the page must be fed ONLY by the non-authoritative ordinal source.
    for (const m of d.text.matchAll(/\bnextSeq\s*:\s*([^,}\s]+)/g)) if (m[1] !== 'pageSeq.next') v.push(`a:page-recorder-nextSeq-not-ordinal-source:${d.name}:${m[1]}`);
    for (const m of d.text.matchAll(/\bcreateCallRecorder\(([^)]*)\)/g)) if (!/^\{\s*nextSeq:\s*pageSeq\.next\s*\}$/.test(m[1].trim())) v.push(`a:page-createCallRecorder-unfed:${d.name}`);
  }
  const env = need(a, 'g2BuildEnv', v);
  if (env && countOf(env.text, /createCallRecorder\(\{\s*nextSeq:\s*pageSeq\.next\s*\}\)/g) !== 1) v.push('a:g2BuildEnv-recorder-not-on-page-ordinal-source');
  if (env && !/const pageSeq = createPageOrdinalSource\(/.test(env.text)) v.push('a:g2BuildEnv-pageSeq-not-createPageOrdinalSource');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (b) no second authoritative counter / run allocator
// ---------------------------------------------------------------------------------------------
const BANNED_IDENTS = ['SEQ_STRIDE', 'SEQ_MINOR_RESERVED', 'realmOfSeq', 'createPageSeqSource', 'createRunSeqCounter', 'ingestHw', 'ingestPage', 'pageMajor'];
const SEQ_FACTORY_NAME_RE = /^create\w*(?:Seq|Sequence|Ordinal)\w*$|^create\w*(?:Counter|Allocator)$/;
const ALLOWED_SEQ_FACTORIES = new Set(['createRunSeqAllocator', 'createPageOrdinalSource']);

function guardSingleAllocator(src) {
  const a = analyze(src);
  const v = [];
  const ids = a.tokens.filter((t) => t.type === 'ident');
  for (let i = 0; i < a.tokens.length; i += 1) {
    const t = a.tokens[i];
    if (t.type === 'ident' && BANNED_IDENTS.includes(t.value)) v.push(`b:banned-composite-name:${t.value}`);
    if (t.type === 'ident' && t.value === 'observe' && a.tokens[i + 1] && a.tokens[i + 1].value === '(') v.push('b:banned-observe(');
    if (t.type === 'ident' && t.value === 'major' && a.tokens[i + 1] && a.tokens[i + 1].value === '*') v.push('b:banned-major*');
  }
  void ids;
  for (const d of a.decls) if (SEQ_FACTORY_NAME_RE.test(d.name) && !ALLOWED_SEQ_FACTORIES.has(d.name)) v.push(`b:second-seq-factory:${d.name}`);
  const sites = callSites(a, 'createRunSeqAllocator');
  if (sites.length !== 1) v.push(`b:createRunSeqAllocator-call-sites:${sites.length}`);
  for (const off of sites) { const f = a.outermostAt(off); if (!f || f.name !== 'runPostReservation') v.push(`b:createRunSeqAllocator-called-outside-runPostReservation:${f ? f.name : 'top-level'}`); }
  const rpr = need(a, 'runPostReservation', v);
  if (rpr && /\b(?:let|var)\s+\w*(?:[sS]eq|[cC]ounter)\w*\s*=\s*\d/.test(rpr.text)) v.push('b:runPostReservation-local-seq-counter');
  if (rpr && /\b\w*[sS]eq\w*\s*(\+=|\+\+)|(\+\+)\s*\w*[sS]eq\b/.test(rpr.text)) v.push('b:runPostReservation-local-seq-increment');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (c) no composite page-major / Node-minor ordering
// ---------------------------------------------------------------------------------------------
function guardNoCompositeOrdering(src) {
  const a = analyze(src);
  const v = [];
  const alloc = need(a, 'createRunSeqAllocator', v);
  if (alloc) {
    if (!/^(?:async\s+)?function createRunSeqAllocator\(\s*\)/.test(alloc.text)) v.push('c:allocator-takes-parameters');
    if (countOf(alloc.text, /\blast \+= 1;/g) !== 1) v.push('c:allocator-not-a-single-increment');
    if (!/\breturn last;/.test(alloc.text)) v.push('c:allocator-does-not-return-plain-last');
    if (/\*|<<|Math\.imul|\bhw\b|\bmajor\b|\bstride\b/i.test(alloc.text)) v.push('c:allocator-composes-value');
  }
  // Every allocation is a plain next(): no argument (a major / high-water) is ever mixed in.
  for (const m of src.matchAll(/\b(?:allocator|runSeq)\.next\(\s*([^)\s][^)]*)\)/g)) v.push(`c:allocator-next-with-argument:${m[1].slice(0, 30)}`);
  for (const name of ['createRunAuthority', 'remapPageOrdinals', 'runPostReservation']) {
    const f = need(a, name, v);
    if (!f) continue;
    for (let i = 0; i < f.tokens.length; i += 1) if (f.tokens[i].type === 'punct' && (f.tokens[i].value === '*' || f.tokens[i].value === '<<')) v.push(`c:composite-arithmetic-in:${name}`);
  }
  const auth = a.byName.get('createRunAuthority');
  // Node ingestion order is the only order: the fence must prove page high-water == last ingested ordinal, not combine them.
  if (auth && !/ingest-hw-mismatch/.test(auth.text)) v.push('c:authority-ingest-hw-check-missing');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (d) no direct verdict use of a page-local ordinal in Node-side verdict/closeout code
// ---------------------------------------------------------------------------------------------
const ORDINAL_IDENTS = new Set(['PAGE_LOCAL_BASE', 'isPageLocalOrdinal', 'remapPageOrdinals', 'seqOfOrdinal', 'rewritePageRun', 'translateSpyRef']);
// Where page-local ordinals may legitimately appear: the ordinal machinery itself, the leak check, the authority and its Node wiring.
const ORDINAL_ALLOWED = new Set(['isPageLocalOrdinal', 'createRunSeqAllocator', 'createPageOrdinalSource', 'remapPageOrdinals', 'createRunAuthority', 'primarySeqAllocations', 'runPostReservation', 'g2FenceReport']);
// In-page cleanup drain: may compare against the page-local BASE (its delta boundary default) and nothing else of the ordinal machinery.
const ORDINAL_ALLOWED_PARTIAL = new Map([['g2CleanupDrain', new Set(['PAGE_LOCAL_BASE'])]]);

function guardNoDirectPageOrdinalVerdictUse(src) {
  const a = analyze(src);
  const v = [];
  for (const t of a.tokens) {
    if (t.type !== 'ident' || !ORDINAL_IDENTS.has(t.value)) continue;
    const f = a.outermostAt(t.start);
    if (!f) continue; // top-level definition/export lists
    if (ORDINAL_ALLOWED.has(f.name)) continue;
    const partial = ORDINAL_ALLOWED_PARTIAL.get(f.name);
    if (!partial || !partial.has(t.value)) v.push(`d:page-ordinal-use-in:${f.name}:${t.value}`);
  }
  const leak = need(a, 'primarySeqAllocations', v);
  if (leak) {
    for (const t of leak.tokens) if (t.type === 'ident' && ORDINAL_IDENTS.has(t.value) && t.value !== 'isPageLocalOrdinal') v.push(`d:leak-check-uses-more-than-isPageLocalOrdinal:${t.value}`);
    if (!/page-ordinal-leaked/.test(leak.text)) v.push('d:leak-check-lost');
  }
  // Every verdict/closeout/recompute-named function must be ordinal-free (belt and braces over the allowlist).
  for (const d of a.decls) {
    if (!/closeout|verdict|recompute|prepareC1Gate|finalizeNetworkLedger/i.test(d.name)) continue;
    for (const id of ORDINAL_IDENTS) if (d.identSet.has(id)) v.push(`d:verdict-function-references-page-ordinal:${d.name}:${id}`);
  }
  // The closeout re-validates authoritative state: assertAllocated runs before the closeout marker is allocated.
  const rpr = need(a, 'runPostReservation', v);
  if (rpr) {
    const j = rpr.text.indexOf("name: 'closeout'");
    const i = j === -1 ? -1 : rpr.text.slice(0, j).lastIndexOf('authority.assertAllocated(maxRecordedSeq(state));');
    if (i === -1 || j - i > 120) v.push('d:closeout-missing-assertAllocated-before-marker');
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// (e) awaited verdict-bearing page->Node delivery
// ---------------------------------------------------------------------------------------------
const VERDICT_BINDING_OWNER = Object.freeze({
  G2_NODE_SYNC_BINDING: 'g2NodeSync',
  G2_NODE_OPLEDGER_BINDING: 'g2NodeOps',
  G2_NODE_INGEST_BINDING: 'g2BuildEnv', // early hint only (reconciled by the awaited fences)
  G2_NODE_FATAL_BINDING: 'g2AgentReady', // page-fatal forward (reconciled at gate + drain)
});

/** Every `fn(` call in `text` must be directly preceded by `await `. */
function unawaitedCalls(text, callee) {
  const bad = [];
  const re = new RegExp(`(?<!function )\\b${callee}\\(`, 'g');
  for (const m of text.matchAll(re)) if (!/await\s*$/.test(text.slice(Math.max(0, m.index - 12), m.index))) bad.push(m.index);
  return bad;
}

function fenceShape(f, name, v, { demandThrows }) {
  if (!f) return;
  if (!/const call = async \(/.test(f.text)) v.push(`e:${name}-call-not-async`);
  if (countOf(f.text, /\bawait fn\(/g) !== 1) v.push(`e:${name}-binding-call-not-exactly-one-await`);
  if (unawaitedCalls(f.text, 'fn').length > 0) v.push(`e:${name}-unawaited-binding-call`);
  if (/\.then\(|\.catch\(|\bvoid\b/.test(f.text)) v.push(`e:${name}-fire-and-forget-chaining`);
  const iR = f.text.indexOf('g2FenceReport()');
  const iA = f.text.indexOf('await fn(');
  const iK = f.text.indexOf('g2FenceAck(');
  if (!(iR !== -1 && iA !== -1 && iK !== -1 && iR < iA && iA < iK)) v.push(`e:${name}-fence-order-report-await-ack`);
  if (!/await fn\(action, \{[^}]*\.\.\.f\b/.test(f.text)) v.push(`e:${name}-fence-does-not-carry-g2FenceReport`);
  // Every wrapper-level call(...) is awaited (or is the returned body of an async arrow).
  for (const m of f.text.matchAll(/(?<!const )\bcall\(/g)) {
    const before = f.text.slice(Math.max(0, m.index - 24), m.index);
    if (!/(await\s*\(?\s*|=>\s*)$/.test(before)) v.push(`e:${name}-unawaited-call-wrapper`);
  }
  if (demandThrows) {
    if (!/const demand = \(r, what\) => \{[^}]*r\.ok !== true[^}]*throw new Error\(/.test(f.text)) v.push(`e:${name}-refusal-does-not-throw`);
    if (!/demand\(await fn\(/.test(f.text)) v.push(`e:${name}-result-not-demanded`);
  }
}

function guardAwaitedDelivery(src) {
  const a = analyze(src);
  const v = [];
  const sync = need(a, 'g2NodeSync', v);
  const ops = need(a, 'g2NodeOps', v);
  fenceShape(sync, 'g2NodeSync', v, { demandThrows: true });
  fenceShape(ops, 'g2NodeOps', v, { demandThrows: false }); // refusal is surfaced as {ok:false} (consumer records nothing and the Node ingest violation is already a fatal)
  if (sync) {
    if (!/\.\.\.f,\s*pageFatalSent:\s*g\.pageFatalSent/.test(sync.text)) v.push('e:g2NodeSync-does-not-carry-pageFatalSent');
    for (const k of ['attribution', 'gate', 'drain']) if (!new RegExp(`\\b${k}:\\s*async\\b`).test(sync.text)) v.push(`e:g2NodeSync-${k}-not-async`);
    if (!/gate:\s*async \(c1\) => \(await call\('gate'/.test(sync.text)) v.push('e:g2NodeSync-gate-not-awaited');
  }
  // g2FenceAck prunes only after an ok result.
  const ack = need(a, 'g2FenceAck', v);
  if (ack && !/if \(q && result && result\.ok === true\) q\.ack\(report\.hw\);/.test(ack.text)) v.push('e:g2FenceAck-not-gated-on-ok');
  const rep = need(a, 'g2FenceReport', v);
  if (rep && !(/hw:\s*q\.highWater\(\)/.test(rep.text) && /pending:\s*q\.pending\(\)/.test(rep.text))) v.push('e:g2FenceReport-missing-pending-or-hw');
  // The ONLY non-awaited deliveries: early ingest hint (g2BuildEnv) and page-fatal forward (g2AgentReady); nothing else touches a verdict binding.
  for (const t of a.tokens) {
    if (t.type !== 'ident' || !Object.hasOwn(VERDICT_BINDING_OWNER, t.value)) continue;
    const f = a.outermostAt(t.start);
    if (!f) continue; // constant definition / export / Node exposeFunction at top level
    if (f.name === 'runPostReservation') continue; // Node-side exposeFunction wiring
    if (f.name !== VERDICT_BINDING_OWNER[t.value]) v.push(`e:verdict-binding-used-outside-owner:${t.value}:${f.name}`);
  }
  const env = need(a, 'g2BuildEnv', v);
  if (env) {
    if (countOf(env.text, /\bingestFn\(/g) !== 1) v.push('e:g2BuildEnv-ingest-hint-not-single');
    if (!/deliver:\s*typeof ingestFn === 'function' \? \(entry\) => \{ Promise\.resolve\(ingestFn\(entry\)\)\.catch\(\(\) => \{\}\); \} : null/.test(env.text)) v.push('e:g2BuildEnv-ingest-hint-shape-changed');
  }
  const ready = need(a, 'g2AgentReady', v);
  if (ready) {
    if (!/g\.pageFatalSent \+= 1;/.test(ready.text)) v.push('e:g2AgentReady-fatal-not-numbered');
    if (!/const meta = \{ id: g\.pageFatalSent, \.\.\.g2FenceReport\(\) \};/.test(ready.text)) v.push('e:g2AgentReady-forward-lacks-g2FenceReport');
    if (countOf(ready.text, /\bfn\(kind, detail, meta\)/g) !== 1) v.push('e:g2AgentReady-forward-not-single');
  }
  // Reconciliation of the non-awaited paths by the awaited fences, on the Node side.
  const rpr = need(a, 'runPostReservation', v);
  if (rpr) {
    const t = rpr.text;
    const syncAt = t.indexOf('exposeFunction(G2_NODE_SYNC_BINDING');
    const syncBody = syncAt === -1 ? '' : t.slice(syncAt, t.indexOf('return { ok: false, reason: \'unknown-action\' }', syncAt));
    if (!syncBody) v.push('e:sync-binding-not-found');
    const drain = syncBody.slice(syncBody.indexOf("action === 'drain'"), syncBody.indexOf("action === 'gate'"));
    const gate = syncBody.slice(syncBody.indexOf("action === 'gate'"));
    for (const [nm, seg] of [['drain', drain], ['gate', gate]]) {
      const iI = seg.indexOf('authority.ingestFence(a)');
      const iR = seg.indexOf('authority.reconcilePageFatals(a.pageFatalSent)');
      if (!(iI !== -1 && iR !== -1 && iI < iR)) v.push(`e:${nm}-fence-missing-ingest-then-reconcilePageFatals`);
      if (!/if \(!ing\.ok\) return ing;/.test(seg)) v.push(`e:${nm}-fence-ignores-ingest-refusal`);
    }
    if (!/action === 'attribution'\)\s*\{\s*return authority\.syncPage\(a\);/.test(syncBody)) v.push('e:attribution-binding-not-syncPage');
    const opsAt = t.indexOf('exposeFunction(G2_NODE_OPLEDGER_BINDING');
    const opsBody = opsAt === -1 ? '' : t.slice(opsAt, t.indexOf('exposeFunction(G2_NODE_SYNC_BINDING', opsAt));
    if (!/const ing = authority\.ingestFence\(a\);\s*if \(!ing\.ok\) return ing;/.test(opsBody)) v.push('e:ops-binding-no-ingest-fence-before-allocation');
    const fatAt = t.indexOf('exposeFunction(G2_NODE_FATAL_BINDING');
    const fatBody = fatAt === -1 ? '' : t.slice(fatAt, t.indexOf('exposeFunction(G2_NODE_INGEST_BINDING', fatAt));
    if (!(/authority\.ingestEarly\(m\.pending\)/.test(fatBody) && /authority\.notePageFatal\(m\.id\)/.test(fatBody))) v.push('e:fatal-binding-not-ingest-and-numbered');
    // Final transfer + drain reconcile too.
    if (!/authority\.reconcilePageFatals\(runOut\.value\.pageFatalSent\)/.test(t)) v.push('e:final-transfer-missing-reconcilePageFatals');
  }
  const run = need(a, 'g2RunPhases', v);
  if (run && !/if \(sync\) await sync\.drain\(\);/.test(run.text)) v.push('e:g2RunPhases-missing-awaited-drain');
  return v;
}

// ---------------------------------------------------------------------------------------------
// positive invariants
// ---------------------------------------------------------------------------------------------
function guardPositiveInvariants(src) {
  const a = analyze(src);
  const v = [];
  const rpr = need(a, 'runPostReservation', v);
  if (rpr) {
    const t = rpr.text;
    if (countOf(t, /\bcreateRunSeqAllocator\(\)/g) !== 1) v.push('p:runPostReservation-not-exactly-one-allocator');
    if (!/const runSeq = createRunSeqAllocator\(\);/.test(t)) v.push('p:runSeq-not-the-allocator');
    // Every sequence feed inside runPostReservation is runSeq.next; and each required consumer receives it.
    for (const m of t.matchAll(/\b(nextSeq|seqOf)\s*:\s*([^,}\s]+)/g)) if (m[2] !== 'runSeq.next') v.push(`p:${m[1]}-not-runSeq.next:${m[2]}`);
    if (!/createFatalEventSink\(state\.errorLedger, \{ nextSeq: runSeq\.next \}\)/.test(t)) v.push('p:sink-not-on-runSeq');
    if (!/createNetworkInstrumentation\(\{[^}]*nextSeq: runSeq\.next/.test(t)) v.push('p:network-not-on-runSeq');
    if (!/createOperationLedger\(\{[^}]*nextSeq: runSeq\.next/.test(t)) v.push('p:ops-not-on-runSeq');
    if (!/prepareC1Gate\(\{[\s\S]{0,300}?seqOf: runSeq\.next/.test(t)) v.push('p:prepareC1Gate-not-on-runSeq');
    if (!/createRunAuthority\(\{ allocator: runSeq,/.test(t)) v.push('p:authority-not-on-runSeq');
    const iFat = t.indexOf('authority.reconcilePageFatals(runOut.value.pageFatalSent);');
    const iRew = t.indexOf('authority.rewritePageRun(runOut.value, { stage: \'run\' })');
    const iApp = t.indexOf('applyPhaseRunToState(state, run);');
    const iAss = t.indexOf('authority.assertAllocated(maxRecordedSeq(state));', iApp);
    // applyPhaseRunToState -> cleanupEvidence.runApplied = true -> assertAllocated (nothing else in between).
    const between = iApp !== -1 && iAss !== -1 ? t.slice(iApp, iAss) : '';
    if (!/^applyPhaseRunToState\(state, run\);\s*cleanupEvidence\.runApplied = true;\s*$/.test(between)) v.push('p:final-transfer-apply-runApplied-assert-adjacent');
    if (!(iFat !== -1 && iRew !== -1 && iApp !== -1 && iAss !== -1 && iAss - iApp < 160 && iFat < iRew && iRew < iApp && iApp < iAss)) v.push('p:final-transfer-order-reconcile-rewrite-apply-assert');
    if (!/const run = authority\.rewritePageRun\(runOut\.value, \{ stage: 'run' \}\);/.test(t)) v.push('p:applied-run-is-not-the-rewritten-run');
  }
  if (!/^const LIVE_PATH_WIRED = false;/m.test(src)) v.push('p:LIVE_PATH_WIRED-not-false');
  if (!/const G2_DUAL_COUNTER_GATE = Object\.freeze\(\{ resolved: false,/.test(src)) v.push('p:G2_DUAL_COUNTER_GATE-resolved-not-false');
  return v;
}


// ---------------------------------------------------------------------------------------------
// (i) in-page cleanup drain
// ---------------------------------------------------------------------------------------------
function guardCleanupDrainInPage(src) {
  const a = analyze(src);
  const v = [];
  const reg = /const G2_IN_PAGE_FUNCTION_NAMES = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(src);
  if (!reg || !/'g2CleanupDrain'/.test(reg[1])) v.push('i:g2CleanupDrain-not-in-G2_IN_PAGE_FUNCTION_NAMES');
  const f = need(a, 'g2CleanupDrain', v);
  if (!f) return v;
  const t = f.text;
  if (!/^async function g2CleanupDrain\(/.test(t)) v.push('i:drain-not-async');
  if (countOf(t, /\bawait sync\.drain\(\)/g) !== 1) v.push('i:drain-not-exactly-one-awaited-sync.drain');
  if (unawaitedCalls(t, 'sync\\.drain').length > 0) v.push('i:unawaited-sync.drain');
  if (/\.then\(|\.catch\(|\bvoid\b/.test(t)) v.push('i:fire-and-forget-chaining');
  if (/\bthrow\b/.test(t)) v.push('i:drain-throws');
  const iDelta = t.indexOf('const delta = g2JsonSafe(');
  const iDrain = t.indexOf('await sync.drain()');
  if (iDelta === -1 || iDrain === -1 || iDelta > iDrain) v.push('i:delta-not-snapshotted-before-drain');
  else {
    // Same tick as the fence: nothing awaited between the delta construction and the awaited drain.
    if (/\bawait\b/.test(t.slice(iDelta, iDrain))) v.push('i:await-between-delta-and-drain');
    const deltaText = t.slice(iDelta, iDrain);
    for (const needle of ['env.recorder.records.filter((r) => r.seq > after)', 'env.recorder.events.filter((e) => e.seq > after)', "(env.state.stateSnapshots || []).filter((e) => e.seq > after)", 'pageHighWater: g2FenceReport().hw', 'pageFatalSent: g.pageFatalSent']) {
      if (!deltaText.includes(needle)) v.push(`i:delta-missing:${needle.slice(0, 28)}`);
    }
  }
  // Failure => {ok:false}: the awaited drain sits in a try whose catch returns ok:false; the early (no env / no binding) path too.
  if (!/try \{ await sync\.drain\(\); \} catch \(e\) \{ return \{ ok: false, delta: null, error: g2ErrOf\(e\) \}; \}/.test(t)) v.push('i:drain-failure-not-ok-false');
  if (!/if \(!env \|\| !sync\) return \{ ok: false, delta: null,/.test(t)) v.push('i:missing-env-not-ok-false');
  // Stable-fence loop: bounded (<= 8 rounds); the success return exists exactly once, only AFTER the awaited drain, and only
  // behind the page-high-water stability comparison; falling out of the loop fails closed as ok:false.
  if (!/for \(let round = 0; round < 8; round \+= 1\) \{/.test(t)) v.push('i:stable-fence-loop-bound-missing');
  const okRet = 'if (g2FenceReport().hw === delta.pageHighWater) return { ok: true, delta, error: null };';
  const iRet = t.indexOf('return { ok: true');
  if (iRet !== -1 && iDrain !== -1 && iRet < iDrain) v.push('i:return-before-fence');
  if (countOf(t, /return \{ ok: true/g) !== 1) v.push('i:success-return-shape');
  if (!t.includes(okRet)) v.push('i:stability-comparison-missing');
  else if (iDrain !== -1 && t.indexOf(okRet) < iDrain) v.push('i:stability-comparison-before-drain');
  if (!/return \{ ok: false, delta: null, error: \{ name: 'Error', message: 'cleanup drain did not stabilize' \} \};\s*\}$/.test(t)) v.push('i:unstable-not-ok-false');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (ii) Node-side cleanup drain wiring
// ---------------------------------------------------------------------------------------------
function guardCleanupDrainNodeWiring(src) {
  const a = analyze(src);
  const v = [];
  const rpr = need(a, 'runPostReservation', v);
  const bcs = need(a, 'buildCleanupSteps', v);
  if (bcs) {
    const t = bcs.text;
    const cp = t.indexOf('steps.closePage = {');
    const cc = t.indexOf('steps.closeContext');
    const seg = cp === -1 || cc === -1 ? '' : t.slice(cp, cc);
    if (!seg) v.push('ii:closePage-step-not-found');
    if (countOf(t, /\bbeforeClose\(/g) !== 1 || countOf(seg, /\bbeforeClose\(/g) !== 1) v.push('ii:beforeClose-not-invoked-only-in-closePage');
    const iB = seg.indexOf('await beforeClose()');
    const iT = seg.indexOf("teardown('closePage'");
    if (iB === -1 || iT === -1 || iB > iT) v.push('ii:drain-not-before-closePage-teardown');
    if (!/if \(typeof beforeClose === 'function'\) await beforeClose\(\);/.test(seg)) v.push('ii:beforeClose-not-awaited');
    if (/\bbeforeClose\b/.test(t.slice(0, cp)) && !/function buildCleanupSteps\(\{[^}]*beforeClose = null/.test(t)) v.push('ii:beforeClose-param-shape');
  }
  if (rpr) {
    const t = rpr.text;
    // The drain function is wired ONLY as beforeClose of the cleanup steps; never called directly.
    const idents = identsOf(rpr).filter((x) => x.value === 'drainCleanup');
    if (idents.length !== 2) v.push(`ii:drainCleanup-uses:${idents.length}`);
    if (countOf(t, /\bdrainCleanup\(/g) !== 0) v.push('ii:drainCleanup-called-directly');
    if (countOf(t, /const drainCleanup = async \(\) =>/g) !== 1) v.push('ii:drainCleanup-declaration');
    if (countOf(t, /buildCleanupSteps\(\{[^}]*beforeClose: drainCleanup \}\)/g) !== 1) v.push('ii:drainCleanup-not-passed-as-beforeClose');
    if (countOf(t, /\bbuildCleanupSteps\(/g) !== 1) v.push('ii:buildCleanupSteps-call-sites');
    if (countOf(t, /rpcCall\('g2CleanupDrain'/g) !== 1) v.push('ii:g2CleanupDrain-rpc-not-single');
    const dStart = t.indexOf('const drainCleanup = async () =>');
    const dEnd = t.indexOf('const cleanup = await runCleanup(');
    const body = dStart === -1 || dEnd === -1 ? '' : t.slice(dStart, dEnd);
    if (!body) v.push('ii:drainCleanup-body-not-found');
    const iRpc = body.indexOf("rpcCall('g2CleanupDrain'");
    const iRec = body.indexOf('authority.reconcilePageFatals(');
    const iRew = body.indexOf('authority.rewritePageRun(');
    const iMrg = body.indexOf('mergeCleanupDelta(');
    const iSet = body.indexOf('cleanupEvidence.merged = true;');
    if (!(iRpc !== -1 && iRec > iRpc && iRew > iRec && iMrg !== -1 && iMrg < iRew && iSet > iRew)) v.push('ii:drain-order-rpc-reconcile-rewrite-merge');
    if (!/const \{ duplicates \} = mergeCleanupDelta\(state, authority\.rewritePageRun\(out\.value\.delta, \{ stage: 'cleanup' \}\)\);/.test(body)) v.push('ii:merge-not-fed-by-rewritePageRun');
    // The merge result gates `merged = true`: a duplicate merge is a failure (never a silent dedup) and returns before merged is set.
    const iDup = body.indexOf('if (duplicates > 0)');
    if (iDup === -1 || !(iDup > iMrg && iDup < iSet)) v.push('ii:merge-duplicates-branch-missing-or-misplaced');
    else if (!/if \(duplicates > 0\) \{ cleanupEvidence\.failure = `merge-duplicate:\$\{duplicates\}`; return; \}/.test(body)) v.push('ii:merge-duplicates-branch-not-failing-closed');
    if (countOf(body, /cleanupEvidence\.merged = true;/g) !== 1) v.push('ii:merged-set-not-single');
    if (!/withDeadline\('cleanup-step', TABLE_T\.T8\.cleanupStepDeadlineMs, \(\) => rpcCall\('g2CleanupDrain', null\), true\)/.test(body)) v.push('ii:drain-not-under-T8-deadline');
    if (countOf(t, /\bmergeCleanupDelta\(/g) !== 1) v.push('ii:mergeCleanupDelta-call-sites');
    if (!/out\.status !== 'completed'[\s\S]*cleanupEvidence\.failure =/.test(body) || !/catch \(err\) \{ cleanupEvidence\.failure =/.test(body)) v.push('ii:drain-failure-not-recorded');
    // Pre-closeout block.
    const iClose = t.indexOf("name: 'closeout'");
    const iBlock = t.indexOf('if (cleanupEvidence.runApplied) {');
    if (iBlock === -1 || iClose === -1 || iBlock > iClose) v.push('ii:pre-closeout-block-missing-or-after-marker');
    else {
      const blk = t.slice(iBlock, iClose);
      if (countOf(t, /cleanup-evidence:/g) !== 2) v.push('ii:cleanup-evidence-fatal-count');
      if (!/if \(!cleanupEvidence\.merged\) sink\.recordFatal\('harness-exception', `cleanup-evidence:\$\{cleanupEvidence\.failure \|\| 'drain-not-run'\}`\);\s*else \{/.test(blk)) v.push('ii:unmerged-not-one-fatal');
      const iP = blk.indexOf('authority.pageEvidenceProblems(state)');
      const iE = blk.indexOf('else {');
      if (iP === -1 || iE === -1 || iP < iE) v.push('ii:pageEvidenceProblems-not-run-when-merged');
      if (!/problems\.length > 0\) sink\.recordFatal\('harness-exception', `cleanup-evidence:/.test(blk)) v.push('ii:problems-not-fatal');
      if (/\bawait\b/.test(blk)) v.push('ii:await-in-pre-closeout-block');
    }
    // Cleanup drain happens after the run result is applied, before the cleanup runner returns, and before the marker.
    const iCl = t.indexOf('const cleanup = await runCleanup(');
    if (iCl === -1 || iCl > iBlock) v.push('ii:cleanup-run-not-before-pre-closeout-block');
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// (iii) acknowledged mutations block on a refused/missing begin
// ---------------------------------------------------------------------------------------------
function balancedCall(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  return src.slice(openIdx);
}

function guardAcknowledgedMutationBlocking(src) {
  const a = analyze(src);
  const v = [];
  const f = need(a, 'runAcknowledgedMutation', v);
  if (f) {
    const t = f.text;
    if (!/requireOps = false \}\) \{/.test(t)) v.push('iii:requireOps-param-missing-or-default-changed');
    const throws = [
      ['failed', /if \(requireOps\) throw new Error\(`operation-begin failed/],
      ['refused', /else if \(requireOps\) throw new Error\(`operation-begin refused/],
      ['missing', /else if \(requireOps\) throw new Error\('operation-ledger binding missing/],
    ];
    const iSpy = Math.min(...['recorder.withOrigin(', 'recorder.record('].map((n) => t.indexOf(n)).filter((i) => i !== -1), Infinity);
    const iInvoke = t.indexOf('await invoke()');
    const iRecord = t.indexOf('recorder.record(');
    if (iSpy === Infinity || iInvoke === -1 || iRecord === -1) v.push('iii:spy-or-invoke-not-found');
    for (const [name, re] of throws) {
      const m = re.exec(t);
      if (!m) { v.push(`iii:throw-missing:${name}`); continue; }
      if (countOf(t, new RegExp(re.source, 'g')) !== 1) v.push(`iii:throw-not-single:${name}`);
      if (m.index > iSpy) v.push(`iii:throw-after-spy-record:${name}`);
      if (iInvoke !== -1 && m.index > iInvoke) v.push(`iii:throw-after-invoke:${name}`);
    }
    if (iSpy !== Infinity && iInvoke !== -1 && iSpy > iInvoke) v.push('iii:spy-record-after-invoke');
    if (countOf(t, /\binvoke\(\)/g) !== 1) v.push('iii:invoke-not-single');
    if (!/if \(r && r\.ok === true && typeof r\.operationId === 'string' && r\.operationId\.length > 0\) operationId = r\.operationId;/.test(t)) v.push('iii:begin-ok-and-operationId-check-changed');
  }
  // Every caller passes requireOps (live: C16 hide, C17 unload, the cleanup unload through guardedUnloadModel).
  const sites = callSites(a, 'runAcknowledgedMutation');
  if (sites.length !== 3) v.push(`iii:runAcknowledgedMutation-call-sites:${sites.length}`);
  for (const off of sites) {
    const open = src.indexOf('(', off);
    const args = balancedCall(src, open);
    const owner = a.outermostAt(off);
    if (!/\brequireOps\b/.test(args)) v.push(`iii:caller-without-requireOps:${owner ? owner.name : 'top'}:${args.slice(0, 40).replace(/\s+/g, ' ')}`);
  }
  for (const inv of ['C16', 'C17']) if (!new RegExp(`requireOps: env\\.requireOps === true, desc: \\{[^}]*invokedBy: '${inv}'`).test(src)) v.push(`iii:${inv}-caller-requireOps-shape`);
  const gu = need(a, 'guardedUnloadModel', v);
  if (gu && !/runAcknowledgedMutation\(\{ ops, requireOps, desc:/.test(gu.text)) v.push('iii:guardedUnloadModel-does-not-pass-requireOps');
  if (gu && !/if \(\(ops \|\| requireOps\) && \(modelId === 'A'/.test(gu.text)) v.push('iii:guardedUnloadModel-gate-ignores-requireOps');
  const mcs = need(a, 'createModelCleanupSteps', v);
  if (mcs && countOf(mcs.text, /guardedUnloadModel\(\{[^}]*, requireOps \}\)/g) !== 2) v.push('iii:createModelCleanupSteps-does-not-pass-requireOps-to-both-unloads');
  const csites = callSites(a, 'createModelCleanupSteps');
  if (csites.length < 1) v.push('iii:createModelCleanupSteps-no-callers');
  for (const off of csites) if (!/\brequireOps: true\b/.test(balancedCall(src, src.indexOf('(', off)))) v.push('iii:createModelCleanupSteps-caller-without-requireOps-true');
  const env = need(a, 'g2BuildEnv', v);
  if (env && !/\brequireOps: true,/.test(env.text)) v.push('iii:g2BuildEnv-requireOps-not-true');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (iv) OPLEDGER binding: one violation per refused begin
// ---------------------------------------------------------------------------------------------
function guardOpLedgerRefusal(src) {
  const a = analyze(src);
  const v = [];
  const rpr = need(a, 'runPostReservation', v);
  const auth = need(a, 'createRunAuthority', v);
  if (auth) {
    const m = /^\s*refuseOperation\(reason\) \{(.*)\},?$/m.exec(auth.text);
    if (!m) v.push('iv:refuseOperation-not-found');
    else {
      if (countOf(m[1], /\bviolate\(/g) !== 1) v.push('iv:refuseOperation-not-exactly-one-violation');
      if (!/violate\(`op-begin-refused:\$\{String\(reason\)\}`\)/.test(m[1])) v.push('iv:refuseOperation-reason-shape');
      if (!/return \{ ok: false, reason \}/.test(m[1])) v.push('iv:refuseOperation-return-shape');
    }
  }
  if (!rpr) return v;
  const t = rpr.text;
  const at = t.indexOf('exposeFunction(G2_NODE_OPLEDGER_BINDING');
  const end = t.indexOf('exposeFunction(G2_NODE_SYNC_BINDING', at);
  const body = at === -1 || end === -1 ? '' : t.slice(at, end);
  if (!body) { v.push('iv:opledger-binding-not-found'); return v; }
  if (/\bviolate\(|\bonViolation\(|authority\.violate/.test(body)) v.push('iv:binding-records-a-violation-itself');
  if (countOf(body, /authority\.refuseOperation\(/g) !== 2) v.push('iv:refuseOperation-call-count');
  // Ingest refusal: returned as-is (it already holds its own single violation), before any refuseOperation / allocation.
  const iIng = body.indexOf('const ing = authority.ingestFence(a);');
  const iIngRet = body.indexOf('if (!ing.ok) return ing;');
  const iFirstRef = body.indexOf('authority.refuseOperation(');
  const iPage = body.indexOf('ops.pageOperation(');
  if (!(iIng !== -1 && iIngRet > iIng && iIngRet < iFirstRef && iFirstRef < iPage)) v.push('iv:ingest-refusal-not-returned-before-refuseOperation');
  // Phase mismatch: refused and returned immediately (never falls through to the operation).
  if (!/if \(String\(action\) === 'begin' && authority\.isSynced\(\) && a\.phase !== authority\.phase\(\)\) return authority\.refuseOperation\('phase-mismatch'\);/.test(body)) v.push('iv:phase-mismatch-not-single-returned-refusal');
  // Ledger refusal of begin: exactly one refuseOperation, after pageOperation, only for begin; `end` untouched.
  if (!/const out = ops\.pageOperation\(String\(action\), opArg\);[\s\S]*return String\(action\) === 'begin' && out && out\.ok !== true \? authority\.refuseOperation\(out\.reason\) : out;/.test(body)) v.push('iv:ledger-begin-refusal-not-routed-through-refuseOperation');
  if (/String\(action\) === 'end'[^;]*refuseOperation/.test(body)) v.push('iv:end-refusal-records-violation');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (v) mergeCleanupDelta: exactly once per seq
// ---------------------------------------------------------------------------------------------
function guardMergeCleanupDelta(src) {
  const a = analyze(src);
  const v = [];
  const f = need(a, 'mergeCleanupDelta', v);
  if (!f) return v;
  const t = f.text;
  if (!/const fresh = \(list, have\) => arr\(list\)\.filter\(\(e\) => \{ const dup = !isPlainObject\(e\) \|\| have\.has\(e\.seq\); if \(dup\) duplicates \+= 1; return !dup; \}\);/.test(t)) v.push('v:dedup-by-seq-filter-missing');
  if (!/let duplicates = 0;/.test(t)) v.push('v:duplicates-counter-missing');
  if (!/return \{ duplicates \};\s*\}$/.test(t.trim())) v.push('v:duplicates-not-returned');
  for (const k of ['spyLedger', 'stateSnapshots']) if (!new RegExp(`state\\.${k} = \\[\\.\\.\\.arr\\(state\\.${k}\\), \\.\\.\\.fresh\\(d\\.${k}, seqs\\(state\\.${k}\\)\\)\\];`).test(t)) v.push(`v:${k}-not-deduped-by-seq`);
  if (!/const evHave = seqs\(state\.eventLog\);/.test(t) || !/\.\.\.fresh\(d\.eventLog, evHave\)/.test(t)) v.push('v:eventLog-not-deduped-by-seq');
  if (!/\.sort\(\(a, b\) =>/.test(t) || !/a\[1\] - b\[1\]/.test(t)) v.push('v:eventLog-not-stable-seq-ordered');
  return v;
}

// ---------------------------------------------------------------------------------------------
// (v) stage provenance: stage-tagged rewrites, drain-range provenance, cleanup eventLog evidence
// ---------------------------------------------------------------------------------------------
/** Body text (between the balanced braces) of the method/function whose header text is `header` inside `text`; null if absent. */
function bodyAfterHeader(text, header) {
  const i = text.indexOf(header);
  if (i === -1) return null;
  const open = i + header.length - 1; // header ends with its opening brace
  let depth = 0;
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === '{') depth += 1;
    else if (text[k] === '}' && (depth -= 1) === 0) return text.slice(open + 1, k);
  }
  return null;
}

function guardStageProvenance(src) {
  const a = analyze(src);
  const v = [];
  const rpr = need(a, 'runPostReservation', v);
  if (rpr) {
    const t = rpr.text;
    // Callers: exactly two rewritePageRun calls in runPostReservation, run first (outside the drain), cleanup inside the drain.
    if (countOf(t, /\bauthority\.rewritePageRun\(/g) !== 2) v.push('v:rewritePageRun-caller-count-not-2');
    if (countOf(t, /\brewritePageRun\(/g) !== 2) v.push('v:rewritePageRun-unqualified-or-extra-caller');
    const runCall = "authority.rewritePageRun(runOut.value, { stage: 'run' })";
    const cleanCall = "authority.rewritePageRun(out.value.delta, { stage: 'cleanup' })";
    if (countOf(t, /\bstage: '/g) !== 2) v.push('v:stage-literal-count-not-2');
    if (t.split(runCall).length !== 2) v.push('v:run-caller-wrong-stage');
    if (t.split(cleanCall).length !== 2) v.push('v:cleanup-caller-wrong-stage');
    const dStart = t.indexOf('const drainCleanup = async () =>');
    const dEnd = t.indexOf('const cleanup = await runCleanup(');
    const iRun = t.indexOf(runCall);
    const iClean = t.indexOf(cleanCall);
    if (dStart === -1 || dEnd === -1 || iRun === -1 || iClean === -1) v.push('v:caller-anchors-not-found');
    else {
      if (!(iRun < dStart)) v.push('v:run-stage-not-before-cleanup-drain');
      if (!(iClean > dStart && iClean < dEnd)) v.push('v:cleanup-stage-not-inside-drainCleanup');
      if (iRun > iClean) v.push('v:run-stage-after-cleanup-stage');
    }
  }
  const auth = need(a, 'createRunAuthority', v);
  if (auth) {
    const t = auth.text;
    const rew = bodyAfterHeader(t, 'rewritePageRun(run, { stage = null } = {}) {');
    const sto = bodyAfterHeader(t, 'stageOfOrdinal(ord) {');
    const prov = bodyAfterHeader(t, 'provenance() {');
    if (rew === null) v.push('v:rewritePageRun-signature-missing');
    if (sto === null) v.push('v:stageOfOrdinal-missing');
    if (prov === null) v.push('v:provenance-missing');
    if (rew !== null) {
      if (!/if \(stage === 'run'\) runBoundary = [^;]*run\.pageHighWater/.test(rew)) v.push('v:runBoundary-not-set-from-run-stage-high-water');
      if (!/if \(stage === 'cleanup'\) \{/.test(rew)) v.push('v:cleanup-stage-block-missing');
      if (!/drainCount \+= 1;\s*if \(drainCount > 1\) violate\('cleanup-drain-repeated'\);/.test(rew)) v.push('v:cleanup-drain-repeated-violation-missing');
      if (!/drainRange = runBoundary !== null[^;]*\{ lo: runBoundary, hi: run\.pageHighWater \}/.test(rew)) v.push('v:drainRange-not-(runBoundary,delta.pageHighWater]');
      if (/\ballocator\b/.test(rew)) v.push('v:rewritePageRun-touches-allocator');
    }
    // runBoundary / drainRange / drainCount are written ONLY by rewritePageRun, only from the stage argument.
    const writes = (name) => countOf(t, new RegExp(`(?<![.\\w])${name}\\s*(?:=(?!=)|\\+=)`, 'g'));
    if (writes('runBoundary') !== 2) v.push(`v:runBoundary-writers:${writes('runBoundary')}`); // declaration + the run-stage assignment
    if (writes('drainRange') !== 2) v.push(`v:drainRange-writers:${writes('drainRange')}`);
    if (writes('drainCount') !== 2) v.push(`v:drainCount-writers:${writes('drainCount')}`);
    // No second sequence: stage/provenance derivation never allocates, and the only allocator.next() is the ingest allocation.
    for (const [name, body] of [['stageOfOrdinal', sto], ['provenance', prov]]) {
      if (body !== null && /\b(allocator|runSeq|seq)\b[^;]*\.next\(|\.next\(|\bpeek\(|Date\.now|Math\.random|\+\+/.test(body)) v.push(`v:${name}-allocates-or-counts`);
    }
    if (countOf(t, /\ballocator\.next\(\)/g) !== 1) v.push('v:allocator.next-not-single-ingest-allocation');
    // Cleanup eventLog evidence, both directions.
    const pep = bodyAfterHeader(t, 'pageEvidenceProblems(state) {');
    if (pep === null) v.push('v:pageEvidenceProblems-missing');
    else {
      for (const l of ['missing', 'duplicate', 'unsourced', 'outside-drain', 'before-boundary', 'boundary-unproven', 'phase-mismatch', 'identity-mismatch', 'leaked-ordinal']) {
        if (!pep.includes(`cleanup-event-${l}:\${`)) v.push(`v:label-missing:cleanup-event-${l}`);
      }
      // source -> eventLog (forward) and eventLog -> source (reverse) loops.
      // Forward: a mandatory cleanup event is semantic (stage 'cleanup', OR stage 'run' with phase 'cleanup'), not stage-only.
      if (!/for \(const e of ingested\) \{\s*const stage = api\.stageOfOrdinal\(e\.ord\);\s*if \(e\.kind !== 'event' \|\| !\(stage === 'cleanup' \|\| \(stage === 'run' && e\.phase === 'cleanup'\)\)\) continue;/.test(pep)) v.push('v:forward-loop-source-to-eventLog-missing');
      // Boundary proof: exactly ONE authoritative 'cleanup' marker, itself an ingested run-stage phase-'cleanup' alloc ordinal.
      if (!/m\.name === 'cleanup'/.test(pep) || !/cleanupMarkers\.length === 1 \? bySeq\.get\(cleanupMarkers\[0\]\.seq\) : undefined/.test(pep)) v.push('v:boundary-single-marker-proof-missing');
      if (!/markerSrc\.kind === 'alloc' && markerSrc\.label === 'marker:cleanup' && markerSrc\.phase === 'cleanup' && api\.stageOfOrdinal\(markerSrc\.ord\) === 'run' \? cleanupMarkers\[0\]\.seq : null/.test(pep)) v.push('v:boundary-marker-source-qualification-missing');
      // Reverse branch chain: outside-drain only for a stage other than run/cleanup; run-carried needs a proven boundary and ev.seq after it.
      if (!pep.includes("else if (!fromCleanupDrain && srcStage !== 'run') out.push(`cleanup-event-outside-drain:${ev.seq}`);")) v.push('v:outside-drain-rule-not-restricted-to-non-run-stage');
      if (!pep.includes("else if (!fromCleanupDrain && boundarySeq === null) out.push(`cleanup-event-boundary-unproven:${ev.seq}`);")) v.push('v:boundary-unproven-branch-missing');
      if (!pep.includes("else if (!fromCleanupDrain && !(ev.seq > boundarySeq)) out.push(`cleanup-event-before-boundary:${ev.seq}`);")) v.push('v:before-boundary-branch-missing');
      if (!/for \(const ev of events\) \{/.test(pep) || !/const src = bySeq\.get\(ev\.seq\);/.test(pep) || !/if \(ev\.phase !== 'cleanup' && !fromCleanupDrain && !semanticCleanupSrc\) continue;/.test(pep)) v.push('v:reverse-loop-eventLog-to-source-missing');
      if (!pep.includes("const semanticCleanupSrc = src !== undefined && src.kind === 'event' && srcStage === 'run' && src.phase === 'cleanup';")) v.push('v:semanticCleanupSrc-definition-missing');
      if (!/const events = Array\.isArray\(s\.eventLog\)/.test(pep)) v.push('v:reverse-loop-not-over-state.eventLog');
    }
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// (vi) page-ordinal label provenance: the event kind is registered with the ordinal and validated at ingestion
// ---------------------------------------------------------------------------------------------
function guardLabelProvenance(src) {
  const a = analyze(src);
  const v = [];
  const pos = need(a, 'createPageOrdinalSource', v);
  if (pos) {
    if (!/next\(attribution = null, kind = 'alloc', label = null\) \{/.test(pos.text)) v.push('vi:ordinal-source-next-signature-lacks-label');
    if (!/label: typeof label === 'string' \? label : null \};\s*pending\.push\(entry\);/.test(pos.text)) v.push('vi:ordinal-source-entry-lacks-label');
  }
  const rec = need(a, 'createCallRecorder', v);
  if (rec) {
    const t = rec.text;
    if (!/\(kind, label\) => externalNextSeq\(attributionOf\(\), typeof kind === 'string' \? kind : 'alloc', typeof label === 'string' \? label : null\)/.test(t)) v.push('vi:recorder-nextSeq-does-not-pass-label');
    if (!/const stamp = \(kind, label\) => \(\{ seq: nextSeq\(kind, label\), \.\.\.attribution\(\) \}\);/.test(t)) v.push('vi:recorder-stamp-does-not-pass-label');
    if (!/\.\.\.stamp\('event', kind\), kind, \.\.\.fields/.test(t)) v.push('vi:logEvent-does-not-register-its-kind-as-label');
  }
  const auth = need(a, 'createRunAuthority', v);
  if (auth) {
    const t = auth.text;
    if (!/\(e\.kind === 'event' && !\(typeof e\.label === 'string' && e\.label\.length > 0\)\) \|\| !\(e\.label === undefined/.test(t)) v.push('vi:ingest-event-label-not-required');
    if (!/!\(e\.label === undefined \|\| e\.label === null \|\| typeof e\.label === 'string'\) \|\| attrProblem\(attrOf\(e\)\) !== null\) return fail\('ingest-entry-invalid'\);/.test(t)) v.push('vi:ingest-label-shape-not-validated');
    if (!/prev\.label !== \(e\.label === undefined \? null : e\.label\)/.test(t)) v.push('vi:ingest-resend-conflict-ignores-label');
    if (!/ingested\.push\(\{ seq, ord: e\.ord, realm: 'page', kind: e\.kind, label, /.test(t)) v.push('vi:ingested-rows-lack-label');
    if (!/else if \(ev\.kind !== src\.label\) out\.push\(`cleanup-event-identity-mismatch:\$\{ev\.seq\}`\);/.test(t)) v.push('vi:identity-mismatch-check-missing');
    if (/src\.label !== null\s*&&/.test(t)) v.push('vi:identity-check-null-label-exempt');
    if (!/markerSrc\.kind === 'alloc' && markerSrc\.label === 'marker:cleanup' && markerSrc\.phase === 'cleanup'/.test(t)) v.push('vi:boundary-proof-lacks-marker-label');
  }
  // The runner's mark(name) registers the marker ordinal under label `marker:<name>` (Node binds the cleanup boundary to it).
  const iMark = src.indexOf('const mark = async (name) => {');
  const markBody = iMark === -1 ? null : bodyAfterHeader(src.slice(iMark), 'const mark = async (name) => {');
  if (markBody === null) v.push('vi:runner-mark-missing');
  else {
    if (!markBody.includes("const m = { seq: rec.nextSeq('alloc', `marker:${name}`), name };")) v.push('vi:mark-marker-lacks-label');
    if (/\bseqOf\(\)/.test(markBody)) v.push('vi:mark-uses-plain-seqOf');
  }
  return v;
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

test('sequencing guards: harness source parses and the exported contract surface exists', () => {
  assert.equal(typeof H.createRunSeqAllocator, 'function');
  assert.equal(typeof H.createPageOrdinalSource, 'function');
  assert.equal(typeof H.createRunAuthority, 'function');
  assert.equal(H.PAGE_LOCAL_BASE, 2 ** 50);
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, false);
  for (const banned of ['createRunSeqCounter', 'createPageSeqSource', 'SEQ_STRIDE', 'SEQ_MINOR_RESERVED', 'realmOfSeq']) assert.equal(banned in H, false, `export ${banned} must not exist`);
});

test('(a) guard: no authoritative page-side sequence allocator', () => {
  expectClean(guardNoPageAllocator, 'a');
  expectDetects(guardNoPageAllocator, mutate(SOURCE, 'let last = PAGE_LOCAL_BASE;\n  const pending', 'let last = 0;\n  const pending'), 'page-ordinal-source-not-based-above-PAGE_LOCAL_BASE', 'ordinal source restarted at 0');
  expectDetects(guardNoPageAllocator, mutate(SOURCE, 'const recorder = createCallRecorder({ nextSeq: pageSeq.next });', 'const recorder = createCallRecorder({ nextSeq: () => (window.__seq = (window.__seq || 0) + 1) });'), 'page-recorder-nextSeq-not-ordinal-source', 'page recorder on its own counter');
  expectDetects(guardNoPageAllocator, mutate(SOURCE, 'const recorder = createCallRecorder({ nextSeq: pageSeq.next });', 'const recorder = createCallRecorder({});'), 'page-createCallRecorder-unfed', 'page recorder with the legacy internal counter');
  expectDetects(guardNoPageAllocator, mutate(SOURCE, 'const registry = createWrapperRegistry();', 'const runSeq = createRunSeqAllocator(); const registry = createWrapperRegistry();'), 'page-code-references-node-allocator', 'Node allocator constructed in-page');
  expectDetects(guardNoPageAllocator, mutate(SOURCE, 'const registry = createWrapperRegistry();', 'let pageSeq2 = 0; pageSeq2 += 1; const registry = createWrapperRegistry();'), 'page-side-seq', 'in-page seq counter');
});

test('(b) guard: exactly one run allocator, no composite-namespace constructs', () => {
  expectClean(guardSingleAllocator, 'b');
  for (const name of BANNED_IDENTS) {
    expectDetects(guardSingleAllocator, `${SOURCE}\nconst ${name} = 1;\n`, `banned-composite-name:${name}`, `reintroduced ${name}`);
  }
  expectDetects(guardSingleAllocator, `${SOURCE}\nfunction f(c) { c.observe(1); }\n`, 'banned-observe(', 'reintroduced observe(');
  expectDetects(guardSingleAllocator, `${SOURCE}\nconst g = (major) => major * 1e6;\n`, 'banned-major*', 'reintroduced major *');
  expectDetects(guardSingleAllocator, `${SOURCE}\nfunction createRunSeqCounter() { let n = 0; return { next: () => ++n }; }\n`, 'second-seq-factory', 'second counter factory');
  expectDetects(guardSingleAllocator, `${SOURCE}\nfunction createShadowAllocator() { return { next() { return 1; } }; }\n`, 'second-seq-factory:createShadowAllocator', 'second allocator factory');
  expectDetects(guardSingleAllocator, mutate(SOURCE, 'const runSeq = createRunSeqAllocator();', 'const runSeq = createRunSeqAllocator();\n  const runSeq2 = createRunSeqAllocator();'), 'createRunSeqAllocator-call-sites:2', 'second allocator instance');
  expectDetects(guardSingleAllocator, mutate(SOURCE, 'const runSeq = createRunSeqAllocator();', 'const runSeq = createRunSeqAllocator();\n  let localSeq = 0;'), 'runPostReservation-local-seq-counter', 'local counter in runPostReservation');
  expectDetects(guardSingleAllocator, mutate(SOURCE, 'function g2NodeSync() {', 'function g2NodeSync() {\n  const stray = createRunSeqAllocator();'), 'createRunSeqAllocator-called-outside-runPostReservation', 'allocator constructed outside runPostReservation');
});

test('(c) guard: no composite page-major / Node-minor ordering', () => {
  expectClean(guardNoCompositeOrdering, 'c');
  expectDetects(guardNoCompositeOrdering, mutate(SOURCE, '      last += 1;\n      return last;\n    },\n    peek: () => last,', '      last += 1;\n      return last * 1000;\n    },\n    peek: () => last,'), 'allocator-composes-value', 'allocator composes a value');
  expectDetects(guardNoCompositeOrdering, mutate(SOURCE, 'function createRunSeqAllocator() {', 'function createRunSeqAllocator(hw) {'), 'allocator-takes-parameters', 'allocator takes a page high-water');
  expectDetects(guardNoCompositeOrdering, mutate(SOURCE, 'const seq = allocator.next();', 'const seq = allocator.next(a.hw);'), 'allocator-next-with-argument', 'authority passes a high-water into next()');
  expectDetects(guardNoCompositeOrdering, mutate(SOURCE, 'const seq = allocator.next();', 'const seq = allocator.next() + (e.ord - PAGE_LOCAL_BASE) * 1000;'), 'composite-arithmetic-in:createRunAuthority', 'authority composes page ordinal with Node seq');
  expectDetects(guardNoCompositeOrdering, mutate(SOURCE, 'ingest-hw-mismatch', 'ingest-hw-removed'), 'authority-ingest-hw-check-missing', 'authority stops validating the page high-water');
});

test('(d) guard: Node-side verdict/closeout code never uses a page-local ordinal directly', () => {
  expectClean(guardNoDirectPageOrdinalVerdictUse, 'd');
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, 'async function closeoutProtocol(opts) {', 'async function closeoutProtocol(opts) {\n  if (isPageLocalOrdinal(opts)) return null;'), 'page-ordinal-use-in:closeoutProtocol', 'closeoutProtocol branches on a page ordinal');
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, 'function recomputeFatalCountAtGate(errorLedger, gateSeq) {', 'function recomputeFatalCountAtGate(errorLedger, gateSeq) {\n  void PAGE_LOCAL_BASE;'), 'page-ordinal-use-in:recomputeFatalCountAtGate', 'recompute references PAGE_LOCAL_BASE');
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, 'function deriveVerdictFromArtifacts({', 'function deriveVerdictFromArtifacts({ _x = remapPageOrdinals,'), 'verdict-function-references-page-ordinal', 'verdict derivation maps ordinals itself');
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, "if (isPageLocalOrdinal(x.seq)) problems.push(`page-ordinal-leaked:${x.seq}:${x.label}`);", ''), 'leak-check-lost', 'leak check removed');
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, "  authority.assertAllocated(maxRecordedSeq(state));\n  state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' });", "  state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' });"), 'closeout-missing-assertAllocated-before-marker', 'closeout stops asserting allocation');
});

test('(d) guard: g2CleanupDrain may use only PAGE_LOCAL_BASE of the ordinal machinery', () => {
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, 'const after = typeof g.runResultHw === \'number\' ? g.runResultHw : PAGE_LOCAL_BASE;', 'const after = typeof g.runResultHw === \'number\' ? g.runResultHw : (isPageLocalOrdinal(0) ? 1 : PAGE_LOCAL_BASE);'), 'page-ordinal-use-in:g2CleanupDrain:isPageLocalOrdinal', 'cleanup drain uses more of the ordinal machinery');
  expectDetects(guardNoDirectPageOrdinalVerdictUse, mutate(SOURCE, 'async function g2CleanupStep(', 'async function g2CleanupStep(opts) {\n  void PAGE_LOCAL_BASE;\n}\nasync function g2CleanupStepX('), 'page-ordinal-use-in:g2CleanupStep:PAGE_LOCAL_BASE', 'another page function uses PAGE_LOCAL_BASE');
});

test('(e) guard: verdict-bearing page->Node delivery is awaited; only the two reconciled hints are not', () => {
  expectClean(guardAwaitedDelivery, 'e');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'demand(await fn(action, { ...arg, ...f, pageFatalSent', 'demand(fn(action, { ...arg, ...f, pageFatalSent'), 'g2NodeSync-binding-call-not-exactly-one-await', 'sync fence no longer awaited');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'const r = await fn(action, { ...arg, ...f }); g2FenceAck(f, r);', 'const r = fn(action, { ...arg, ...f }); g2FenceAck(f, r);'), 'g2NodeOps-unawaited-binding-call', 'ops fence no longer awaited');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'const r = await fn(action, { ...arg, ...f }); g2FenceAck(f, r);', 'const r = await fn(action, { ...arg }); g2FenceAck(f, r);'), 'g2NodeOps-fence-does-not-carry-g2FenceReport', 'ops fence stops carrying pending+hw');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'await fn(action, { ...arg, ...f, pageFatalSent: g.pageFatalSent }), what); g2FenceAck(f, r);', 'await fn(action, { ...arg, pageFatalSent: g.pageFatalSent }), what); g2FenceAck(f, r);'), 'g2NodeSync-fence-does-not-carry-g2FenceReport', 'sync fence stops carrying pending+hw');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, "if (!r || r.ok !== true) throw new Error(`${what} refused by the node authority (${r && r.reason})`); return r; };", 'return r; };'), 'g2NodeSync-refusal-does-not-throw', 'sync refusal no longer throws');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'if (q && result && result.ok === true) q.ack(report.hw);', 'if (q) q.ack(report.hw);'), 'g2FenceAck-not-gated-on-ok', 'ack without an ok result');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'const r = demand(await fn(action, { ...arg, ...f, pageFatalSent: g.pageFatalSent }), what); g2FenceAck(f, r); return r; };', 'const r = demand(await fn(action, { ...arg, ...f, pageFatalSent: g.pageFatalSent }), what); return r; };'), 'g2NodeSync-fence-order-report-await-ack', 'fence never acks');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, "gate: async (c1) => (await call('gate', { c1 }, 'C1 gate')).gate,", "gate: async (c1) => { call('gate', { c1 }, 'C1 gate'); return null; },"), 'g2NodeSync', 'gate fence fire-and-forget');
  expectDetects(guardAwaitedDelivery, `${SOURCE}\nfunction g2Rogue() { window[G2_NODE_SYNC_BINDING]('x', {}); }\n`, 'verdict-binding-used-outside-owner:G2_NODE_SYNC_BINDING:g2Rogue', 'new un-awaited sync-binding use elsewhere');
  expectDetects(guardAwaitedDelivery, `${SOURCE}\nfunction g2Rogue2() { Promise.resolve(window[G2_NODE_OPLEDGER_BINDING]('begin', {})); }\n`, 'verdict-binding-used-outside-owner:G2_NODE_OPLEDGER_BINDING', 'new fire-and-forget ops delivery elsewhere');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'const meta = { id: g.pageFatalSent, ...g2FenceReport() };', 'const meta = { id: g.pageFatalSent };'), 'g2AgentReady-forward-lacks-g2FenceReport', 'fatal forward stops carrying pending+hw');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'Promise.resolve(ingestFn(entry)).catch(() => {});', 'Promise.resolve(ingestFn(entry)).catch(() => {}); Promise.resolve(ingestFn(entry));'), 'g2BuildEnv-ingest-hint', 'second un-awaited hint delivery');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, "            authority.reconcilePageFatals(a.pageFatalSent);\n            return { ok: true };", '            return { ok: true };'), 'drain-fence-missing-ingest-then-reconcilePageFatals', 'drain stops reconciling page fatals');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, "            authority.reconcilePageFatals(a.pageFatalSent);\n            const c1 = isPlainObject(a.c1)", '            const c1 = isPlainObject(a.c1)'), 'gate-fence-missing-ingest-then-reconcilePageFatals', 'gate stops reconciling page fatals');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, "        const ing = authority.ingestFence(a);\n        if (!ing.ok) return ing;\n        // Node validates the operation's phase", "        const ing = { ok: true };\n        // Node validates the operation's phase"), 'ops-binding-no-ingest-fence-before-allocation', 'ops binding allocates without ingesting the fence');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'if (sync) await sync.drain();', 'if (sync) sync.drain();'), 'g2RunPhases-missing-awaited-drain', 'drain no longer awaited');
  expectDetects(guardAwaitedDelivery, mutate(SOURCE, 'authority.reconcilePageFatals(runOut.value.pageFatalSent);', ''), 'final-transfer-missing-reconcilePageFatals', 'final transfer stops reconciling');
});

test('positive invariants: one allocator feeds every Node consumer; final transfer order; both live gates closed', () => {
  expectClean(guardPositiveInvariants, 'positive');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, 'errorLedger: state.errorLedger, seqOf: runSeq.next, clock,', 'errorLedger: state.errorLedger, seqOf: () => Date.now(), clock,'), 'seqOf-not-runSeq.next', 'C1 gate on a foreign seq source');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, 'const ops = createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next, clock });', 'const ops = createOperationLedger({ ledger: state.errorLedger, nextSeq: createRunSeqAllocator().next, clock });'), 'nextSeq-not-runSeq.next', 'ops ledger on a second allocator');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, 'const sink = createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });', 'const sink = createFatalEventSink(state.errorLedger, {});'), 'sink-not-on-runSeq', 'sink without the shared allocator');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, '      const run = authority.rewritePageRun(runOut.value, { stage: \'run\' });\n      applyPhaseRunToState(state, run);', '      applyPhaseRunToState(state, runOut.value);\n      const run = authority.rewritePageRun(runOut.value, { stage: \'run\' });'), 'final-transfer-order-reconcile-rewrite-apply-assert', 'final transfer applies before rewriting');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, '      applyPhaseRunToState(state, run);\n      cleanupEvidence.runApplied = true;\n      authority.assertAllocated(maxRecordedSeq(state));', '      applyPhaseRunToState(state, run);\n      cleanupEvidence.runApplied = true;'), 'final-transfer-order-reconcile-rewrite-apply-assert', 'final transfer drops assertAllocated');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, '      const run = authority.rewritePageRun(runOut.value, { stage: \'run\' });', '      const run = runOut.value; authority.rewritePageRun(runOut.value, { stage: \'run\' });'), 'applied-run-is-not-the-rewritten-run', 'raw page run is applied');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, 'const LIVE_PATH_WIRED = false;', 'const LIVE_PATH_WIRED = true;'), 'LIVE_PATH_WIRED-not-false', 'LIVE_PATH_WIRED flipped');
  expectDetects(guardPositiveInvariants, mutate(SOURCE, 'Object.freeze({ resolved: false, owner:', 'Object.freeze({ resolved: true, owner:'), 'G2_DUAL_COUNTER_GATE-resolved-not-false', 'dual-counter gate flipped');
});

test('guards are non-vacuous on missing structure: a renamed/removed target function fails closed', () => {
  assert.ok(guardNoPageAllocator(mutate(SOURCE, 'function createPageOrdinalSource(', 'function createPageOrdinalSourceRenamed(')).some((c) => c.startsWith('missing-function:')));
  assert.ok(guardAwaitedDelivery(mutate(SOURCE, 'function g2NodeSync() {', 'function g2NodeSyncRenamed() {')).some((c) => c === 'missing-function:g2NodeSync'));
  assert.ok(guardNoCompositeOrdering(mutate(SOURCE, 'function createRunSeqAllocator() {', 'function createRunSeqAllocatorX() {')).some((c) => c.startsWith('missing-function:')));
});

test('(i) guard: g2CleanupDrain is registered, awaits its drain fence after snapshotting the delta, and fails as ok:false', () => {
  expectClean(guardCleanupDrainInPage, 'i');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, "'g2RunPhases', 'g2CleanupStep', 'g2CleanupDrain',", "'g2RunPhases', 'g2CleanupStep',"), 'g2CleanupDrain-not-in-G2_IN_PAGE_FUNCTION_NAMES', 'drain removed from the in-page registry');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'try { await sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }', 'try { sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }'), 'unawaited-sync.drain', 'drain not awaited');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'try { await sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }', 'try { sync.drain().catch(() => {}); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }'), 'fire-and-forget-chaining', 'drain chained fire-and-forget');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'try { await sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }', 'try { void sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }'), 'fire-and-forget-chaining', 'drain voided');
  expectDetects(guardCleanupDrainInPage, mutate(mutate(SOURCE, '    try { await sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }\n', ''), '    const delta = g2JsonSafe({\n      spyLedger: env.recorder.records.filter', '    await sync.drain();\n    const delta = g2JsonSafe({\n      spyLedger: env.recorder.records.filter'), 'delta-not-snapshotted-before-drain', 'delta snapshotted after the drain');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'pageHighWater: g2FenceReport().hw, pageFatalSent: g.pageFatalSent,\n    });\n    try { await sync.drain(); }', 'pageHighWater: g2FenceReport().hw, pageFatalSent: g.pageFatalSent,\n    });\n    await Promise.resolve();\n    try { await sync.drain(); }'), 'await-between-delta-and-drain', 'a tick yields between delta and fence');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'try { await sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }', 'await sync.drain();'), 'drain-failure-not-ok-false', 'drain failure propagates as a throw');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }\n    if (g2FenceReport()', 'catch (e) { throw e; }\n    if (g2FenceReport()'), 'drain-throws', 'catch rethrows');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'spyLedger: env.recorder.records.filter((r) => r.seq > after),', 'spyLedger: env.recorder.records,'), 'delta-missing', 'delta no longer bounded by the run-result high-water');
  // stable-fence loop (a cleanup callback may allocate while the fence is in flight)
  const OK = 'if (g2FenceReport().hw === delta.pageHighWater) return { ok: true, delta, error: null };';
  const DR = 'try { await sync.drain(); } catch (e) { return { ok: false, delta: null, error: g2ErrOf(e) }; }';
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, OK, 'return { ok: true, delta, error: null };'), 'stability-comparison-missing', 'stability comparison removed (first fence result accepted)');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, OK, 'if (g2FenceReport().hw >= 0) return { ok: true, delta, error: null };'), 'stability-comparison-missing', 'stability comparison made vacuous');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'for (let round = 0; round < 8; round += 1) {', 'for (;;) {'), 'stable-fence-loop-bound-missing', 'loop bound removed (unbounded)');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, 'for (let round = 0; round < 8; round += 1) {', 'for (let round = 0; round < 1000000; round += 1) {'), 'stable-fence-loop-bound-missing', 'loop bound effectively unbounded');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, '    ' + DR, '    return { ok: true, delta, error: null };\n    ' + DR), 'return-before-fence', 'success returned before the fence');
  expectDetects(guardCleanupDrainInPage, mutate(SOURCE, "message: 'cleanup drain did not stabilize' } };", "message: 'cleanup drain did not stabilize' }, ok: true };"), 'unstable-not-ok-false', 'falling out of the loop no longer fails closed');
});

test('(ii) guard: cleanup drain runs only as beforeClose of the closePage step, is rewritten then merged, and gates the closeout marker', () => {
  expectClean(guardCleanupDrainNodeWiring, 'ii');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, 'buildCleanupSteps({ live, rpcCall, timers, ops, beforeClose: drainCleanup })', 'buildCleanupSteps({ live, rpcCall, timers, ops })'), 'drainCleanup-not-passed-as-beforeClose', 'drain no longer wired');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, 'const cleanup = await runCleanup({ steps: buildCleanupSteps(', 'await drainCleanup();\n  const cleanup = await runCleanup({ steps: buildCleanupSteps('), 'drainCleanup-called-directly', 'drain invoked directly outside the closePage step');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, "run: async () => { if (typeof beforeClose === 'function') await beforeClose(); return teardown('closePage'", "run: async () => { const r = teardown('closePage'"), 'drain-not-before-closePage-teardown', 'beforeClose dropped from closePage');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, "if (typeof beforeClose === 'function') await beforeClose(); return teardown('closePage', () => live.page, async () => { live.closingIntent = true; return closePlaywrightTarget(live.page, 'page', { timers }); })();", "const t = teardown('closePage', () => live.page, async () => { live.closingIntent = true; return closePlaywrightTarget(live.page, 'page', { timers }); })(); if (typeof beforeClose === 'function') await beforeClose(); return t;"), 'drain-not-before-closePage-teardown', 'drain after the page close teardown');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, "steps.closeContext = { run: teardown(", "steps.closeContext = { run: async () => { if (typeof beforeClose === 'function') await beforeClose(); return teardown("), 'beforeClose-not-invoked-only-in-closePage', 'drain also invoked from another step');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, 'const { duplicates } = mergeCleanupDelta(state, authority.rewritePageRun(out.value.delta, { stage: \'cleanup\' }));', 'const { duplicates } = mergeCleanupDelta(state, out.value.delta);'), 'merge-not-fed-by-rewritePageRun', 'delta merged without the ordinal rewrite');
  const DUP_BRANCH = "      if (duplicates > 0) { cleanupEvidence.failure = `merge-duplicate:${duplicates}`; return; }\n";
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, DUP_BRANCH, ''), 'merge-duplicates-branch-missing-or-misplaced', 'merge duplicates no longer gate merged = true (silent dedup)');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, DUP_BRANCH, "      if (duplicates > 0) { cleanupEvidence.failure = `merge-duplicate:${duplicates}`; }\n"), 'merge-duplicates-branch-not-failing-closed', 'duplicates recorded but merged = true still reached');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, DUP_BRANCH, "      if (duplicates > 0) { /* tolerated */ }\n"), 'merge-duplicates-branch-not-failing-closed', 'duplicates branch neutered');
  expectDetects(guardCleanupDrainNodeWiring, mutate(mutate(SOURCE, DUP_BRANCH, ''), '      cleanupEvidence.merged = true;\n', `      cleanupEvidence.merged = true;\n${DUP_BRANCH}`), 'merge-duplicates-branch-missing-or-misplaced', 'duplicates branch moved after merged = true');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, 'const { duplicates } = mergeCleanupDelta(', 'const duplicates = 0; mergeCleanupDelta('), 'merge-not-fed-by-rewritePageRun', 'merge result ignored (duplicates hard-coded 0)');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, 'authority.reconcilePageFatals(out.value.delta && out.value.delta.pageFatalSent);\n      // A cleanup record that is already in the state (same seq) is a duplicate merge: fail closed, never a silent dedup.\n      const { duplicates } = mergeCleanupDelta(state, authority.rewritePageRun(out.value.delta, { stage: \'cleanup\' }));', 'const { duplicates } = mergeCleanupDelta(state, authority.rewritePageRun(out.value.delta, { stage: \'cleanup\' }));\n      authority.reconcilePageFatals(out.value.delta && out.value.delta.pageFatalSent);'), 'drain-order-rpc-reconcile-rewrite-merge', 'fatal reconcile after the rewrite');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, "() => rpcCall('g2CleanupDrain', null), true)", "() => rpcCall('g2CleanupDrain', null))"), 'drain-not-under-T8-deadline', 'drain loses its deadline flag');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, "if (!cleanupEvidence.merged) sink.recordFatal('harness-exception', `cleanup-evidence:${cleanupEvidence.failure || 'drain-not-run'}`);\n    else {", "if (!cleanupEvidence.merged) { /* tolerated */ }\n    else {"), 'cleanup-evidence-fatal-count', 'unmerged cleanup evidence no longer fatal');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, "const problems = authority.pageEvidenceProblems(state);\n      if (problems.length > 0) sink.recordFatal('harness-exception', `cleanup-evidence:${problems[0]}${problems.length > 1 ? `(+${problems.length - 1})` : ''}`);", "const problems = [];\n      if (problems.length > 0) sink.recordFatal('harness-exception', `cleanup-evidence:${problems[0]}${problems.length > 1 ? `(+${problems.length - 1})` : ''}`);"), 'pageEvidenceProblems-not-run-when-merged', 'pageEvidenceProblems not consulted');
  expectDetects(guardCleanupDrainNodeWiring, mutate(SOURCE, 'if (cleanupEvidence.runApplied) {\n    if (!cleanupEvidence.merged)', 'if (false) {\n    if (!cleanupEvidence.merged)'), 'pre-closeout-block-missing-or-after-marker', 'pre-closeout evidence block removed');
});

test('(iii) guard: requireOps blocks the mutation before any recorder activity or invoke(); every live caller passes it', () => {
  expectClean(guardAcknowledgedMutationBlocking, 'iii');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "else if (requireOps) throw new Error(`operation-begin refused (${r && r.reason ? r.reason : 'malformed-response'}): mutation not started`);", ''), 'throw-missing:refused', 'refused begin no longer throws');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "      if (requireOps) throw new Error(`operation-begin failed (${e && e.message ? e.message : 'threw'}): mutation not started`);\n", ''), 'throw-missing:failed', 'thrown begin no longer throws');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "  } else if (requireOps) throw new Error('operation-ledger binding missing: mutation not started');", '  }'), 'throw-missing:missing', 'missing ledger binding no longer throws');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "  } else if (requireOps) throw new Error('operation-ledger binding missing: mutation not started');\n  const spyRec = recorder && method ? recorder.withOrigin('harness', () => recorder.record(method, args)) : null;", "  }\n  const spyRec = recorder && method ? recorder.withOrigin('harness', () => recorder.record(method, args)) : null;\n  if (requireOps && !ops) throw new Error('operation-ledger binding missing: mutation not started');"), 'throw-missing:missing', 'ledger-missing throw moved after the spy record');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "  let operationId = null;\n  if (ops && typeof ops.begin === 'function') {", "  let operationId = null;\n  if (recorder && method) recorder.record(method, args);\n  if (ops && typeof ops.begin === 'function') {"), 'throw-after-spy-record', 'a spy record is created before the begin is acknowledged');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "  let operationId = null;\n  if (ops && typeof ops.begin === 'function') {", "  let operationId = null;\n  void invoke();\n  if (ops && typeof ops.begin === 'function') {"), 'invoke-not-single', 'invoke() reachable before the begin');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "requireOps: env.requireOps === true, desc: { operationType: 'hide'", "desc: { operationType: 'hide'"), 'caller-without-requireOps', 'C16 hide caller drops requireOps');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "requireOps: env.requireOps === true, desc: { operationType: 'unload', modelId: 'B', phase: 'P9'", "desc: { operationType: 'unload', modelId: 'B', phase: 'P9'"), 'caller-without-requireOps', 'C17 unload caller drops requireOps');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "await runAcknowledgedMutation({ ops, requireOps, desc: { operationType: 'unload', modelId, phase: 'cleanup'", "await runAcknowledgedMutation({ ops, desc: { operationType: 'unload', modelId, phase: 'cleanup'"), 'caller-without-requireOps', 'cleanup unload caller drops requireOps');
  expectDetects(guardAcknowledgedMutationBlocking, `${SOURCE}\nasync function rogueMutation(ops) { await runAcknowledgedMutation({ ops, desc: {}, invoke: () => 1 }); }\n`, 'runAcknowledgedMutation-call-sites:4', 'a new caller without requireOps');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "modelId: 'A', requireOps }),", "modelId: 'A' }),"), 'createModelCleanupSteps-does-not-pass-requireOps-to-both-unloads', 'unloadModelA step drops requireOps');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "ops: env && env.ops ? env.ops : g2NodeOps(), requireOps: true });", "ops: env && env.ops ? env.ops : g2NodeOps() });"), 'createModelCleanupSteps-caller-without-requireOps-true', 'live cleanup-steps caller drops requireOps: true');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, 'requireOps: true, // the live page', 'requireOps: false, // the live page'), 'g2BuildEnv-requireOps-not-true', 'g2BuildEnv no longer sets requireOps: true');
  expectDetects(guardAcknowledgedMutationBlocking, mutate(SOURCE, "if ((ops || requireOps) && (modelId === 'A'", "if (ops && (modelId === 'A'"), 'guardedUnloadModel-gate-ignores-requireOps', 'cleanup unload with no ledger runs unrecorded');
});

test('(iv) guard: a refused OPLEDGER begin is exactly one violation via authority.refuseOperation; ingest refusals add none', () => {
  expectClean(guardOpLedgerRefusal, 'iv');
  expectDetects(guardOpLedgerRefusal, mutate(SOURCE, "        return String(action) === 'begin' && out && out.ok !== true ? authority.refuseOperation(out.reason) : out;", '        return out;'), 'refuseOperation-call-count', 'ledger-refused begin no longer recorded');
  expectDetects(guardOpLedgerRefusal, mutate(SOURCE, "        if (!ing.ok) return ing;\n        // Node validates", "        if (!ing.ok) return authority.refuseOperation(ing.reason);\n        // Node validates"), 'ingest-refusal-not-returned-before-refuseOperation', 'ingest refusal double-recorded');
  expectDetects(guardOpLedgerRefusal, mutate(SOURCE, "a.phase !== authority.phase()) return authority.refuseOperation('phase-mismatch');", "a.phase !== authority.phase()) authority.refuseOperation('phase-mismatch');"), 'phase-mismatch-not-single-returned-refusal', 'phase-mismatch refusal falls through into the operation (second violation)');
  expectDetects(guardOpLedgerRefusal, mutate(SOURCE, "        const out = ops.pageOperation(String(action), opArg);\n", "        const out = ops.pageOperation(String(action), opArg);\n        if (String(action) === 'begin' && out && out.ok !== true) onViolation(`op-begin-refused:${out.reason}`);\n"), 'binding-records-a-violation-itself', 'binding records its own violation');
  expectDetects(guardOpLedgerRefusal, mutate(SOURCE, "refuseOperation(reason) { violate(`op-begin-refused:${String(reason)}`); return { ok: false, reason }; },", "refuseOperation(reason) { violate(`op-begin-refused:${String(reason)}`); violate('op-begin-refused-again'); return { ok: false, reason }; },"), 'refuseOperation-not-exactly-one-violation', 'refuseOperation records two violations');
});

test('(v) guard: mergeCleanupDelta merges each seq exactly once (static + behavioural)', () => {
  expectClean(guardMergeCleanupDelta, 'v');
  expectDetects(guardMergeCleanupDelta, mutate(SOURCE, 'const dup = !isPlainObject(e) || have.has(e.seq);', 'const dup = !isPlainObject(e);'), 'dedup-by-seq-filter-missing', 'dedup removed');
  expectDetects(guardMergeCleanupDelta, mutate(SOURCE, '...fresh(d.stateSnapshots, seqs(state.stateSnapshots))', '...arr(d.stateSnapshots)'), 'stateSnapshots-not-deduped-by-seq', 'snapshots appended without dedup');
  expectDetects(guardMergeCleanupDelta, mutate(SOURCE, '...fresh(d.eventLog, evHave)', '...arr(d.eventLog)'), 'eventLog-not-deduped-by-seq', 'events appended without dedup');
  assert.equal(typeof H.mergeCleanupDelta, 'function');
  const state = { spyLedger: [{ seq: 1 }], stateSnapshots: [{ seq: 2 }], eventLog: [{ seq: 3 }, { seq: 6 }] };
  const delta = { spyLedger: [{ seq: 1 }, { seq: 4 }], stateSnapshots: [{ seq: 2 }, { seq: 5 }], eventLog: [{ seq: 7 }, { seq: 4.5 }, { seq: 3 }] };
  expectDetects(guardMergeCleanupDelta, mutate(SOURCE, 'if (dup) duplicates += 1; return !dup;', 'return !dup;'), 'dedup-by-seq-filter-missing', 'duplicates no longer counted');
  expectDetects(guardMergeCleanupDelta, mutate(SOURCE, '  return { duplicates };\n}', '  return {};\n}'), 'duplicates-not-returned', 'duplicates not returned');
  // the first merge already skips the 3 seqs the state holds (spy 1, snapshot 2, event 3); a second identical merge skips all 7
  assert.deepEqual(H.mergeCleanupDelta(state, delta), { duplicates: 3 });
  assert.deepEqual(H.mergeCleanupDelta(state, delta), { duplicates: 7 });
  assert.deepEqual(H.mergeCleanupDelta({}, null), { duplicates: 0 });
  assert.deepEqual(H.mergeCleanupDelta({ spyLedger: [] }, { spyLedger: [null, { seq: 9 }] }), { duplicates: 1 }, 'a non-object entry is counted as a duplicate (never silently kept)');
  assert.deepEqual(state.spyLedger.map((e) => e.seq), [1, 4]);
  assert.deepEqual(state.stateSnapshots.map((e) => e.seq), [2, 5]);
  assert.deepEqual(state.eventLog.map((e) => e.seq), [3, 4.5, 6, 7]);
});

test('(vi) guard: the event kind is registered as the ordinal label (source, recorder, logEvent) and the authority validates / conflict-checks / identity-matches it', () => {
  expectClean(guardLabelProvenance, 'vi');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "label: typeof label === 'string' ? label : null };\n      pending.push(entry);", 'label: null };\n      pending.push(entry);'), 'ordinal-source-entry-lacks-label', 'ordinal source drops the label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "next(attribution = null, kind = 'alloc', label = null) {", "next(attribution = null, kind = 'alloc') { const label = null;"), 'ordinal-source-next-signature-lacks-label', 'ordinal source next() has no label parameter');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "(kind, label) => externalNextSeq(attributionOf(), typeof kind === 'string' ? kind : 'alloc', typeof label === 'string' ? label : null)", "(kind, label) => externalNextSeq(attributionOf(), typeof kind === 'string' ? kind : 'alloc', null)"), 'recorder-nextSeq-does-not-pass-label', 'recorder.nextSeq drops the label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, 'const stamp = (kind, label) => ({ seq: nextSeq(kind, label), ...attribution() });', 'const stamp = (kind, label) => ({ seq: nextSeq(kind), ...attribution() });'), 'recorder-stamp-does-not-pass-label', 'stamp drops the label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "...stamp('event', kind), kind, ...fields", "...stamp('event'), kind, ...fields"), 'logEvent-does-not-register-its-kind-as-label', 'logEvent registers no label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "!(e.label === undefined || e.label === null || typeof e.label === 'string') || ", ''), 'ingest-label-shape-not-validated', 'ingest no longer validates the label shape');
  expectDetects(guardLabelProvenance, mutate(SOURCE, 'prev.label !== (e.label === undefined ? null : e.label) || ', ''), 'ingest-resend-conflict-ignores-label', 'resend conflict check ignores the label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "ingested.push({ seq, ord: e.ord, realm: 'page', kind: e.kind, label, ", "ingested.push({ seq, ord: e.ord, realm: 'page', kind: e.kind, "), 'ingested-rows-lack-label', 'ingested()/provenance() rows lose the label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, 'else if (ev.kind !== src.label) out.push(`cleanup-event-identity-mismatch:${ev.seq}`);', ''), 'identity-mismatch-check-missing', 'event identity check removed');
  expectDetects(guardLabelProvenance, mutate(SOURCE, 'else if (ev.kind !== src.label) out.push(`cleanup-event-identity-mismatch:${ev.seq}`);', 'else if (src.label !== null && ev.kind !== src.label) out.push(`cleanup-event-identity-mismatch:${ev.seq}`);'), 'identity-check-null-label-exempt', 'null-label identity exemption restored');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "(e.kind === 'event' && !(typeof e.label === 'string' && e.label.length > 0)) || ", ''), 'ingest-event-label-not-required', 'ingest no longer requires an event label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "(e.kind === 'event' && !(typeof e.label === 'string' && e.label.length > 0)) || ", "(e.kind === 'event' && typeof e.label !== 'string') || "), 'ingest-event-label-not-required', 'event label requirement weakened (empty string allowed)');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "markerSrc.kind === 'alloc' && markerSrc.label === 'marker:cleanup' && markerSrc.phase === 'cleanup'", "markerSrc.kind === 'alloc' && markerSrc.phase === 'cleanup'"), 'boundary-proof-lacks-marker-label', 'boundary proof no longer requires the marker label');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "const m = { seq: rec.nextSeq('alloc', `marker:${name}`), name };", "const m = { seq: rec.nextSeq('alloc'), name };"), 'mark-marker-lacks-label', 'mark() drops the marker label requirement');
  expectDetects(guardLabelProvenance, mutate(SOURCE, "const m = { seq: rec.nextSeq('alloc', `marker:${name}`), name };", 'const m = { seq: seqOf(), name };'), 'mark-uses-plain-seqOf', 'mark() allocates through plain seqOf()');
  // behavioural pin of the same wiring (real harness): the label registered at the source is exactly the event kind
  const src = H.createPageOrdinalSource();
  const rec = H.createCallRecorder({ nextSeq: src.next });
  const e = rec.logEvent('wrapper-restore', {});
  assert.equal(src.pending().find((x) => x.ord === e.seq).label, 'wrapper-restore');
  assert.equal(src.pending().find((x) => x.ord === e.seq).kind, 'event');
});

test('(v) guard: rewritePageRun callers pass the right stage; drain provenance comes only from the stage argument; cleanup eventLog evidence is checked both ways; a repeated drain is a violation', () => {
  expectClean(guardStageProvenance, 'v');
  // callers
  expectDetects(guardStageProvenance, mutate(SOURCE, "authority.rewritePageRun(runOut.value, { stage: 'run' })", "authority.rewritePageRun(runOut.value, { stage: 'cleanup' })"), 'run-caller-wrong-stage', 'run result rewritten as the cleanup stage');
  expectDetects(guardStageProvenance, mutate(SOURCE, "authority.rewritePageRun(runOut.value, { stage: 'run' })", 'authority.rewritePageRun(runOut.value)'), 'run-caller-wrong-stage', 'run caller drops its stage');
  expectDetects(guardStageProvenance, mutate(SOURCE, "authority.rewritePageRun(out.value.delta, { stage: 'cleanup' })", "authority.rewritePageRun(out.value.delta, { stage: 'run' })"), 'cleanup-caller-wrong-stage', 'drain delta rewritten as the run stage');
  expectDetects(guardStageProvenance, mutate(SOURCE, "authority.rewritePageRun(out.value.delta, { stage: 'cleanup' })", 'authority.rewritePageRun(out.value.delta)'), 'cleanup-caller-wrong-stage', 'cleanup caller drops its stage');
  expectDetects(guardStageProvenance, mutate(SOURCE, '      cleanupEvidence.runApplied = true;\n', "      cleanupEvidence.runApplied = true;\n      authority.rewritePageRun({ pageHighWater: authority.lastOrdinal() }, { stage: 'run' });\n"), 'rewritePageRun-caller-count-not-2', 'a third rewritePageRun caller in runPostReservation');
  expectDetects(guardStageProvenance, mutate(SOURCE, "const drainCleanup = async () =>", "authority.rewritePageRun(runOut.value, { stage: 'cleanup' }); const drainCleanup = async () =>"), 'rewritePageRun-caller-count-not-2', 'an extra caller ahead of the drain');
  // authority provenance derives only from the stage argument
  expectDetects(guardStageProvenance, mutate(SOURCE, "if (stage === 'run') runBoundary =", "if (stage !== 'cleanup') runBoundary ="), 'runBoundary-not-set-from-run-stage-high-water', 'run boundary set for any stage');
  expectDetects(guardStageProvenance, mutate(SOURCE, "if (drainCount > 1) violate('cleanup-drain-repeated');", ''), 'cleanup-drain-repeated-violation-missing', 'repeated drain no longer a violation');
  expectDetects(guardStageProvenance, mutate(SOURCE, '{ lo: runBoundary, hi: run.pageHighWater } : null;', '{ lo: 0, hi: run.pageHighWater } : null;'), 'drainRange-not-(runBoundary,delta.pageHighWater]', 'drain range no longer starts at the run boundary');
  expectDetects(guardStageProvenance, mutate(SOURCE, "if (ord <= runBoundary) return 'run';", "if (ord <= runBoundary) return 'run';\n      allocator.next();"), 'stageOfOrdinal-allocates-or-counts', 'stageOfOrdinal allocates a second sequence');
  expectDetects(guardStageProvenance, mutate(SOURCE, 'provenance() { return ingested.map((e) => ({ ...e, stage: api.stageOfOrdinal(e.ord) })); },', 'provenance() { return ingested.map((e) => ({ ...e, stage: allocator.next() })); },'), 'provenance-allocates-or-counts', 'provenance mints sequence numbers');
  expectDetects(guardStageProvenance, mutate(SOURCE, "const seq = allocator.next();\n      lastOrd = e.ord;", "const seq = allocator.next();\n      drainRange = null;\n      lastOrd = e.ord;"), 'drainRange-writers', 'drain range mutated outside rewritePageRun');
  expectDetects(guardStageProvenance, mutate(SOURCE, 'ordToSeq.set(e.ord, seq);', 'ordToSeq.set(e.ord, allocator.next());'), 'allocator.next-not-single-ingest-allocation', 'a second allocator.next() in the authority');
  // pageEvidenceProblems: labels + reverse loop
  for (const l of ['missing', 'duplicate', 'unsourced', 'outside-drain', 'before-boundary', 'boundary-unproven', 'phase-mismatch', 'identity-mismatch', 'leaked-ordinal']) {
    const needle = `cleanup-event-${l}:\${`;
    expectDetects(guardStageProvenance, SOURCE.split(needle).join(`cleanup-event-x${l}:\${`), `label-missing:cleanup-event-${l}`, `label cleanup-event-${l} removed`);
  }
  expectDetects(guardStageProvenance, mutate(SOURCE, 'for (const ev of events) {\n        if (!isPlainObject(ev)) continue;', 'for (const ev of []) {\n        if (!isPlainObject(ev)) continue;'), 'reverse-loop-eventLog-to-source-missing', 'reverse (eventLog -> source) loop disabled');
  expectDetects(guardStageProvenance, mutate(SOURCE, "if (ev.phase !== 'cleanup' && !fromCleanupDrain && !semanticCleanupSrc) continue;", "if (ev.phase !== 'cleanup' && !fromCleanupDrain) continue;"), 'reverse-loop-eventLog-to-source-missing', 'reverse filter drops the semanticCleanupSrc disjunct (rewritten run-carried cleanup source skipped)');
  expectDetects(guardStageProvenance, mutate(SOURCE, "if (e.kind !== 'event' || !(stage === 'cleanup' || (stage === 'run' && e.phase === 'cleanup'))) continue;", "if (e.kind !== 'event' || stage !== 'cleanup') continue;"), 'forward-loop-source-to-eventLog-missing', 'forward loop restricted to transport stage cleanup only');
  expectDetects(guardStageProvenance, mutate(SOURCE, "if (e.kind !== 'event' || !(stage === 'cleanup' || (stage === 'run' && e.phase === 'cleanup'))) continue;", "if (e.kind !== 'event' || !(stage === 'run' && e.phase === 'cleanup')) continue;"), 'forward-loop-source-to-eventLog-missing', 'forward loop loses the cleanup-stage disjunct');
  expectDetects(guardStageProvenance, mutate(SOURCE, "else if (!fromCleanupDrain && boundarySeq === null) out.push(`cleanup-event-boundary-unproven:${ev.seq}`);", ""), 'boundary-unproven-branch-missing', 'boundary-unproven branch removed');
  expectDetects(guardStageProvenance, mutate(SOURCE, "else if (!fromCleanupDrain && !(ev.seq > boundarySeq)) out.push(`cleanup-event-before-boundary:${ev.seq}`);", ""), 'before-boundary-branch-missing', 'before-boundary branch removed');
  expectDetects(guardStageProvenance, mutate(SOURCE, "else if (!fromCleanupDrain && srcStage !== 'run') out.push(`cleanup-event-outside-drain:${ev.seq}`);", "else if (!fromCleanupDrain) out.push(`cleanup-event-outside-drain:${ev.seq}`);"), 'outside-drain-rule-not-restricted-to-non-run-stage', 'old outside-drain-for-all rule restored');
  expectDetects(guardStageProvenance, mutate(SOURCE, "cleanupMarkers.length === 1 ? bySeq.get(cleanupMarkers[0].seq) : undefined", "cleanupMarkers.length >= 1 ? bySeq.get(cleanupMarkers[0].seq) : undefined"), 'boundary-single-marker-proof-missing', 'single-marker proof relaxed to >= 1');
  expectDetects(guardStageProvenance, mutate(SOURCE, "cleanupMarkers.length === 1 ? bySeq.get(cleanupMarkers[0].seq) : undefined", "bySeq.get(cleanupMarkers[0].seq)"), 'boundary-single-marker-proof-missing', 'single-marker proof dropped');
  expectDetects(guardStageProvenance, mutate(SOURCE, "markerSrc.kind === 'alloc' && markerSrc.label === 'marker:cleanup' && markerSrc.phase === 'cleanup' && api.stageOfOrdinal(markerSrc.ord) === 'run' ?", "markerSrc.kind === 'alloc' ?"), 'boundary-marker-source-qualification-missing', 'boundary marker no longer required to be a run-stage cleanup-phase ordinal');
  expectDetects(guardStageProvenance, mutate(SOURCE, "markerSrc.kind === 'alloc' && markerSrc.label === 'marker:cleanup' && markerSrc.phase === 'cleanup' && api.stageOfOrdinal(markerSrc.ord) === 'run' ?", "markerSrc.kind === 'alloc' && markerSrc.phase === 'cleanup' && api.stageOfOrdinal(markerSrc.ord) === 'run' ?"), 'boundary-marker-source-qualification-missing', 'boundary marker identity label dropped (any cleanup-phase alloc qualifies)');
  expectDetects(guardStageProvenance, mutate(SOURCE, "markerSrc.kind === 'alloc' && markerSrc.label === 'marker:cleanup' && markerSrc.phase === 'cleanup' && api.stageOfOrdinal(markerSrc.ord) === 'run' ?", "markerSrc.kind === 'alloc' && markerSrc.label !== null && markerSrc.phase === 'cleanup' && api.stageOfOrdinal(markerSrc.ord) === 'run' ?"), 'boundary-marker-source-qualification-missing', 'boundary marker label weakened to any non-null label');
});
