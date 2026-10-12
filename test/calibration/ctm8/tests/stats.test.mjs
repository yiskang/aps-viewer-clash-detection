// Tests for CTM8-P0-v4 statistics (§11).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestRank, summarizeLaunchCell, headlineMedianOfMedians, pooledSummary, pairedDelta,
} from '../lib/stats.mjs';

const ok = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ status: 'OK', durationMs: i + 1 + offset }));
const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('nearest-rank positions 29 / 86 / 43', () => {
  assert.equal(nearestRank(seq(30), 0.95), 29);
  assert.equal(nearestRank(seq(90), 0.95), 86);
  assert.equal(nearestRank(seq(45), 0.95), 43);
});

test('warm per-launch p95 with n=30; counts exclude non-OK', () => {
  const s = summarizeLaunchCell([...ok(30), { status: 'TIMEOUT', durationMs: 30001 }, { status: 'INVALID' }], { kind: 'warm' });
  assert.deepEqual(s, { n_valid: 30, n_timeout: 1, n_invalid: 1, min: 1, median: 15.5, max: 30, p95: 29 });
});

test('p95 n/a below 20 valid and always n/a for cold', () => {
  assert.equal(summarizeLaunchCell(ok(19), { kind: 'warm' }).p95, 'n/a');
  assert.equal(summarizeLaunchCell(ok(20), { kind: 'warm' }).p95, 19);
  assert.equal(summarizeLaunchCell(ok(15), { kind: 'cold' }).p95, 'n/a');
  assert.equal(summarizeLaunchCell(ok(40), { kind: 'cold' }).p95, 'n/a');
});

test('headline is median of the three per-launch medians', () => {
  const per = [10, 30, 20].map((m) => ({ median: m }));
  assert.equal(headlineMedianOfMedians(per), 20);
});

test('pooled summary is labelled and gates p95 at n_valid>=30', () => {
  const p = pooledSummary([...ok(15), ...ok(15), ...ok(15)]);
  assert.equal(p.label, 'POOLED');
  assert.equal(p.p95, 15); // rank 43 of 45 (three copies of 1..15)
  assert.equal(pooledSummary(ok(29)).p95, 'n/a');
  assert.equal(pooledSummary(ok(45)).p95, 43);
});

test('paired delta = per-launch median differences, headline = their median', () => {
  const g = [{ median: 15 }, { median: 20 }, { median: 40 }];
  const w = [{ median: 10 }, { median: 10 }, { median: 10 }];
  assert.deepEqual(pairedDelta(g, w), { perLaunch: [5, 10, 30], headline: 10 });
  assert.equal(pairedDelta([{ median: 'n/a' }], [{ median: 1 }]).headline, 'n/a');
});
