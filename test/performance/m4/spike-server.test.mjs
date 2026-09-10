// test/performance/m4/spike-server.test.mjs
//
// M4 Task 3.9 (codex-review fix, Important #2 -- "a port conflict bypasses the intended
// error-reporting path"): before this fix, `startSpikeServer` had no `error` listener at all, so an
// `EADDRINUSE` fired as an unhandled `error` event and crashed the whole process rather than
// rejecting the returned promise -- skipping every `try`/`catch` `runS1PrimeSpike`'s own caller
// relies on to preserve an already-written baseline report. No browser needed to prove this: two
// servers contending for the SAME real port is enough.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSpikeServer } from './spike-server.mjs';

test('startSpikeServer: an ephemeral port (0) never conflicts and resolves with the OS-assigned port', async () => {
  const a = await startSpikeServer({ port: 0 });
  const b = await startSpikeServer({ port: 0 });
  assert.notEqual(a.port, b.port);
  assert.ok(a.port > 0);
  assert.ok(b.port > 0);
  await a.close();
  await b.close();
});

test('startSpikeServer: a genuine port conflict REJECTS the returned promise rather than crashing the process', async () => {
  const first = await startSpikeServer({ port: 0 });
  try {
    await assert.rejects(
      () => startSpikeServer({ port: first.port }),
      (err) => err.code === 'EADDRINUSE',
    );
  } finally {
    await first.close();
  }
});

test('startSpikeServer: the startup error listener is torn down once startup settles successfully', async () => {
  // Regression guard for the `once('error', onError)` / `once('listening', onListening)` pairing:
  // `onError` must be removed once `onListening` fires, so it never lingers to mis-fire against an
  // unrelated LATER server-level error on the same server object (which would otherwise surface as
  // a confusing unhandled rejection on a promise that already settled). Checks only the `error`
  // listener this module itself owns -- NOT `listening`, which Node's own `http.Server` always
  // carries an unrelated internal listener for (`setupConnectionsTracking`), confirmed directly by
  // running this exact check before writing this assertion; asserting that count would be a false
  // failure unrelated to anything this module controls.
  const started = await startSpikeServer({ port: 0 });
  assert.equal(started.server.listenerCount('error'), 0);
  await started.close();
});
