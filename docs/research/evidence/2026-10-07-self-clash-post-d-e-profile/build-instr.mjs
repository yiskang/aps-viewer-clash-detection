// node build-instr.mjs <repoRoot> <outDir>   (post-D/E copy: adds a page-wide 'longtask' PerformanceObserver to the init script)
// Reads product sources READ-ONLY, applies REPLACEMENTS in memory, writes:
//   <outDir>/patched/<file>            patched copies (scratch only)
//   <outDir>/install-profile-full.js   Playwright run_code: init script (full profile) + route rewrite
//   <outDir>/install-profile-lite.js   same, minimal-instrumentation variant (yield COUNT + unit wall only)
// The unified diff (instrumentation.patch) is produced afterwards with `diff -u` / `git diff --no-index`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPLACEMENTS } from './instr-replacements.mjs';

const [repo, out] = process.argv.slice(2);
if (!repo || !out) { console.error('usage: node build-instr.mjs <repoRoot> <outDir>'); process.exit(2); }

const byFile = new Map();
for (const r of REPLACEMENTS) {
  if (!byFile.has(r.file)) byFile.set(r.file, readFileSync(join(repo, r.file), 'utf8'));
  const src = byFile.get(r.file);
  const n = src.split(r.find).length - 1;
  if (n !== 1) throw new Error(`${r.file}: anchor occurs ${n} times: ${JSON.stringify(r.find.slice(0, 80))}`);
  byFile.set(r.file, src.replace(r.find, () => r.replace));
}
for (const [file, text] of byFile) {
  const p = join(out, 'patched', file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

const initScript = (mode) => `(() => {
  const P = { mode: ${JSON.stringify(mode)}, lite: ${mode === 'lite'}, latCap: 500000, lat: [], yieldTotal: 0, yieldSum: 0,
    units: [], cur: null, runUnits: [], interUnit: [], snaps: [], cancel: null, sealStart: null, sealEnd: null,
    stopClick: null, stoppedSeen: null, timers: { zeroCount: 0, zeroHist: {}, posCount: 0 }, installedAt: Date.now() };
  window.__CLASH_PROFILE = P;
  // Long tasks (>50 ms main-thread blocks), page-wide; capped. Added for the post-D/E profile.
  P.longtasks = [];
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (P.longtasks.length < 200000) P.longtasks.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
    P.longtaskSupported = true;
  } catch (e) { P.longtaskSupported = false; }
  if (!P.lite) {
    // Global setTimeout(<=0) latency histogram (1 ms buckets, capped at 50): every 0-delay timer in the page.
    const orig = window.setTimeout;
    window.setTimeout = function (fn, d, ...a) {
      if (typeof fn !== 'function' || (d !== undefined && d > 0)) { if (d > 0) P.timers.posCount++; return orig.call(this, fn, d, ...a); }
      const t0 = performance.now();
      return orig.call(this, function () { const ms = performance.now() - t0; const b = Math.min(50, Math.floor(ms)); P.timers.zeroCount++; P.timers.zeroHist[b] = (P.timers.zeroHist[b] || 0) + 1; return fn.apply(this, arguments); }, d, ...a);
    };
  }
  // Stop-click capture + "Stopped" observer (does not alter the click).
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (b && /^\\s*Stop\\s*$/i.test(b.textContent || '') && !P.stopClick) {
      P.stopClick = { t: performance.now(), wall: new Date().toISOString() };
      const panelRoot = b.closest('.docking-panel') || document.body;
      const check = () => { if (!P.stoppedSeen && /\\bStopped\\b/.test(panelRoot.innerText || '')) { P.stoppedSeen = { t: performance.now(), wall: new Date().toISOString() }; mo.disconnect(); } };
      const mo = new MutationObserver(check); mo.observe(panelRoot, { subtree: true, childList: true, characterData: true });
      check();
    }
  }, true);
})();`;

const install = (mode) => `async (page) => {
  const REPL = ${JSON.stringify(REPLACEMENTS.map(({ file, find, replace }) => ({ file, find, replace })))};
  const files = [...new Set(REPL.map((r) => r.file))];
  await page.addInitScript(${JSON.stringify(initScript(mode))});
  for (const file of files) {
    await page.route('**/' + file, async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      let applied = 0;
      for (const r of REPL) if (r.file === file) { const n = body.split(r.find).length - 1; if (n === 1) { body = body.replace(r.find, () => r.replace); applied++; } }
      const headers = { ...resp.headers() }; delete headers['content-length']; delete headers['etag']; delete headers['last-modified'];
      headers['cache-control'] = 'no-store'; headers['x-profile-applied'] = String(applied);
      await route.fulfill({ status: resp.status(), body, headers });
    });
  }
  return { mode: ${JSON.stringify(mode)}, files, replacements: REPL.length };
}`;

writeFileSync(join(out, 'install-profile-full.js'), install('full'));
writeFileSync(join(out, 'install-profile-lite.js'), install('lite'));
console.log(JSON.stringify({ files: [...byFile.keys()], replacements: REPLACEMENTS.length }));
