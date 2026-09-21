import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../../collision/scheduler.js';
import { box, at, testInstance } from '../fixtures/geometry.mjs';

test('a conclusively-negative, non-crossing pair fires all three subterm events with correct identity/covariates', async () => {
  // Reused verbatim from test/query/VolumeOverlapQuery.conclusive.test.mjs's own "fully-resolved
  // genuine negative" fixture: two closed-manifold boxes, well separated -- every term runs to
  // completion, none short-circuits.
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(a, sep, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 11, targetEpoch: 2, targetFragmentId: 22 },
    });
    assert.equal(result.overlap, false);
    assert.equal(result.conclusive, true);
    const stages = events.filter((e) => e.kind === 'hard-clash-precheck').map((e) => e.payload.stage);
    assert.deepEqual(stages.sort(), ['containment-a-in-b', 'containment-b-in-a', 'crossing']);
    for (const e of events) {
      assert.equal(e.payload.sourceEpoch, 1);
      assert.equal(e.payload.sourceFragmentId, 11);
      assert.equal(e.payload.targetEpoch, 2);
      assert.equal(e.payload.targetFragmentId, 22);
      assert.ok(Number.isFinite(e.payload.ms));
      assert.equal(typeof e.payload.sourceTriangles, 'number');
      assert.equal(typeof e.payload.targetTriangles, 'number');
    }
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('a crossing-positive pair emits ONLY the crossing subterm event -- containment never runs, so neither containment event fires', async () => {
  // Reused from VolumeOverlapQuery.conclusive.test.mjs's own duct/beam crossing fixture.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(duct, beam, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
    assert.equal(result.via, 'crossing');
    const stages = events.filter((e) => e.kind === 'hard-clash-precheck').map((e) => e.payload.stage);
    assert.deepEqual(stages, ['crossing']);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('a containment-positive pair emits crossing (negative) then containment-a-in-b (positive) -- containment-b-in-a never runs', async () => {
  // Reused from VolumeOverlapQuery.conclusive.test.mjs's own open-box-in-closed-box fixture.
  const openSrc = testInstance((await import('../fixtures/geometry.mjs')).openBottomedBox(0.4));
  const closedTarget = testInstance(box(4, 4, 4));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(openSrc, closedTarget, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
    assert.equal(result.via, 'containment(A in B)');
    const stages = events.filter((e) => e.kind === 'hard-clash-precheck').map((e) => e.payload.stage);
    assert.deepEqual(stages, ['crossing', 'containment-a-in-b']);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('a crossing-positive pair carries orientation provenance on the crossing stage event (A2.4)', async () => {
  // duct's worldDiagonal is far larger than beam's (~20 vs ~2), so orientForCrossing's
  // rank-1 (worldDiagonal) comparison alone decides canonical order here -- duct (the
  // caller's `source`) canonicalizes first, unambiguously, with no need to fall through
  // to any lower-rank tiebreak.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 2));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(duct, beam, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
    assert.equal(result.via, 'crossing');
    const crossingEvent = events.find((e) => e.kind === 'hard-clash-precheck' && e.payload.stage === 'crossing');
    assert.ok(crossingEvent);
    assert.equal(crossingEvent.payload.orientedFirstRole, 'source');
    assert.equal(crossingEvent.payload.orientationRank, 1);
    assert.equal(typeof crossingEvent.payload.sourceWorldDiagonal, 'number');
    assert.equal(typeof crossingEvent.payload.targetWorldDiagonal, 'number');
    assert.ok(crossingEvent.payload.sourceWorldDiagonal > crossingEvent.payload.targetWorldDiagonal);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('no diagnosticPairContext supplied -- zero events, matching every existing caller', async () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    await volumeOverlapQuery(a, sep);
    assert.equal(events.length, 0);
  } finally {
    clearDiagnosticEventRecorder();
  }
});
