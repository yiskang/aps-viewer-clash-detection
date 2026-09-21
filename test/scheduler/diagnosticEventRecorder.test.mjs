import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setDiagnosticEventRecorder, clearDiagnosticEventRecorder, reportDiagnosticEvent,
  isDiagnosticEventRecorderActive,
} from '../../collision/scheduler.js';

test('reportDiagnosticEvent is a true no-op when unset', () => {
  assert.equal(isDiagnosticEventRecorderActive(), false);
  assert.doesNotThrow(() => reportDiagnosticEvent('geometry-resolve', { stage: 'geometry-resolve', ms: 1 }));
});

test('setDiagnosticEventRecorder receives kind and payload verbatim', () => {
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    assert.equal(isDiagnosticEventRecorderActive(), true);
    reportDiagnosticEvent('narrow-phase-pair', { stage: 'volume-overlap', ms: 4.5, sourceEpoch: 1, sourceFragmentId: 10 });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'narrow-phase-pair');
    assert.deepEqual(events[0].payload, { stage: 'volume-overlap', ms: 4.5, sourceEpoch: 1, sourceFragmentId: 10 });
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('clearDiagnosticEventRecorder actually stops further recording', () => {
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  clearDiagnosticEventRecorder();
  assert.equal(isDiagnosticEventRecorderActive(), false);
  reportDiagnosticEvent('hard-clash-precheck', { stage: 'crossing', ms: 1 });
  assert.equal(events.length, 0);
});

test('every one of the four bounded kinds flows through untouched', () => {
  const events = [];
  setDiagnosticEventRecorder((kind) => events.push(kind));
  try {
    for (const kind of ['clearance-distance-query', 'hard-clash-precheck', 'narrow-phase-pair', 'geometry-resolve']) {
      reportDiagnosticEvent(kind, { stage: kind, ms: 0 });
    }
    assert.deepEqual(events, ['clearance-distance-query', 'hard-clash-precheck', 'narrow-phase-pair', 'geometry-resolve']);
  } finally {
    clearDiagnosticEventRecorder();
  }
});
