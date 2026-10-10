// test/clashpanel/specReconciliation.test.mjs — independent Work review M2 (2026-10-10): the Panel spec's stale
// pre-§23 Soft statements and §19 item 8 are reconciled so no later task or test can select the stale branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SPEC = readFileSync(new URL('../../docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md', import.meta.url), 'utf8').split('\n');
const lineWith = (marker) => SPEC.find((l) => l.includes(marker));

const STALE_SOFT_MARKERS = [
  'Soft is offered only when the common-measurement-basis rule',
  'shown only while Soft is available (§6.2)',
  'a "why Soft is unavailable" line replaces the clearance field',
  'anything else → Soft unavailable',
  'Without it Soft is unavailable (fail closed)',
  'Soft mode for multi-model tests without a verified common measurement basis (fail closed until PR-BASIS/PG-5)',
  'Soft is unavailable for any multi-model test',
];

test('M2: every stale fail-closed Soft statement carries the §23 supersession pointer', () => {
  for (const marker of STALE_SOFT_MARKERS) {
    const line = lineWith(marker);
    assert.ok(line, `marker not found: ${marker}`);
    assert.match(line, /superseded by §23 \(2026-10-07\)/i, marker);
  }
});

test('M2: §19 item 8 routes per-row "not fully verified" through the caveated mask, never getPairStatus', () => {
  const line = lineWith('8. **`caveated` facet**');
  assert.ok(line);
  assert.match(line, /cached `caveated` filter mask/);
  // the correction note itself quotes the stale wording, so assert on the normative text before the note
  assert.doesNotMatch(line.split('*(Corrected')[0], /therefore uses `getPairStatus`/);
});

test('M2: CTM-11 is recorded as reconciled with §23/§23.7 and §7.5/AC-P4 authoritative', () => {
  const row = lineWith('| CTM-11 |');
  assert.ok(row);
  assert.match(row, /reconciled/);
  assert.match(row, /§23\/§23\.7/);
  assert.match(row, /§7\.5\/AC-P4/);
});

test('G-A2: §26.2 (d) records the owner-authorized fourth additive seam (e) INTENT.TEST_LABEL_SCOPE', () => {
  const line = lineWith('(d) Nothing else');
  assert.ok(line);
  assert.match(line, /seam \(e\), `INTENT\.TEST_LABEL_SCOPE`/);
  assert.match(line, /owner decision G-A2/);
});
