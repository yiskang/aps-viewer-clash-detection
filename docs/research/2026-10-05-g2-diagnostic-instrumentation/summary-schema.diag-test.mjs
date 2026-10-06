// Summary schema v3 contract (spec section 7.4): schemaVersion, the bounded `ablation` carrier, its cardinalities and
// ordering, the 406 B NV bound, and the spec text itself. Reads the retained results/ only (fast, no pipeline run). [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, REPO } from './pins.mjs';
import { LIVE_CAPS, OFFLINE_CAPS } from './bounds.mjs';
import { decodeSatisfying } from './ablation.mjs';

const read = (f) => readFileSync(join(HERE, 'results', f), 'utf8');
const SPEC = readFileSync(join(REPO, 'docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md'), 'utf8');
const summary = JSON.parse(read('diag-summary.json'));
const witnesses = JSON.parse(read('diag-witnesses.json'));
const QS = ['Q-ATTR', 'Q-OWNER', 'Q-SUBJ'];
const W = ['OPEN', 'ASSUME'];

/** Research-local structural validator for the section 7.4 summary contract. Returns the list of violations. */
function validateSummary(s) {
  const bad = [];
  if (s.kind !== 'g2-diagnostic-sufficiency-summary') bad.push('kind');
  if (s.schemaVersion !== 3) bad.push(`schemaVersion ${s.schemaVersion} != 3`);
  const a = s.ablation;
  if (a === null || typeof a !== 'object') { bad.push('ablation missing'); return bad; }
  if (a.exhaustive !== true) bad.push('exhaustive');
  if (a.configMasks !== 1024 || a.configurationsEvaluated !== 2048 || a.elements.length !== 10 || a.windows.length !== 2) bad.push('ablation dimensions');
  if (!/^[0-9a-f]{256}$/.test(a.satisfyingBitmapHex)) bad.push('satisfyingBitmapHex');
  if (!Array.isArray(a.outcomes) || a.outcomes.length < 1 || a.outcomes.length > 2048) bad.push('outcomes cardinality');
  for (const w of W) {
    const ix = a.outcomeIndex?.[w];
    if (!Array.isArray(ix) || ix.length !== 1024 || !ix.every((i) => Number.isInteger(i) && i >= 0 && i < a.outcomes.length)) bad.push(`outcomeIndex.${w}`);
  }
  if (!Array.isArray(a.unsoundConfigurations) || a.unsoundConfigurations.length !== 0) bad.push('unsoundConfigurations');
  return bad;
}

test('retained summary is schemaVersion 3 and satisfies the section 7.4 ablation contract; witnesses stay at version 2', () => {
  assert.deepEqual(validateSummary(summary), []);
  assert.equal(witnesses.schemaVersion, 2);
});

test('stale schema-v2 summaries (no ablation carrier) and malformed carriers are rejected', () => {
  const v2 = { ...summary, schemaVersion: 2 }; delete v2.ablation;
  assert.ok(validateSummary(v2).length > 0);
  assert.ok(validateSummary({ ...summary, schemaVersion: 2 }).some((m) => /schemaVersion/.test(m)));
  const shortIdx = structuredClone(summary); shortIdx.ablation.outcomeIndex.OPEN.pop();
  assert.ok(validateSummary(shortIdx).includes('outcomeIndex.OPEN'));
  const badMap = structuredClone(summary); badMap.ablation.satisfyingBitmapHex = badMap.ablation.satisfyingBitmapHex.slice(1);
  assert.ok(validateSummary(badMap).includes('satisfyingBitmapHex'));
  const unsound = structuredClone(summary); unsound.ablation.unsoundConfigurations = [{}];
  assert.ok(validateSummary(unsound).includes('unsoundConfigurations'));
});

test('ablation carrier: bitmap, lattice and canonical set agree; outcomes are in deterministic first-appearance order', () => {
  const a = summary.ablation;
  const sat = decodeSatisfying(a.satisfyingBitmapHex);
  assert.equal(sat.length, a.lattice.satisfyingCount);
  assert.ok(sat.every((m, i) => i === 0 || sat[i - 1] < m), 'satisfying masks ascending');
  assert.ok(sat.includes(a.canonical.mask));
  assert.deepEqual(a.canonical.elements.map((e) => a.elements.indexOf(e)).reduce((m, i) => m | (1 << i), 0), a.canonical.mask);
  assert.equal(a.lattice.subsetsEvaluated, 1024);
  // first-appearance order, window-major then cm ascending: first occurrences of indices are 0,1,2,... in sequence
  let next = 0;
  for (const w of W) for (const i of a.outcomeIndex[w]) { assert.ok(i <= next); if (i === next) next += 1; }
  assert.equal(next, a.outcomes.length, 'every outcome is referenced and none is out of order');
  for (const o of a.outcomes) assert.deepEqual(Object.keys(o).sort(), QS);
});

test('ablation carrier stays bounded: fixed key sets, <= 40 firstWitness schedule ids, within the summary cap', () => {
  const a = summary.ablation;
  assert.equal(Object.keys(a.influence).length, 10);
  let fw = 0;
  for (const e of Object.keys(a.influence)) for (const w of W) {
    assert.equal(a.influence[e][w].configPairs, 512);
    for (const part of ['anyVerdict', 'definiteVerdict']) { const f = a.influence[e][w][part].firstWitness; if (f !== null) { fw += 1; assert.match(f.schedule, /^S-\d{5}$/); } }
  }
  assert.ok(fw <= 40);
  assert.equal(a.canonical.necessity.length, a.canonical.elements.length);
  assert.equal(a.oldBundle.singleRemoval.length, a.oldBundle.elements.length);
  const bytes = Buffer.byteLength(read('diag-summary.json'));
  assert.ok(bytes <= OFFLINE_CAPS.summaryBytes);
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < bytes);
  assert.equal(summary.caps.observed.summaryBytes, bytes);
});

test('NV bound is 406 B everywhere it is normative; the spec states schema v3 and the ablation carrier', () => {
  assert.equal(LIVE_CAPS.bytesPerNv, 406);
  assert.match(SPEC, /\*\*`schemaVersion: 3`\*\*|`schemaVersion: 3`/);
  assert.doesNotMatch(SPEC, /`diag-summary\.json`\*\*: `kind: "g2-diagnostic-sufficiency-summary"`, `schemaVersion: 2`/);
  assert.match(SPEC, /\*\*`ablation` carrier \(normative\)\.\*\*/);
  assert.doesNotMatch(SPEC, /no per-subset table are written/);
  assert.match(SPEC, /bytes per `NV` record \| \*\*406\*\*/);
  assert.doesNotMatch(SPEC, /with a 400 B cap \|/); // the Appendix A row now says it was corrected to 406 B
});
