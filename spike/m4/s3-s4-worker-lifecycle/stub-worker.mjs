// spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs -- classic worker, no real geometry. Echoes the
// dispatch envelope back per a scripted `kind`, letting the page drive every §10.4 scenario
// deterministically through REAL postMessage/onmessage timing.
//
// Deliberately NOT a module worker (`new Worker(url)` with no `{type:'module'}`), so S3'/S4' do not
// depend on S1''s own finding about bare-specifier resolution in a module-worker realm (§17's S3'/S4'
// bound: "no real geometry"). The `.mjs` extension is retained only for filename consistency with
// the rest of spike/m4/ -- express.static serves it as text/javascript either way, which is all a
// classic worker script needs.

// ---- Metric H (§15.1) worker-side heap sample ---------------------------------------------------
// Task 3.10 carries spec §15.1's worker-sampling requirement (task 3.11 has no live worker of its
// own to sample). The reply deliberately does NOT travel back over the worker's normal message
// channel: by the time this is sampled the worker is (or has been) attached to a real
// createRequestTracker(), whose onmessage handler owns that channel and would correctly classify a
// heap-sample reply -- which carries no `requestId` -- as an unattributable PROTOCOL-FATAL message,
// rejecting every in-flight request and discarding the worker. Replying over a caller-transferred
// MessagePort keeps the tracker's own protocol surface completely untouched, so the Metric H sample
// is a genuine measurement OF a live protocol worker rather than an event that perturbs it.
function sampleOwnHeap(port) {
  const reply = (payload) => { if (port) port.postMessage(payload); };
  const memory = self.performance && self.performance.memory;
  if (!memory) {
    // Empirically confirmed (this task's own manual verification, both §6.1.5 runtimes): Chromium
    // exposes the non-standard `performance.memory` (MemoryInfo) on Window ONLY -- it is `undefined`
    // in a DedicatedWorkerGlobalScope even with --js-flags=--expose-gc, under which `gc()` itself IS
    // available worker-side. Named explicitly so heap-sampler.mjs recognizes this as a genuine
    // feature-unavailability signal ({available:false, reason}) rather than a harness defect.
    reply({ ok: false, reason: 'performance.memory is not exposed in a dedicated worker realm (Chromium defines MemoryInfo on Window only)' });
    return;
  }
  const gcAvailable = typeof self.gc === 'function';
  if (gcAvailable) { self.gc(); self.gc(); } // two GC passes, per §15.1's protocol
  const readings = [memory.usedJSHeapSize, memory.usedJSHeapSize, memory.usedJSHeapSize];
  reply({ ok: true, bytes: readings.sort((a, b) => a - b)[1], gcAvailable }); // median of three
}

self.onmessage = (ev) => {
  const { requestId, workerGeneration, worldGeneration, epochs, kind, delayMs, tag } = ev.data;

  if (kind === 'ack') { self.postMessage({ requestId, ok: true }); return; } // S3' cold-start ping only
  if (kind === 'heap-sample') { sampleOwnHeap(ev.data.port); return; } // §15.1, out-of-band (see above)

  const respond = () => {
    switch (kind) {
      case 'echo':
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [], tag } });
        break;
      case 'echo-unknown-epoch': // §10.4 (g): names an epoch the request never captured
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: 999999, fragmentIds: [] } });
        break;
      case 'echo-unknown-fragment': // §10.2 step 3: names a fragment id outside the known set
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [999999] } });
        break;
      case 'duplicate': // §10.4 (f)
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [], seq: 1 } });
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [], seq: 2 } });
        break;
      case 'no-request-id': // §10.2 routing-envelope / protocol-fatal path
        self.postMessage({ garbage: true }); // deliberately no requestId at all
        break;
      case 'crash': // §10.4 (h): triggers a REAL onerror event on the Worker
        throw new Error('scripted worker crash');
      default:
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs?.[0]?.epoch, fragmentIds: [] } });
    }
  };

  if (delayMs) setTimeout(respond, delayMs); else respond();
};
