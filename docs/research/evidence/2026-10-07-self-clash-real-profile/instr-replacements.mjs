// Behavior-neutral, gated profiling marks for the 2026-10-07 real-model self-clash profile.
// NEVER written to the repository's product sources: build-instr.mjs turns this table into
//   (a) instrumentation.patch (unified diff of what the browser actually executed), and
//   (b) install-profile.js, a Playwright `page.route` handler that rewrites the served module text
//       in the profiled browser only.
// Every mark is a no-op unless `globalThis.__CLASH_PROFILE` exists (installed by the init script).
// Each `find` must occur EXACTLY once in its file (build-instr.mjs asserts this).

export const REPLACEMENTS = [
  // ---------------- clashtest/execution/LocalUnitExecutor.js ----------------
  {
    file: 'clashtest/execution/LocalUnitExecutor.js',
    find: '  const ctx = { checkpoint: () => yieldToScheduler() };',
    replace: `  const ctx = { checkpoint: () => {
    const P = globalThis.__CLASH_PROFILE; // PROFILE (gated; absent => original behaviour)
    if (!P) return yieldToScheduler();
    P.yieldTotal++; if (P.cur) P.cur.yields++;
    if (P.lite) return yieldToScheduler();
    const t0 = performance.now();
    return Promise.resolve(yieldToScheduler()).then(() => {
      const d = performance.now() - t0; P.yieldSum += d; if (P.cur) P.cur.yieldMs += d;
      if (P.lat.length < P.latCap) P.lat.push(d);
    });
  } };`,
  },
  {
    file: 'clashtest/execution/LocalUnitExecutor.js',
    find: '    const startedAt = now();\n',
    replace: `    const startedAt = now();
    const __P = globalThis.__CLASH_PROFILE; // PROFILE
    const __U = __P ? { unitId: request?.unit?.unitId ?? null, tStart: performance.now(),
      srcRoots: request?.materialized?.sourceDbIds?.length ?? null,
      targets: (request?.materialized?.targets ?? []).map((t) => (t.scope === 'whole' ? 'whole' : (t.dbIds?.length ?? null))),
      scopeExpect: (request?.materialized?.scopeExpect ?? []).map((e) => (e?.scope === 'whole' ? 'whole' : (e?.roots?.length ?? null))),
      yields: 0, yieldMs: 0, digests: [] } : null;
    if (__P) { __P.cur = __U; __P.units.push(__U); }
`,
  },
  {
    file: 'clashtest/execution/LocalUnitExecutor.js',
    find: '    const pre = await bracket(preBindings);\n',
    replace: `    const __pre0 = performance.now(); const __preY = __U ? __U.yields : 0; // PROFILE
    const pre = await bracket(preBindings);
    if (__U) { __U.preMs = performance.now() - __pre0; __U.preYields = __U.yields - __preY; }
`,
  },
  {
    file: 'clashtest/execution/LocalUnitExecutor.js',
    find: '      result = await world.findClashes(buildFindClashesQuery(request, resolved));\n',
    replace: `      const __f0 = performance.now(); // PROFILE
      try {
        result = await world.findClashes(buildFindClashesQuery(request, resolved));
      } finally {
        if (__U) {
          __U.callMs = performance.now() - __f0;
          const s = result?.statistics;
          if (s) __U.lib = { broadPhasePairs: s.broadPhasePairs, narrowPhasePairs: s.narrowPhasePairs, broadPhaseMs: s.broadPhaseMs,
            narrowPhaseMs: s.narrowPhaseMs, totalMs: s.totalMs, tlasBuildMs: s.tlasBuildMs, tlasQueryMs: s.tlasQueryMs,
            tlasPrimitiveCandidatePairs: s.tlasPrimitiveCandidatePairs, diagnostics: Array.isArray(s.diagnostics) ? s.diagnostics.length : null,
            pairs: Array.isArray(result?.pairs) ? result.pairs.length : null };
        }
      }
`,
  },
  {
    file: 'clashtest/execution/LocalUnitExecutor.js',
    find: '    let post = await bracket(preBracketStillHeld);\n',
    replace: `    const __po0 = performance.now(); const __poY = __U ? __U.yields : 0; // PROFILE
    let post = await bracket(preBracketStillHeld);
    if (__U) { __U.postMs = performance.now() - __po0; __U.postYields = __U.yields - __poY; }
`,
  },
  // ---------------- clashtest/planning/scopeDigest.js ----------------
  {
    file: 'clashtest/planning/scopeDigest.js',
    find: '      observed = await enumerator.digestScope(binding, scope, ctx);\n',
    replace: `      const __P = globalThis.__CLASH_PROFILE; const __U = __P && !__P.lite ? __P.cur : null; // PROFILE
      const __d0 = performance.now(); const __dY = __U ? __U.yields : 0;
      observed = await enumerator.digestScope(binding, scope, ctx);
      if (__U) __U.digests.push({ kind: entry.scope === 'whole' ? 'whole' : 'roots', roots: entry.scope === 'whole' ? null : (entry.roots?.length ?? null),
        ms: performance.now() - __d0, yields: __U.yields - __dY });
`,
  },
  // ---------------- clashtest/run/Run.js ----------------
  {
    file: 'clashtest/run/Run.js',
    find: '    if (!first) await run.interUnitYield();               // §7.3: animation-frame-aligned or macrotask\n',
    replace: `    if (!first) { const __i0 = performance.now(); await run.interUnitYield(); globalThis.__CLASH_PROFILE?.interUnit.push(performance.now() - __i0); } // §7.3 (PROFILE timed)
`,
  },
  {
    file: 'clashtest/run/Run.js',
    find: '      return run.sealAs(boundaryStatus);\n',
    replace: `      { const __P = globalThis.__CLASH_PROFILE; // PROFILE
        if (__P) __P.sealStart = { t: performance.now(), status: boundaryStatus, queueLeft: queue.length };
        const __sr = run.sealAs(boundaryStatus);
        if (__P) Promise.resolve(__sr).then(() => { __P.sealEnd = performance.now(); }, () => { __P.sealEnd = performance.now(); });
        return __sr; }
`,
  },
  {
    file: 'clashtest/run/Run.js',
    find: '    const result = await runUnitWithRetries(run, unit);\n',
    replace: `    const __r0 = performance.now(); // PROFILE
    const result = await runUnitWithRetries(run, unit);
    globalThis.__CLASH_PROFILE?.runUnits.push({ unitId: unit.unitId, t0: __r0, t1: performance.now(),
      pairSpaceProcessed: run.pending.pairSpaceProcessed, resultsFound: run.pending.resultsFound, caveatCount: run.pending.caveatCount });
`,
  },
  {
    file: 'clashtest/run/Run.js',
    find: '  const diagnostics = run.spec.diagnosticAggregator.snapshot();\n  run.pending.caveatCount',
    replace: `  const __s0 = performance.now(); // PROFILE
  const diagnostics = run.spec.diagnosticAggregator.snapshot();
  globalThis.__CLASH_PROFILE?.snaps.push(performance.now() - __s0);
  run.pending.caveatCount`,
  },
  {
    file: 'clashtest/run/Run.js',
    find: 'function requestCancel(run, reason, { dispose = false } = {}) {\n',
    replace: `function requestCancel(run, reason, { dispose = false } = {}) {
  { const __P = globalThis.__CLASH_PROFILE; // PROFILE
    if (__P && !__P.cancel) __P.cancel = { t: performance.now(), currentUnitId: run.pending?.currentUnitId ?? null, status: run.status, executorUnitsStarted: __P.units.length }; }
`,
  },
];
