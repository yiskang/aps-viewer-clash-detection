// test/performance/m4/spike-server.mjs
//
// M4 Task 3.9: the harness's own express instance (§16.3 -- "the M4 harness may start its own
// express instance ... mounting the same wwwroot/ and /collision paths the production server
// mounts plus spike/m4/"). Mounts the SAME paths server.js mounts (server.js:6-8), plus spike/m4/,
// on an INDEPENDENT port -- never a route added to server.js itself. This is how S1' (and any
// later spike needing a same-origin served worker module) gets served without touching production
// routing. Deleted at M4 close along with the rest of the spike code unless a verdict adopts it.

import express from 'express';

// codex-review fix (Important #2 -- "a port conflict bypasses the intended error-reporting path"):
// the brief's own excerpt only ever handled the success path (`server.listen(port, callback)`),
// with no `error` listener at all. If another process already owns `port`, Node's `EADDRINUSE`
// fires as an `error` EVENT on the server, never as a rejection or a thrown exception -- with no
// listener for it, that event is unhandled and crashes the whole process (Node's default behavior
// for an unhandled `error` event), skipping every `try`/`catch` this file's own caller relies on to
// preserve the baseline matrix's already-written report. Both the `error` and `listening` listeners
// are removed once startup settles either way, so neither lingers to mis-fire against an unrelated
// LATER event on the same server object.
export function startSpikeServer({ port = 8090 } = {}) {
  const app = express();
  app.use(express.static('wwwroot'));
  app.use('/collision', express.static('collision'));
  app.use('/spike/m4', express.static('spike/m4'));
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}
