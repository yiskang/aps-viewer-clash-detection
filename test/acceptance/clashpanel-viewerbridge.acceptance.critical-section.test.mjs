// test/acceptance/clashpanel-viewerbridge.acceptance.critical-section.test.mjs
//
// Offline static guard for the G2 harness final critical section (procedure §9.1 step 8
// "Prohibited implementation patterns", §8 "AST assertion" / source-order test, §4.2).
//
// PARSER USED: no JavaScript parser (acorn / espree / typescript / @babel) exists in this repo's
// node_modules, and none may be added. The harness therefore carries its own conservative
// tokenizer (`tokenizeJs`) and a restricted-grammar recursive-descent parser
// (`parseRestrictedFunction`). The critical section is checked at AST level: its parsed AST must
// equal, node for node, the parsed AST of the whitelisted canonical source (anything outside the
// small grammar -- await, yield, arrow/function expressions, parentheses, templates, loops -- is a
// parse error, i.e. rejected). The pre-link path (computeOverall, preLinkGateFailure and every
// harness function they reach) is checked by a token-level deny scan over each tokenized function
// body (no general parser is available for that larger code).
//
// Negative controls: each prohibited pattern is injected into a copy of the harness source and
// must be reported by `auditCloseoutSource`; a few are also imported and executed from a temp
// copy to show the behavioural consequence. Never launches a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  auditCloseoutSource,
  tokenizeJs,
  findFunctionDeclarations,
  locateFunctionSource,
  parseRestrictedFunction,
  CRITICAL_SECTION_CANONICAL_SOURCE,
  commitCriticalSection,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const G1_FILE = fileURLToPath(new URL('./g1-svf2-f1-f8-verification.mjs', import.meta.url));

/** Replace the named function's source text via `edit(text) -> text`. */
function mutateFunction(src, name, edit) {
  const { start, end } = locateFunctionSource(src, name);
  const before = src.slice(start, end);
  const after = edit(before);
  assert.notEqual(after, before, `mutation of ${name} must change the source`);
  return src.slice(0, start) + after + src.slice(end);
}

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length - 1, 1, `exactly one occurrence of ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

function expectFinding(src, rule, reason, label) {
  const r = auditCloseoutSource(src);
  assert.equal(r.ok, false, `${label}: must be rejected`);
  assert.ok(r.findings.some((f) => f.rule === rule && f.reason === reason), `${label}: expected ${rule}/${reason}, got ${JSON.stringify(r.findings)}`);
}

const LINK_STMT = 'fs.linkSync(cs.Kc, cs.K);';
const GATE_STMT = "const preLink = computeOverall(cs.state, 'pre-link');";

// ------------------------------------------------------------------------------------------
// The real harness passes
// ------------------------------------------------------------------------------------------

test('the harness source passes every rule of the static guard', () => {
  assert.deepEqual(auditCloseoutSource(SOURCE), { ok: true, findings: [] });
});

test('commitCriticalSection: plain synchronous function; AST equals the canonical whitelist; exactly one direct fs.linkSync(Kc, K)', () => {
  const tokens = tokenizeJs(SOURCE);
  const [decl, ...rest] = findFunctionDeclarations(tokens, 'commitCriticalSection');
  assert.equal(rest.length, 0);
  assert.equal(decl.isAsync, false);
  assert.equal(decl.isGenerator, false);
  const ast = parseRestrictedFunction(decl.tokens);
  assert.deepEqual(ast, parseRestrictedFunction(tokenizeJs(CRITICAL_SECTION_CANONICAL_SOURCE)));
  assert.equal(commitCriticalSection.constructor.name, 'Function');
  const tryStmt = ast.body.find((s) => s.type === 'Try');
  const idx = tryStmt.block.findIndex((s) => s.type === 'ExprStmt' && s.expression.type === 'Call' && s.expression.callee.property === 'linkSync');
  assert.equal(idx, 3, 'gate (3 statements) then the link');
  assert.deepEqual(tryStmt.block[idx].expression, {
    type: 'Call',
    callee: { type: 'Member', object: { type: 'Identifier', name: 'fs' }, property: 'linkSync' },
    args: [{ type: 'Member', object: { type: 'Identifier', name: 'cs' }, property: 'Kc' }, { type: 'Member', object: { type: 'Identifier', name: 'cs' }, property: 'K' }],
  });
  // the statement after linkSync: committed = true; finalOverall = cs.primaryOverall -- and nothing else
  assert.deepEqual(tryStmt.block.slice(idx + 1).map((s) => [s.expression.left.name, s.expression.right.type]), [['committed', 'Literal'], ['finalOverall', 'Member']]);
  assert.equal(tryStmt.block.length, idx + 3);
});

test('tokenizer: tokenizes the whole G2 harness and the G1 harness; parser rejects constructs outside its grammar', () => {
  assert.ok(tokenizeJs(SOURCE).length > 10000);
  assert.ok(tokenizeJs(readFileSync(G1_FILE, 'utf8')).length > 10000);
  const t = tokenizeJs("const re = /a[/]b/g; const s = `x${ `y${1}` }z`; a / b; // c\n/* d */ 'e\\'f'");
  assert.deepEqual(t.filter((x) => x.type === 'regex').map((x) => x.value), ['/a[/]b/g']);
  assert.deepEqual(t.filter((x) => x.type === 'string').map((x) => x.value), ["e'f"]);
  for (const bad of [
    'function f(fs, cs) { await x; }',
    'function f(fs, cs) { (a); }',
    'function f(fs, cs) { const g = () => 1; }',
    'function f(fs, cs) { for (;;) {} }',
    'function f(fs, cs) { x = `t`; }',
    'function f(fs, cs) { try { a(); } catch (e) { b(); } finally { c(); } }',
    'function f(fs, cs) { a(); } extra',
  ]) assert.throws(() => parseRestrictedFunction(tokenizeJs(bad)), SyntaxError, bad);
});

// ------------------------------------------------------------------------------------------
// Negative controls (static): each prohibited pattern must be detected
// ------------------------------------------------------------------------------------------

const critical = (edit) => mutateFunction(SOURCE, 'commitCriticalSection', edit);

test('negative control: an await in the gate -> link block (and an async critical section) is detected', () => {
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, `await null;\n    ${LINK_STMT}`)), 'critical-section', 'await', 'await');
  const asyncSrc = SOURCE.replace('function commitCriticalSection(fs, cs) {', 'async function commitCriticalSection(fs, cs) {');
  expectFinding(asyncSrc, 'critical-section', 'async-function', 'async function');
  expectFinding(critical((t) => t.replace('function commitCriticalSection', 'function* commitCriticalSection').replace(LINK_STMT, `yield 1;\n    ${LINK_STMT}`)), 'critical-section', 'yield', 'generator/yield');
});

test('negative control: Promise construction, .then, timers, microtasks, AbortSignal between gate and link are detected', () => {
  const inject = (code) => critical((t) => replaceOnce(t, LINK_STMT, `${code}\n    ${LINK_STMT}`));
  expectFinding(inject('const p = new Promise(cs.executor);'), 'critical-section', 'promise', 'new Promise');
  expectFinding(inject('cs.pending.then(cs.onDone);'), 'critical-section', 'then', '.then');
  expectFinding(inject('setTimeout(cs.tick, 0);'), 'critical-section', 'timer', 'setTimeout');
  expectFinding(inject('setImmediate(cs.tick);'), 'critical-section', 'timer', 'setImmediate');
  expectFinding(inject('queueMicrotask(cs.tick);'), 'critical-section', 'timer', 'queueMicrotask');
  expectFinding(inject('process.nextTick(cs.tick);'), 'critical-section', 'timer', 'process.nextTick');
  expectFinding(inject('const s = AbortSignal.timeout(1000);'), 'critical-section', 'abort-signal', 'AbortSignal');
  expectFinding(inject('cs.state.bus.emit(cs.K);'), 'critical-section', 'callback-dispatch', 'event dispatch');
});

test('negative control: callback fs.link, fs.promises.link, Promise.race(link, timeout), timeout-wrapped commit are detected', () => {
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'fs.link(cs.Kc, cs.K, (err) => { cs.err = err; });')), 'critical-section', 'callback-fs', 'callback fs.link');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'fs.link(cs.Kc, cs.K, (err) => { cs.err = err; });')), 'critical-section', 'async-link', 'callback fs.link (async primitive)');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'fs.promises.link(cs.Kc, cs.K);')), 'critical-section', 'async-link', 'fs.promises.link');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'Promise.race([fs.promises.link(cs.Kc, cs.K), cs.timeout]);')), 'critical-section', 'promise-race', 'Promise.race');
  const wrapped = critical((t) => replaceOnce(t, LINK_STMT, 'withDeadline(() => fs.linkSync(cs.Kc, cs.K), 15000);'));
  expectFinding(wrapped, 'critical-section', 'nested-function', 'timeout-wrapped commit');
  expectFinding(wrapped, 'critical-section', 'parse-error', 'timeout-wrapped commit (outside the grammar)');
  // a wrapper that stays inside the grammar is still not the whitelisted AST
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'withDeadline(fs.linkSync, cs.Kc, cs.K);')), 'critical-section', 'whitelist-mismatch', 'deadline helper');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'const link = fs.linkSync;\n    link(cs.Kc, cs.K);')), 'critical-section', 'link-call-count:0', 'aliased link');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, `${LINK_STMT}\n    ${LINK_STMT}`)), 'critical-section', 'link-call-count:2', 'two links');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'cs.commitHelper(cs.Kc, cs.K);')), 'critical-section', 'whitelist-mismatch', 'link via helper');
});

test('negative control: timeout-wrapped / non-dedicated invocation of the critical section at its call site is detected', () => {
  const callLine = 'const outcome = commitCriticalSection(commitFs, cs);';
  expectFinding(mutateFunction(SOURCE, 'drainAndCommit', (t) => replaceOnce(t, callLine, 'const outcome = withDeadline(() => commitCriticalSection(commitFs, cs), 15000);')), 'call-site', 'critical-not-dedicated-macrotask', 'deadline-wrapped call');
  expectFinding(mutateFunction(SOURCE, 'drainAndCommit', (t) => t.replace('return new Promise((resolve) => {', 'const timer = setTimeout(() => {}, 15000);\n  return new Promise((resolve) => {')), 'call-site', 'wrapped-commit', 'timer inside drain');
  expectFinding(mutateFunction(SOURCE, 'drainAndCommit', (t) => t.replace('return new Promise((resolve) => {', 'return Promise.race([cs.timeout, new Promise((resolve) => {').replace(/\}\);\n\}$/, '})]);\n}')), 'call-site', 'wrapped-commit', 'Promise.race inside drain');
  // entered as an await continuation instead of a dedicated macrotask
  const asContinuation = mutateFunction(SOURCE, 'drainAndCommit', () => [
    'async function drainAndCommit({ scheduler, commitFs, cs, sink }) {',
    '  await new Promise((resolve) => { scheduler.setImmediate(resolve); });',
    '  await Promise.resolve();',
    '  const outcome = commitCriticalSection(commitFs, cs);',
    '  if (outcome.committed) sink.markCommitted();',
    '  return outcome;',
    '}',
  ].join('\n'));
  expectFinding(asContinuation, 'call-site', 'critical-not-dedicated-macrotask', 'await continuation');
  expectFinding(mutateFunction(SOURCE, 'closeoutProtocol', (t) => replaceOnce(t, 'const outcome = await drainAndCommit({', 'const outcome = await Promise.race([cs.timeout, drainAndCommit({')), 'call-site', 'wrapped-commit', 'Promise.race around drainAndCommit');
});

test('negative control: post-K verdict mutation (in the block, in post-commit, anywhere else) is detected', () => {
  expectFinding(critical((t) => replaceOnce(t, 'finalOverall = cs.primaryOverall;', "finalOverall = cs.primaryOverall;\n    finalOverall = computeOverall(cs.state, 'pre-link').overall;")), 'critical-section', 'post-commit-verdict-mutation', 'second assignment in the block');
  expectFinding(mutateFunction(SOURCE, 'runPostCommit', (t) => t.replace("obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';", "obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';\n  let finalOverall = 'FAIL';\n  finalOverall = 'FAIL';")), 'post-commit', 'post-commit-verdict-mutation', 'finalOverall in post-commit');
  expectFinding(mutateFunction(SOURCE, 'runPostCommit', (t) => t.replace("obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';", "obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';\n  obs.committed = false;")), 'post-commit', 'post-commit-verdict-mutation', 'committed in post-commit');
  expectFinding(mutateFunction(SOURCE, 'runPostCommit', (t) => t.replace("obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';", "obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';\n  obs.recheck = computeOverall(obs, 'pre-link');")), 'post-commit', 'post-commit-evaluation', 'evaluation after commit');
  expectFinding(mutateFunction(SOURCE, 'closeoutProtocol', (t) => replaceOnce(t, '    exitCode: exitCodeForVerdict(outcome.finalOverall),', '    exitCode: exitCodeForVerdict(outcome.finalOverall),\n    finalOverall2: (outcome.finalOverall = VERDICT_FAIL),')), 'post-commit', 'post-commit-verdict-mutation', 'outcome.finalOverall reassigned');
});

test('negative control: a pre-K read of closeoutComplete (block, gate helper, pre-link path) is detected', () => {
  expectFinding(critical((t) => replaceOnce(t, GATE_STMT, `${GATE_STMT}\n    if (cs.state.closeoutComplete) throw new Error(gateFailure);`)), 'critical-section', 'closeout-complete-read', 'in the block');
  expectFinding(mutateFunction(SOURCE, 'preLinkGateFailure', (t) => t.replace('  const ledger = cs.state.errorLedger;', "  if (cs.state.closeoutComplete !== true) return 'x';\n  const ledger = cs.state.errorLedger;")), 'pre-link-path', 'closeout-complete-read', 'in preLinkGateFailure');
  expectFinding(mutateFunction(SOURCE, 'evaluateOverallRows', (t) => t.replace('  const s = isPlainObject(state) ? state : {};', '  const s = isPlainObject(state) ? state : {};\n  const done = s.closeoutComplete;')), 'pre-link-path', 'closeout-complete-read', 'in evaluateOverallRows');
  // reached transitively: a helper called by computeOverall
  expectFinding(mutateFunction(SOURCE, 'preLinkCloseoutProblem', (t) => t.replace("  if (!isPlainObject(facts)) return 'closeout-facts-missing';", "  if (!isPlainObject(facts)) return 'closeout-facts-missing';\n  if (facts.closeoutComplete) return null;")), 'pre-link-path', 'closeout-complete-read', 'in a transitive helper');
  // other K-dependent reads on the pre-link path
  expectFinding(mutateFunction(SOURCE, 'evaluateOverallRows', (t) => t.replace('  const s = isPlainObject(state) ? state : {};', '  const s = isPlainObject(state) ? state : {};\n  const k = s.closeoutFacts && s.closeoutFacts.K;')), 'pre-link-path', 'k-dependent-read:K', 'reads K');
  expectFinding(mutateFunction(SOURCE, 'preCloseoutJournalProblem', (t) => t.replace("  if (states === null) return 'journal-missing';", "  if (states === null) return 'journal-missing';\n  if (states.includes('COMPLETED')) return null;\n  if (states.includes(JOURNAL_STATE.COMPLETED)) return null;")), 'pre-link-path', 'k-dependent-read:COMPLETED', 'journal COMPLETED');
});

test('negative control: a reintroduced operational third ("final") phase is detected', () => {
  const FINAL = ['fin', 'al'].join('');
  expectFinding(SOURCE.replace("const OVERALL_PHASES = Object.freeze(['pre-closeout', 'pre-link']);", `const OVERALL_PHASES = Object.freeze(['pre-closeout', 'pre-link', '${FINAL}']);`), 'phases', 'final-phase', 'third phase in OVERALL_PHASES');
  expectFinding(mutateFunction(SOURCE, 'computeOverall', (t) => t.replace('  const rows = evaluateOverallRows(state, phase);', `  if (phase === '${FINAL}') return null;\n  const rows = evaluateOverallRows(state, phase);`)), 'pre-link-path', 'final-phase', "phase === 'final' branch");
  expectFinding(mutateFunction(SOURCE, 'runPostCommit', (t) => t.replace("obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';", `obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';\n  obs.v = computeOverall(obs, '${FINAL}');`)), 'phases', 'phase-literal', "a computeOverall(..., 'final') call");
  // the gate may evaluate only 'pre-link', exactly once, inside the critical section
  expectFinding(critical((t) => t.replace("computeOverall(cs.state, 'pre-link')", "computeOverall(cs.state, 'pre-closeout')")), 'phases', 'pre-link-call-site', 'gate evaluating the wrong phase');
});

test('negative control: an extra statement, reordering, or a changed link target in the block is detected', () => {
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, `cs.state.touched = true;\n    ${LINK_STMT}`)), 'critical-section', 'whitelist-mismatch', 'extra statement');
  expectFinding(critical((t) => replaceOnce(t.replace(`    ${LINK_STMT}\n`, ''), GATE_STMT, `${LINK_STMT}\n    ${GATE_STMT}`)), 'critical-section', 'whitelist-mismatch', 'link before gate');
  expectFinding(critical((t) => replaceOnce(t, LINK_STMT, 'fs.linkSync(cs.K, cs.Kc);')), 'critical-section', 'whitelist-mismatch', 'swapped arguments');
  expectFinding(critical((t) => t.replace('  } catch (error) {\n    committed = false;', '  } catch (error) {\n    committed = true;')), 'critical-section', 'whitelist-mismatch', 'catch marks committed');
});

// ------------------------------------------------------------------------------------------
// Negative controls (dynamic): execute a mutated copy of the harness from a temp directory
// ------------------------------------------------------------------------------------------

async function importMutated(src) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'g2-mutant-'));
  const file = path.join(dir, 'harness-mutant.mjs');
  writeFileSync(file, src);
  try { return await import(`${pathToFileURL(file).href}?v=${Date.now()}${Math.random()}`); } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function x5Run(H) {
  const chain = H.resolveAttemptsChain('/repo');
  const fs = H.createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'] });
  const { handle, binding } = H.createOfflineAttemptFixture({ fs, chain });
  const state = H.createOfflineRunStateFixture({ binding });
  Object.defineProperty(state, 'closeoutComplete', { enumerable: false, get() { throw new Error('closeoutComplete read before K'); } });
  return H.closeoutProtocol({ state, handle, fs, chain, commitFs: { linkSync: H.brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true });
}

test('dynamic control: the unmodified harness runs X5 to PASS with a throwing closeoutComplete getter', async () => {
  const H = await import('./clashpanel-viewerbridge.acceptance.mjs');
  const r = await x5Run(H);
  assert.deepEqual([r.committed, r.finalOverall], [true, 'PASS']);
});

test('dynamic control: a pre-K closeoutComplete read in the pre-link path turns X5 into a refused commit (detected)', async () => {
  const src = mutateFunction(SOURCE, 'evaluateOverallRows', (x) => x.replace('  const s = isPlainObject(state) ? state : {};', '  const s = isPlainObject(state) ? state : {};\n  if (phase === OVERALL_PHASES[1]) void s.closeoutComplete;'));
  const H = await importMutated(src);
  const r = await x5Run(H);
  assert.deepEqual([r.committed, r.finalOverall, [...r.causes]], [false, 'FAIL', ['gate-threw:Error']]);
  assert.ok(H.auditCloseoutSource(src).findings.some((f) => f.reason === 'closeout-complete-read'));
});

test('dynamic control: a reintroduced third phase makes computeOverall accept it (behaviour the unmodified harness rejects)', async () => {
  const FINAL = ['fin', 'al'].join('');
  const src = SOURCE.replace("const OVERALL_PHASES = Object.freeze(['pre-closeout', 'pre-link']);", `const OVERALL_PHASES = Object.freeze(['pre-closeout', 'pre-link', '${FINAL}']);`);
  const H = await importMutated(src);
  const original = await import('./clashpanel-viewerbridge.acceptance.mjs');
  assert.throws(() => original.computeOverall({}, FINAL), /unknown phase/);
  assert.doesNotThrow(() => H.computeOverall({}, FINAL));
  assert.equal(H.auditCloseoutSource(src).ok, false);
});

test('dynamic control: a post-K verdict mutation makes harness and reader disagree; the static guard reports it', async () => {
  const src = mutateFunction(SOURCE, 'closeoutProtocol', (x) => replaceOnce(x, '    finalOverall: outcome.finalOverall,\n    closeoutComplete: outcome.committed,', '    finalOverall: VERDICT_FAIL,\n    closeoutComplete: outcome.committed,'));
  const H = await importMutated(src);
  const chain = H.resolveAttemptsChain('/repo');
  const fs = H.createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'] });
  const { handle, binding } = H.createOfflineAttemptFixture({ fs, chain });
  const state = H.createOfflineRunStateFixture({ binding });
  const r = await H.closeoutProtocol({ state, handle, fs, chain, commitFs: { linkSync: H.brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true });
  const v = H.deriveVerdictFromArtifacts({ ...H.readArtifactFileMap({ fs, chain }), authorizationId: handle.authorizationId });
  assert.notEqual(r.finalOverall, v.verdict, 'the mutant breaks harness/reader agreement');
  assert.ok(H.auditCloseoutSource(src).findings.some((f) => f.rule === 'post-commit' && f.reason === 'post-commit-verdict-mutation'));
  // the exit code is pinned the same way
  const src2 = mutateFunction(SOURCE, 'closeoutProtocol', (x) => replaceOnce(x, '    exitCode: exitCodeForVerdict(outcome.finalOverall),', '    exitCode: 1,'));
  assert.ok(auditCloseoutSource(src2).findings.some((f) => f.rule === 'post-commit' && f.reason === 'post-commit-verdict-mutation'));
});
