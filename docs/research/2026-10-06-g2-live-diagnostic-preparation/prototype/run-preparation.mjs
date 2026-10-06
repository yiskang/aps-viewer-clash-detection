// Offline preparation run (prompt §18–§21): regenerates the synthetic fixtures in memory, checks them byte-for-byte
// against the committed-to-package ../fixtures/, evaluates every scenario through the bound offline pipeline
// (validateTraceV2 -> controls -> projection -> committed C6 guard -> committed correlator -> verdict table), runs the
// gates, and writes results.json, golden.json, MANIFEST.json, a copy of the fixtures and SHA256SUMS into an EMPTY
// output directory via a staging directory and a single rename. [SYN] research tooling only: no Viewer, browser,
// network, live harness, authorization record or evidence is touched. Exit 0 = every gate passed; exit 2 = any gate
// failed (nothing is written); exit 1 = unexpected error.
//
//   node run-preparation.mjs --out <empty-dir>
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from './contract-loader.mjs';
import { generateFixtures, scenarioFromFiles, readFixturesDir, compareFixtures, FIXTURES_DIR, scriptValid, metaTemplate, bindingFor } from './fixtures-gen.mjs';
import { parseJsonl, traceArrayFromJsonl, canonicalStringify, canonicalBytes, sha256, Page, Recorder, RecorderRefused, validateTraceV2, REPO, CANONICAL_SHA256 } from './envelope.mjs';
import { evaluateScenario, auditResult, correlateTraceWindow, auditInputs } from './verdict.mjs';
import { runNegativeControlMatrix } from './controls.mjs';
import { wireKeyCollisions, allowedSharedKeys } from './trace-schema.mjs';
import { syntheticScC03Demo } from './closeout.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const rel = (p) => p.slice(REPO.length + 1).split(sep).join('/');
const shaText = (s) => sha256(Buffer.from(s, 'utf8'));
const json = (v) => canonicalStringify(v);

export const OWN_FILES = ['contract-loader.mjs', 'trace-schema.mjs', 'envelope.mjs', 'verdict.mjs', 'controls.mjs', 'fixtures-gen.mjs', 'closeout.mjs', 'run-preparation.mjs'];
export const PEER_MODULES = ['runbook-validator.mjs', 'capability-matrix.mjs', 'manifest-builder.mjs', 'auth-binding.mjs', 'dryrun-config.mjs'];
const COMMITTED = ['docs/research/2026-10-05-g2-diagnostic-instrumentation/correlate.mjs', 'docs/research/2026-10-05-g2-diagnostic-instrumentation/schema.mjs', 'docs/research/2026-10-05-g2-diagnostic-instrumentation/pins.mjs', 'docs/research/2026-10-05-g2-diagnostic-instrumentation/project.mjs'];
/** Fixtures whose full projection is retained in golden.json (Part 1 §8.3 golden-fixture list). */
const GOLDEN_PROJECTIONS = ['valid-complete', 'rq-interleaved', 'zero-sample-timeout', 'c8-superseded-p-settle', 't4-more-than-64-samples-then-settled', 'rq-threw-unrepresentable', 'plan-p6-two-g-settles', 'edge-init-already-high-at-listener-registration', 'valid-owner-restore', 'pre-motion-ambiguity', 'pending-clear-active-edge-gap'];

const fileDigest = (abs) => sha256(readFileSync(abs));

/** Evaluates every scenario of a fixture map. Returns { rows, golden, entries }. Pure given its inputs. */
export function evaluateAll(files, contract) {
  const index = JSON.parse(files['index.json']);
  const rows = []; const golden = []; const entries = [];
  for (const { id } of index.scenarios) {
    const sc = scenarioFromFiles(files, id, { parseJsonl });
    const { expected, ambiguous } = sc;
    const res = evaluateScenario(sc, { contract });
    const audit = auditResult(res, sc);
    const tRef = JSON.parse(files[`scenarios/${id}/scenario.json`]).traces.T;
    const digests = { targetRecordsSha256: null, targetTraceArraySha256: null, projectedSha256: null, projectedCount: null };
    let g = null;
    if (tRef) {
      const text = files[tRef];
      digests.targetRecordsSha256 = shaText(text);
      digests.targetTraceArraySha256 = shaText(traceArrayFromJsonl(text));
      const recs = parseJsonl(text).records;
      g = { id, recordBytes: recs ? recs.map((r) => canonicalBytes(r).length) : null };
      if (res.integrity.T && res.integrity.T.ok) {
        const c = correlateTraceWindow(recs.slice(1, -1), { meta: recs[0], effectivePcVb3: res.controls['PC-3'] === 'PASSED' && recs[recs.length - 1].pc['VB-3'] === 1 ? 1 : 0, contract });
        if (c.projected) { digests.projectedSha256 = sha256(canonicalBytes(c.projected)); digests.projectedCount = c.projected.length; if (GOLDEN_PROJECTIONS.includes(id)) g.projected = c.projected; }
        else g.unrepresentable = c.unrepresentable;
      }
      g.recordsSha256 = digests.targetRecordsSha256; g.projectedSha256 = digests.projectedSha256;
      golden.push(g);
    }
    rows.push({
      id, title: sc.title, ncRefs: sc.ncRefs, promptItems: sc.promptItems, ambiguous,
      expectedRunVerdict: expected.runVerdict, runVerdict: res.runVerdict, match: res.runVerdict === expected.runVerdict,
      runReasons: res.runReasons, stopCondition: res.stopCondition, attemptConsumed: res.attemptConsumed,
      targets: res.targets.map((t) => Object.fromEntries(['targetId', 'questionId', 'primary', 'oneSided', 'status', 'label', 'assumption', 'verdict', 'reason', 'allReasons', 'controlCoverage'].map((k) => [k, t[k] === undefined ? null : t[k]]))),
      controls: res.controls, integrity: res.integrity,
      pc4Offline: res.controlDetail && res.controlDetail['PC-4'] ? { scope: res.controlDetail['PC-4'].scope, nvReproduction: res.controlDetail['PC-4'].nvReproduction } : null,
      annotations: res.annotations ? { preMotionUnresolved: res.annotations.preMotionUnresolved, gapClasses: res.annotations.gapClasses, gapIntersectsSubjectWindow: res.annotations.gapIntersectsSubjectWindow } : null,
      c8: res.c8, audit, digests,
    });
    entries.push({ id, expected, observed: res, scenario: sc });
  }
  return { rows, golden, entries };
}

/** NC-13: every proper prefix of the valid target trace is INVALID (no partial trace is ever positive). */
export function prefixCheck(files, contract) {
  const sc = scenarioFromFiles(files, 'valid-complete', { parseJsonl });
  const full = sc.traces.T; const F = [];
  for (let n = 1; n < full.length; n += 1) {
    const v = validateTraceV2(full.slice(0, n), { contract, role: 'T', binding: sc.binding });
    const r = evaluateScenario({ ...sc, traces: { ...sc.traces, T: full.slice(0, n) } }, { contract });
    if (v.ok || r.runVerdict !== 'INVALID') F.push(`prefix ${n}: ${r.runVerdict}`);
  }
  return { prefixes: full.length - 1, findings: F };
}

/** Recorder lifecycle checks (Part 1 §8.6; NC-19, NC-20). */
export function lifecycleCheck(files, contract) {
  const F = [];
  const lateRef = JSON.parse(files['scenarios/late-callback-after-closed/scenario.json']).traces.T;
  const validRef = JSON.parse(files['scenarios/valid-complete/scenario.json']).traces.T;
  if (files[lateRef] !== files[validRef]) F.push('late callbacks changed trace bytes');
  const page = new Page(); const b = bindingFor(contract, 'a');
  const r1 = new Recorder(page, metaTemplate(contract, b, { role: 'T', run: 'syn-a' }), { contract });
  try { new Recorder(page, metaTemplate(contract, b, { role: 'T', run: 'syn-a' }), { contract }); F.push('second recorder not refused'); } catch (e) { if (!(e instanceof RecorderRefused)) F.push('second recorder: wrong error'); }
  if (r1.teardown() !== true || r1.teardown() !== false || r1.lr !== 1) F.push('teardown not idempotent');
  const s = scriptValid(contract, metaTemplate(contract, b, { role: 'T', run: 'syn-a' }));
  const before = canonicalStringify(s.rec.data); const counters = [s.rec.rj, s.rec.iv, s.rec.data.length];
  s.edge(1); s.add({ k: 'TC' });
  if (canonicalStringify(s.rec.data) !== before || s.rec.rj !== counters[0] || s.rec.iv !== counters[1]) F.push('callback in FINALIZING changed state');
  return { findings: F };
}

/** Peer-module gates (the agreed { ok, findings } contract). A missing module is a pending gate. */
export async function peerGates(contract, outFiles) {
  const out = {};
  const load = async (name) => { const p = join(HERE, name); if (!existsSync(p)) return null; return import(p); };
  const gate = (name, fn) => async () => {
    let mod;
    try { mod = await load(name); } catch (e) { return { ok: false, findings: [`IMPORT_FAILED: ${e.message}`] }; }
    if (!mod) return { ok: false, findings: ['GATE_PENDING: module not present'] };
    try { return await fn(mod); } catch (e) { return { ok: false, findings: [`GATE_EXCEPTION: ${e.message}`] }; }
  };
  out.runbook = await gate('runbook-validator.mjs', (m) => { const r = m.validateRunbook(contract); return { ok: r.ok, findings: r.findings, warnings: r.warnings || [] }; })();
  out.capabilityMatrix = await gate('capability-matrix.mjs', (m) => m.validateCapabilityMatrix(contract))();
  out.authBinding = await gate('auth-binding.mjs', (m) => {
    const e = m.syntheticExpected(contract);
    const existing = m.checkAuthBinding(m.syntheticExistingRecord(e, contract), e, contract);
    const pending = m.checkAuthBinding(m.syntheticProposedRecord(e), e, contract);
    const decided = { ...e, od1Decided: true };
    const proposed = m.checkAuthBinding(m.syntheticProposedRecord(decided), decided, contract);
    const F = [];
    if (existing.ok) F.push('existing acceptance format unexpectedly binds a diagnostic run');
    if (pending.ok) F.push('proposed record passes without an OD-1 owner decision');
    if (!proposed.ok) F.push(`proposed synthetic record (hypothetical OD-1 decided) fails: ${proposed.findings[0]}`);
    return { ok: F.length === 0, findings: F, existingFormatFindings: existing.findings.length, od1PendingFindings: pending.findings };
  })();
  out.dryRunConfig = await gate('dryrun-config.mjs', (m) => { const r = m.validateDryRunConfig(m.syntheticValidConfig(contract), contract); return { ok: r.ok, findings: r.findings }; })();
  out.manifest = await gate('manifest-builder.mjs', (m) => {
    const fx = Object.entries(outFiles).filter(([p]) => p.startsWith('fixtures/'));
    const inputs = fx.map(([, s]) => shaText(s));
    const entries = [
      ...fx.map(([p, s]) => ({ path: p, bytes: Buffer.from(s, 'utf8'), role: 'raw', fileClass: 'raw', phase: 'P0' })),
      ...['results.json', 'golden.json'].map((p) => ({ path: p, bytes: Buffer.from(outFiles[p], 'utf8'), role: 'derived', fileClass: 'derived', phase: 'P5', inputs })),
    ];
    const r = m.buildManifest(entries);
    if (r.ok) outFiles['MANIFEST.json'] = Buffer.from(m.serializeManifest(r.manifest)).toString('utf8');
    return { ok: r.ok, findings: r.findings };
  })();
  return out;
}

/** SC-C03 closeout demonstration (Part 2 §13.7, Appendix (viii)): a fixed synthetic A/B mismatch run through the in-memory finalization model, twice. */
export function scC03CloseoutGate(contract) {
  const F = [];
  let d1; let d2;
  try { d1 = syntheticScC03Demo(contract); d2 = syntheticScC03Demo(contract); } catch (e) { return { gate: { ok: false, findings: [`DEMO_EXCEPTION: ${e.message}`] }, files: {} }; }
  const sm = d1.summary;
  if (!d1.closeoutBytes) F.push('NO_CLOSEOUT_EMITTED');
  if (!d1.validation.ok || !d1.validation.recomputed) F.push(`CLOSEOUT_INVALID: ${d1.validation.findings.join(',') || 'not recomputed'}`);
  if (sm.abUnchanged !== true) F.push('AB_NOT_UNCHANGED');
  if (sm.promotionBlocked !== true) F.push('PROMOTION_NOT_BLOCKED');
  if (sm.manifestOkComplete !== true) F.push('MANIFEST_NOT_OK_COMPLETE');
  if (sm.commitRecord.terminalVerdict !== 'WITHHELD' || sm.commitRecord.terminalCarrierPath !== 'SC-C03-CLOSEOUT.json') F.push('COMMIT_RECORD_NOT_WITHHELD_CLOSEOUT');
  if (sm.ordinaryControl.closeoutEmitted !== false) F.push('CLOSEOUT_EMITTED_FOR_IDENTICAL_ANALYSES');
  if (json(sm) !== json(d2.summary) || !d1.closeoutBytes || !d2.closeoutBytes || !Buffer.from(d1.closeoutBytes).equals(d2.closeoutBytes)) F.push('NOT_DETERMINISTIC');
  return {
    gate: { ok: F.length === 0, findings: F },
    files: F.length === 0 || d1.closeoutBytes ? { 'sc-c03/SC-C03-CLOSEOUT.json': Buffer.from(d1.closeoutBytes || '').toString('utf8'), 'sc-c03/closeout-run.json': json(sm) } : {},
  };
}

/** Runs everything in memory. Returns { gates, ok, outFiles }. */
export async function runPreparation({ withPeers = true } = {}) {
  const contract = loadContract();
  const { files } = generateFixtures(contract);
  const gates = {};
  gates.fixturesMatchDisk = existsSync(FIXTURES_DIR) ? (() => { const f = compareFixtures(readFixturesDir(), files); return { ok: f.length === 0, findings: f.slice(0, 20) }; })() : { ok: false, findings: ['fixtures directory absent: run fixtures-gen.mjs --write'] };
  const ev = evaluateAll(files, contract);
  const ev2 = evaluateAll(files, contract);
  gates.inProcessDeterminism = { ok: json(ev.rows) === json(ev2.rows) && json(ev.golden) === json(ev2.golden), findings: [] };
  const nc = runNegativeControlMatrix(ev.entries);
  gates.expectedVerdicts = { ok: nc.ok, findings: nc.findings };
  const auditF = ev.rows.filter((r) => r.audit.length).map((r) => `${r.id}: ${r.audit.join(',')}`);
  gates.soundnessAudit = { ok: auditF.length === 0, findings: auditF };
  // Not circular (review L-9): besides the fixture's own `ambiguous` flag, every positive run is re-checked from its
  // output against the Part 2 §14.3 rule: every PRIMARY target DEFINITE, decided by a pre-registered label alone
  // (no shadowed reason), not withheld, and its inputs bound (plan digest, exact-true external gates, control linkage).
  const isPos = (v) => v === 'SUPPORTED' || v === 'REJECTED';
  const ambF = ev.rows.filter((r) => r.ambiguous && isPos(r.runVerdict)).map((r) => `${r.id}: flagged ambiguous`);
  for (const e of ev.entries) {
    if (!isPos(e.observed.runVerdict)) continue;
    const prim = e.observed.targets.filter((t) => t.primary);
    if (!prim.length || prim.some((t) => t.status !== 'DEFINITE' || t.allReasons.length !== 1 || !['PREREGISTERED_SUPPORT', 'PREREGISTERED_REJECT'].includes(t.reason))) ambF.push(`${e.id}: positive with a non-definite or shadowed primary target`);
    if (e.observed.verdictWithheld) ambF.push(`${e.id}: positive while withheld`);
    for (const x of auditInputs(e.scenario)) ambF.push(`${e.id}: ${x}`);
  }
  gates.noAmbiguousPositive = { ok: ambF.length === 0, findings: ambF };
  const pre = prefixCheck(files, contract);
  gates.partialTracesNeverPositive = { ok: pre.findings.length === 0, findings: pre.findings, prefixesChecked: pre.prefixes };
  gates.recorderLifecycle = { ok: true, ...lifecycleCheck(files, contract) }; gates.recorderLifecycle.ok = gates.recorderLifecycle.findings.length === 0;
  const coll = wireKeyCollisions(contract);
  const shared = allowedSharedKeys(contract); // Part 2 Appendix (i) wireKeyCollisionRule.allowedShared
  gates.wireKeyCollisions = { ok: json(coll) === json(shared), findings: [...coll.filter((k) => !shared.includes(k)).map((k) => `unexpected shared key ${k}`), ...shared.filter((k) => !coll.includes(k)).map((k) => `allowed shared key ${k} not shared`)], commonKeys: coll };
  const sc03 = scC03CloseoutGate(contract);
  gates.scC03Closeout = sc03.gate;
  const counts = {}; for (const r of ev.rows) counts[r.runVerdict] = (counts[r.runVerdict] || 0) + 1;
  const results = {
    schema: 'g2-live-diag-prep-results', schemaVersion: 1, synthetic: true, scope: 'OFFLINE_PREPARATION_ONLY',
    note: 'Synthetic fixtures evaluated by the offline preparation prototype. Not evidence of any live run; says nothing about R1. Historical G2 FAIL (row 3), C6 NOT_EVIDENCED, C8 unresolved and T4 are unchanged.',
    pc4Scope: 'PC-4 outcomes here are STRUCTURAL_ONLY (Part 2 §11.2 PC-4 scope): NV reproduction against the frozen C8 frustum oracle is a LIVE-only requirement of the bound Phase-5 evaluator; no offline artifact provides or ran the oracle.',
    contract: { part1: { id: contract.part1.contractId, version: contract.part1.contractVersion, sha256: contract.specDigests.part1 }, part2: { id: contract.envelope.contractId, version: contract.envelope.contractVersion, sha256: contract.specDigests.part2 } },
    pipeline: {
      prototype: Object.fromEntries(OWN_FILES.map((f) => [f, fileDigest(join(HERE, f))])),
      committedConsumedUnchanged: Object.fromEntries(COMMITTED.map((p) => [p, fileDigest(join(REPO, p))])),
      d2CanonicalSha256: CANONICAL_SHA256,
    },
    fixtures: { files: Object.keys(files).length, aggregateSha256: sha256(Buffer.from(json(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, shaText(v)]))), 'utf8')) },
    verdictCounts: counts, scenarios: ev.rows,
  };
  const outFiles = { 'results.json': json(results), 'golden.json': json({ synthetic: true, fixtures: ev.golden }) };
  for (const [p, s] of Object.entries(files)) outFiles[`fixtures/${p}`] = s;
  for (const [p, s] of Object.entries(sc03.files)) outFiles[p] = s;
  if (withPeers) {
    const peers = await peerGates(contract, outFiles);
    for (const [k, v] of Object.entries(peers)) gates[`peer:${k}`] = v;
  }
  const gatesFile = Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, { ok: v.ok, findings: v.findings }]));
  outFiles['gates.json'] = json(gatesFile);
  const sums = Object.keys(outFiles).sort().map((p) => `${shaText(outFiles[p])}  ${p}\n`).join('');
  outFiles.SHA256SUMS = sums;
  const ok = Object.values(gates).every((g) => g.ok);
  return { ok, gates, outFiles, results };
}

// ---------------------------------------------------------------- output writing (empty dir only; atomic)

const FORBIDDEN_REL = ['docs/research/evidence', 'test/acceptance/results', 'docs/research/2026-10-04-g2-d2-synthetic-transition', 'docs/research/2026-10-05-g2-diagnostic-instrumentation', rel(join(PKG, 'fixtures')), rel(join(PKG, 'prototype'))];
function realish(p) {
  let cur = resolve(p); const tail = [];
  while (!existsSync(cur)) { tail.unshift(basename(cur)); const up = dirname(cur); if (up === cur) break; cur = up; }
  return resolve(realpathSync(cur), ...tail);
}
const under = (p, root) => p === root || p.startsWith(root + sep);
/** Throws {code} unless `dir` is an allowed, absent-or-empty output directory. */
export function checkOutDir(dir) {
  const abs = resolve(dir); const real = realish(abs);
  for (const f of FORBIDDEN_REL) {
    const root = join(REPO, f);
    if (under(abs, root) || under(real, realish(root))) throw Object.assign(new Error(`refusing to write under ${f}`), { code: 'FORBIDDEN-OUTPUT-DIR' });
  }
  if (existsSync(abs) && readdirSync(abs).length > 0) throw Object.assign(new Error('refusing non-empty output directory'), { code: 'OUTPUT-DIR-NOT-EMPTY' });
  return abs;
}
export function writeOutputs(dir, outFiles) {
  const abs = checkOutDir(dir);
  const stage = join(dirname(abs), `.${basename(abs)}.staging`);
  if (existsSync(stage)) throw Object.assign(new Error('refusing: stale staging directory'), { code: 'OUTPUT-DIR-NOT-EMPTY' });
  mkdirSync(dirname(abs), { recursive: true });
  mkdirSync(stage);
  try {
    for (const [p, s] of Object.entries(outFiles)) { const t = join(stage, ...p.split('/')); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, s); }
    if (existsSync(abs)) rmdirSync(abs);
    renameSync(stage, abs);
  } catch (e) { rmSync(stage, { recursive: true, force: true }); throw e; }
}

async function main(argv) {
  const i = argv.indexOf('--out');
  if (i < 0 || !argv[i + 1]) { console.error('usage: run-preparation.mjs --out <empty-dir>'); return 2; }
  try {
    checkOutDir(argv[i + 1]);
    const { ok, gates, outFiles, results } = await runPreparation();
    for (const [k, g] of Object.entries(gates)) console.log(`${g.ok ? 'PASS' : 'FAIL'} ${k}${g.findings && g.findings.length ? `: ${g.findings.slice(0, 5).join(' | ')}` : ''}`);
    if (!ok) { console.error('GATE-FAILED: nothing written'); return 2; }
    writeOutputs(argv[i + 1], outFiles);
    console.log(`scenarios=${results.scenarios.length} verdicts=${JSON.stringify(results.verdictCounts)}`);
    console.log(`results.json sha256=${shaText(outFiles['results.json'])}`);
    console.log(`SHA256SUMS sha256=${shaText(outFiles.SHA256SUMS)}`);
    return 0;
  } catch (e) {
    console.error(`${e.code || 'ERROR'}: ${e.message}`);
    return e.code === 'FORBIDDEN-OUTPUT-DIR' || e.code === 'OUTPUT-DIR-NOT-EMPTY' ? 2 : 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => { process.exitCode = c; });
