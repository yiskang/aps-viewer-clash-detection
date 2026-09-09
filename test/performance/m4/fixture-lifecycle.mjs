// test/performance/m4/fixture-lifecycle.mjs
//
// M4 Task 3.1: the pure half of §6.1's runtime/fixture-lifecycle protocol. `run-gate-m4.mjs`'s
// live half (launch, load, warm-up, fresh-world dispose loop) consumes these; this file has no
// Playwright/browser dependency and is unit-tested directly.

// §6.1.5: two runtime configurations, (b) authoritative for every worker-related conclusion and
// every §7.2 target evaluation. `historical` exists for continuity with M1-M3's archived numbers
// (args copied verbatim from run-gate-m3.mjs:182).
export const RUNTIME_CONFIGS = {
  historical: { label: 'historical', args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'], authoritative: false },
  multiProcess: { label: 'multi-process', args: ['--no-sandbox', '--disable-dev-shm-usage'], authoritative: true },
};

// §6.1.4: fresh-world identity is (runtime, case, broadPhase, repetition), extended with `level`
// for S2T only (§5.3.1, §5.6) -- no other case has a level dimension.
export function freshWorldTupleKey({ runtime, caseName, level, broadPhase, repetition }) {
  const levelPart = level === undefined ? '' : `:level=${level}`;
  return `${runtime}:${caseName}${levelPart}:${broadPhase}:rep=${repetition}`;
}

// §6.1.4's declared exception (R6's third `refresh` sample) and §5.6's S4 warm-only declaration.
export function measuredStatesFor(caseName) {
  if (caseName === 'R6') return ['cold', 'warm', 'refresh'];
  if (caseName === 'S4') return ['warm'];
  return ['cold', 'warm'];
}

// Identical to run-gate.mjs/run-gate-m2.mjs/run-gate-m3.mjs's own helper -- duplicated per the
// no-shared-module convention (verified-refs.md Cross-cutting note 1), never imported from them.
export function resolveProxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const proxy = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    const bypass = process.env.NO_PROXY || process.env.no_proxy;
    if (bypass) proxy.bypass = bypass;
    return proxy;
  } catch {
    return undefined;
  }
}
