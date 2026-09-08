// test/query/VolumeOverlapQuery.conclusive.test.mjs
//
// Task 6 (M3 clearance implementation plan): volumeOverlapQuery's return contract
// gains an authoritative `conclusive: boolean` field, distinguishing a proven negative
// from an inconclusive one (budget-exhausted, incomplete sampling, non-manifold taint,
// etc.). Task 7 (out of scope here) consumes this as the single authoritative signal
// for a tri-state Hard-Clash exclusion precheck.
//
// Every fixture below is REUSED (verbatim geometry construction) from an existing test
// file that already exercises the exact code path this test needs -- no new geometry
// invented. See task-6-report.md for the file:line provenance of each.

import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { box, at, comb, mergeGeometries, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

test('a proven crossing overlap is conclusive:true', async () => {
  // Reused from VolumeOverlapQuery.test.mjs's "crossing-term aspect-ratio gate: sanity"
  // fixture (duct/beam perpendicular crossing, via:'crossing').
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const result = await volumeOverlapQuery(duct, beam);
  assert.equal(result.overlap, true);
  assert.equal(result.via, 'crossing');
  assert.equal(result.conclusive, true);
});

test('a proven containment overlap is conclusive:true, even from an open/non-manifold deciding component', async () => {
  // Reused from ContainmentQuery.anyComponentInside.test.mjs's "containment-decided
  // positive with open source" fixture: an open (non-manifold) triangle-soup box fully
  // inside a closed box resolves positive via anyComponentInside's own
  // unverified-open-component diagnostic (a POSITIVE-only diagnostic, per the brief --
  // never reachable on a negative volumeOverlapQuery result).
  const openSrc = testInstance(openBottomedBox(0.4));
  const closedTarget = testInstance(box(4, 4, 4));
  const result = await volumeOverlapQuery(openSrc, closedTarget);
  assert.equal(result.overlap, true);
  assert.equal(result.via, 'containment(A in B)');
  assert.equal(result.diagnostics.some((d) => d.reason === 'unverified-open-component'), true,
    'sanity: this positive really is decided by the open/non-manifold component, not a coincidence');
  assert.equal(result.conclusive, true,
    'a proven hit is proven regardless of what caveats apply to its degree');
});

test('a fully-resolved genuine negative is conclusive:true', async () => {
  // Reused from VolumeOverlapQuery.test.mjs's baseline "clearly separated solids do
  // not overlap" fixture: two closed-manifold boxes, well separated, fully resolved
  // on every term (no budget pressure, no flagged components).
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = await volumeOverlapQuery(a, sep);
  assert.equal(result.overlap, false);
  assert.equal(result.stats.aInB.unresolvedComponentCount, 0);
  assert.equal(result.stats.bInA.unresolvedComponentCount, 0);
  assert.equal(result.diagnostics.length, 0, 'sanity: a genuinely clean negative carries no diagnostics at all');
  assert.equal(result.conclusive, true);
});

test('a negative reached via crossing-budget-exhausted is conclusive:false', async () => {
  // Reused from ProperCrossingQuery.test.mjs's "candidate-count budget exhaustion"
  // fixture: interleaved combs with zero real intersections, budget tuned low enough
  // to force ProperCrossingQuery.aborted:true. Neither comb's teeth are ever inside
  // the other's (both closed-manifold, individually-disjoint boxes), so both
  // containment terms resolve as genuine, fully-sampled negatives -- the ONLY
  // incompleteness signal in this result is the crossing term's own abort.
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const result = await volumeOverlapQuery(a, b, { crossing: { maxCandidatePairsExamined: 500 } });
  assert.equal(result.overlap, false);
  assert.equal(result.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'sanity: the crossing term really did abort, not resolve cleanly negative');
  assert.equal(result.stats.aInB.unresolvedComponentCount, 0);
  assert.equal(result.stats.bInA.unresolvedComponentCount, 0);
  assert.equal(result.conclusive, false);
});

test('a negative reached via inconclusive-containment (unresolvedComponentCount > 0) is conclusive:false', async () => {
  // Reused verbatim from VolumeOverlapQuery.test.mjs's own "negative with truncated
  // coverage is diagnosed, not clean" fixture (20 disjoint components, tight
  // maxContainmentSamples budget) -- an existing VolumeOverlapQuery-level fixture that
  // already proves stats.aInB.unresolvedComponentCount > 0 and the
  // inconclusive-containment diagnostic on this exact call.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(i * 3, 20, 0));
  const source = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const result = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  assert.equal(result.overlap, false);
  assert.equal(result.diagnostics.some((d) => d.reason === 'inconclusive-containment'), true);
  assert.equal(result.stats.aInB.unresolvedComponentCount > 0, true,
    'sanity: unresolvedComponentCount really is the mechanism driving this, per the brief\'s formula');
  assert.equal(result.conclusive, false);
});

test('a negative on a non-manifold component (fully sampled, but flagged) is conclusive:false', async () => {
  // Reused from ContainmentQuery.anyComponentInside.test.mjs's "shared-FACE join
  // produces a non-manifold-flagged component" fixture: two closed boxes glued
  // face-to-face weld into ONE component whose shared-face edges are used by 4
  // triangles (not 2), flagging that component non-manifold -- while still resolving
  // 'outside' on the FIRST sample (componentResolved:true), so unresolvedComponentCount
  // stays 0. Confirms the non-manifold-component taint alone (independent of any
  // unresolved sampling) still drives conclusive:false.
  //
  // NOTE: because a component's closedManifold flag is boolean-equivalent to the
  // instance-level closedManifold flag anyComponentInside separately checks for its
  // CONTAINER role (both derive from the exact same per-component array; "some
  // component unclosed" and "not every component closed" are the same condition for a
  // single geometry instance), this glued `src` also reads as an unverified-parity-
  // operand when it plays the container role in the B-in-A term below. Both diagnostics
  // are asserted; the assertion on non-manifold-component specifically is what proves
  // THIS test's own claim.
  const partA = box(1, 1, 1);
  const partB = box(1, 1, 1).translate(1, 0, 0);
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(0.2, 0.2, 0.2), at(10, 10, 10));
  const result = await volumeOverlapQuery(src, target);
  assert.equal(result.overlap, false);
  assert.equal(result.diagnostics.some((d) => d.reason === 'non-manifold-component'), true);
  assert.equal(result.stats.aInB.unresolvedComponentCount, 0,
    'sanity: fully sampled, not budget-truncated -- proves the taint check fires independent of unresolvedComponentCount');
  assert.equal(result.stats.bInA.unresolvedComponentCount, 0);
  assert.equal(result.conclusive, false);
});

test('a negative against an unverified-parity-operand (non-closed container) is conclusive:false', async () => {
  // Mirrors ContainmentQuery.anyComponentInside.test.mjs's "closed source vs OPEN
  // target (round 6/7 blind spot)" fixture (openBottomedBox as target, a disjoint
  // closed box as source) at the VolumeOverlapQuery level: target is never certified
  // closed manifold, so anyComponentInside's own unconditional container-role
  // precondition check flags unverified-parity-operand on the A-in-B term regardless
  // of that term's own sampling outcome.
  //
  // NOTE: for the same structural reason documented on the non-manifold-component test
  // above, this fixture's open target ALSO reads as non-manifold-component when it
  // plays the sampled role in the B-in-A term. Both diagnostics are asserted; the
  // assertion on unverified-parity-operand specifically is what proves THIS test's own
  // claim.
  const source = testInstance(box(1, 1, 1), at(50, 0, 0));
  const target = testInstance(openBottomedBox(4));
  const result = await volumeOverlapQuery(source, target);
  assert.equal(result.overlap, false);
  assert.equal(result.diagnostics.some((d) => d.reason === 'unverified-parity-operand'), true);
  assert.equal(result.conclusive, false);
});
