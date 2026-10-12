// test/calibration/ctm8/scenarios/familyR.mjs
// NON-PRODUCTION calibration support (CTM8-P0-v4, Family R; governing spec:
// docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md §5.2, §6.2, §7.1–§7.6, §8).
//
// Implements the frozen UNIFORM generator, the single NAME rule, the mC object-tree replacement, the per-cell
// name/count proof, and the four Family R scenarios (R-BASE, R-WARM, R-GROUP-WARM, R-COLD) behind the runner's
// cell contract: setup / prepareSample / runSample / resetSample / teardown.
//
// Observation boundary (§7.3): only controller `dispatch` / `subscribe` / `getViewModel`, the fake scheduler's public
// members (advance, yieldCount, pendingTimers) and the recording bridge's public members are used. No private controller
// state is read. Read-only reuse of test/clashpanel/support/* (nothing there is modified).
import { createHash } from 'node:crypto';
import { makeHarness, makeSet } from '../../../clashpanel/support/controllerHarness.mjs';
import { until, drain } from '../../../clashpanel/support/settle.mjs';
import { INTENT } from '../../../../clashpanel/core/intents.js';
import { FILTER_DEBOUNCE_MS } from '../../../../clashpanel/core/constants.js';

export const T1 = 'tagq';
export const T2 = 'tagr';
export const S1 = 'group-label';
export const S2 = 'group-count';
export const S_STAR = 10;
export const G_STAR = Object.freeze({ modelKey: 'mA', dbId: 1000 });
export const G_STAR_ID = JSON.stringify(['element', {}, { dbId: 1000, modelKey: 'mA' }]);
export const TIMED_TIMEOUT_MS = 30000;
export const SETUP_TIMEOUT_MS = 120000;
export const WARM_PROOF_TIMEOUT_MS = 30000;
export const SCENARIOS = Object.freeze(['R-BASE', 'R-WARM', 'R-GROUP-WARM', 'R-COLD']);

const DISPLAY_NAMES = Object.freeze({ mA: 'Architecture', mB: 'Structure', mC: 'Mechanical' });
const PAGE_ROWS = 50;                       // only used to explain the page arithmetic; the VM's page.size is authoritative

// ── pure helpers (§6.2) ──────────────────────────────────────────────────────────────────────────────────────────

/** §6.2 single pure element-name rule; depends only on (modelKey, dbId). */
export function NAME(modelKey, dbId) {
  if (dbId >= 2000000) {
    const i = dbId - 2000000;
    return `Pipe-${i}${i % 2 === 0 ? ' tagq' : ''}${i % 10 === 0 ? ' tagr' : ''}`;
  }
  if (modelKey === 'mA' && dbId === 1000) return 'Wall-1000 tagq tagr';
  return `Wall-${dbId}`;
}

/** PAIRS(n_models) (§6.2). */
export function pairsFor(n) {
  if (n === 1) return [['mA', 'mA']];
  if (n === 2) return [['mA', 'mB']];
  if (n === 3) return [['mA', 'mB'], ['mA', 'mC'], ['mB', 'mC']];
  throw new RangeError(`familyR: n_models must be 1, 2 or 3 (got ${n})`);
}

/** Model keys participating for n_models (catalog provenance for makeSet). */
export function modelKeysFor(n) {
  return n === 1 ? ['mA'] : n === 2 ? ['mA', 'mB'] : ['mA', 'mB', 'mC'];
}

/** §6.2 UNIFORM generator (the only profile in this module): makeSet result specs {a:[k,id], b:[k,id]}. */
export function generateResults(N, n) {
  if (!Number.isInteger(N) || N <= 0 || N % 10 !== 0) throw new RangeError(`familyR: N must be a positive multiple of 10 (got ${N})`);
  const PAIRS = pairsFor(n);
  const P = PAIRS.length;
  const out = new Array(N);
  for (let i = 0; i < N; i += 1) {
    const [X, Y] = PAIRS[Math.floor(i / 10) % P];
    out[i] = { a: [X, 1000 + Math.floor(i / 10)], b: [Y, 2000000 + i] };
  }
  return out;
}

/** §6.2 exact expected counts (UNIFORM). */
export function expectedCounts(N) {
  return {
    elementGroups: N + N / 10,                 // 1.1·N
    maxGroupSize: S_STAR,
    sStar: S_STAR,
    uniqueParticipants: N / 10 + N,
    gStarParticipants: S_STAR + 1,
    wT1: N / 2 + 5,
    wT2: N / 10 + 9,
    cold: 0,
  };
}

const provenanceModels = (n) => modelKeysFor(n).map((modelKey) => ({ modelKey, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 }));

/** The deterministic fixture: generator output, provenance models and the frozen sealed set. */
export function buildFixture(N, n) {
  const results = generateResults(N, n);
  const models = provenanceModels(n);
  const set = makeSet({ runId: `run-ctm8-r-${N}-${n}`, results, models });
  const hashed = { profile: 'UNIFORM', N, nModels: n, models, results };
  return { N, n, results, models, set, hash: sha256(canonicalJson(hashed)) };
}

/** Local canonical JSON: sorted object keys, no whitespace; arrays keep order. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export const sha256 = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

/** Distinct (modelKey, dbId) elements of the generated set, first-seen order. */
export function distinctElements(results) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    for (const [modelKey, dbId] of [r.a, r.b]) {
      const key = `${modelKey}\u0000${dbId}`;
      if (!seen.has(key)) { seen.add(key); out.push({ modelKey, dbId }); }
    }
  }
  return out;
}

/** First-page identity list of a VM (group rows by groupId, result rows by resultId). */
export const identityList = (vm) => vm.results.rows.map((r) => (r.kind === 'group' ? `g:${r.groupId}` : `r:${r.resultId}`));
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const refSummary = (list) => ({ length: list.length, hash: sha256(canonicalJson(list)), first3: list.slice(0, 3) });

/** Canonical P-WARM(T) (§7.3); returns the failed clause names (empty = holds). */
export function pWarmFailures(vm, T, W, reference) {
  const f = [];
  if (vm.filters.text !== T) f.push('text');
  if (vm.filters.active !== true) f.push('active');
  if (vm.filters.busy !== false) f.push('busy');
  if (vm.results.state !== 'list') f.push('state');
  if (vm.run.counts.filtered !== W) f.push('filtered');
  if (reference !== null && !sameList(identityList(vm), reference)) f.push('firstPage');
  return f;
}

// ── wall-clock bounds ────────────────────────────────────────────────────────────────────────────────────────────

/** Bounded wait for disposal of a harness (best effort; a hang is reported, never awaited forever). */
export const DISPOSE_WAIT_MS = 5000;
/** Grace for a cooperatively stopped polling loop to end after its wall-clock bound won. */
export const STOP_GRACE_MS = 1000;
export const POISONED_REASON = 'harness poisoned by timed-out operation';

/**
 * Races `promise` against a real wall-clock timer (cleared on completion). Never awaits `promise` after the timer won.
 * -> {outcome:'ok', value} | {outcome:'error', error} | {outcome:'timeout'}
 */
export async function raceDeadline(promise, ms) {
  let timer = null;
  const clock = new Promise((resolve) => { timer = setTimeout(() => resolve({ outcome: 'timeout' }), Math.max(0, ms)); });
  const work = Promise.resolve(promise).then((value) => ({ outcome: 'ok', value }), (error) => ({ outcome: 'error', error }));
  const r = await Promise.race([work, clock]);
  clearTimeout(timer);
  return r;
}

/**
 * Repo `until(scheduler, pred, maxRounds)` (round-bounded) raced against a real wall-clock bound. The loop is
 * cooperative: once the bound wins, an abort flag (checked every settle round) ends it; it is given STOP_GRACE_MS to
 * stop and is never awaited without a bound.
 * Outcome: 'ok' | 'rounds-exhausted' (never folded into timeout) | 'timeout' (loop stopped) | 'timeout-stuck'
 * (loop did not stop within the grace — the harness must be treated as poisoned).
 */
export async function waitFor(scheduler, predicate, { wallMs, maxRounds = 20000, graceMs = STOP_GRACE_MS }) {
  let stop = false;
  const loop = until(scheduler, () => stop || predicate(), maxRounds).then(() => (stop ? 'stopped' : 'ok'), () => 'rounds-exhausted');
  const r = await raceDeadline(loop, wallMs);
  if (r.outcome === 'ok') return r.value;
  stop = true;
  const g = await raceDeadline(loop, graceMs);
  return g.outcome === 'ok' ? 'timeout' : 'timeout-stuck';
}

class SetupTimeout extends Error {
  constructor(where, { poisoned = false } = {}) { super(`setup bound exceeded at ${where}`); this.name = 'SetupTimeout'; this.poisoned = poisoned; }
}
class SetupInvalid extends Error {
  constructor(reason, detail) { super(reason); this.name = 'SetupInvalid'; this.detail = detail; }
}
class Unavailable extends Error {
  constructor(reason) { super(reason); this.name = 'Unavailable'; }
}

/**
 * One untimed wall-clock bound (§7.6: 120,000 ms for setup / prepare / reset). `run(where, fn)` races EVERY harness
 * operation (dispatch, readyHard, runToDone, advance, …) against the remaining bound; `wait` bounds predicate loops.
 * `beforeStep` is a test-only hook awaited inside the bounded step.
 */
function deadlineOf(ms, beforeStep = null) {
  const end = performance.now() + ms;
  const dl = {
    remaining: () => end - performance.now(),
    check(where) { if (performance.now() >= end) throw new SetupTimeout(where); },
    async run(where, fn) {
      dl.check(where);
      const r = await raceDeadline(Promise.resolve().then(async () => {
        if (beforeStep) await beforeStep(where);
        return fn();
      }), dl.remaining());
      if (r.outcome === 'timeout') throw new SetupTimeout(where, { poisoned: true });
      if (r.outcome === 'error') throw r.error;
      return r.value;
    },
    async wait(where, scheduler, predicate, { capMs = Infinity, maxRounds } = {}) {
      dl.check(where);
      const out = await waitFor(scheduler, predicate, { wallMs: Math.min(capMs, dl.remaining()), maxRounds });
      if (out === 'timeout-stuck') throw new SetupTimeout(where, { poisoned: true });
      if (out === 'timeout') dl.check(where);         // the setup bound itself ran out -> SetupTimeout
      return out;
    },
  };
  return dl;
}

// ── harness construction (§6.2 frozen construction) ──────────────────────────────────────────────────────────────

/**
 * makeHarness with the NAME rule for mA/mB and, for n=3, the mC object-tree replacement performed IMMEDIATELY after
 * makeHarness returns (before any dispatch, seal, label read or hashing). `skipMcInjection` is a test-only negative path.
 */
export function makeNamedHarness(n, { skipMcInjection = false } = {}) {
  const extraModels = n === 3 ? [{ modelKey: 'mC', displayName: 'Mechanical' }] : [];
  const h = makeHarness({ names: { mA: (d) => NAME('mA', d), mB: (d) => NAME('mB', d) }, extraModels });
  if (n === 3 && !skipMcInjection) {
    h.extraModels.mC.getObjectTree = () => ({ getNodeName: (d) => NAME('mC', d) });
  }
  return h;
}

/** §6.2 name proof (i)+(ii) over every distinct generated element. */
export function nameProof(h, fixture) {
  const modelFor = { mA: h.modelA, mB: h.modelB, mC: h.extraModels.mC };
  const mcIdentity = fixture.n === 3 ? h.extraModels.mC !== undefined && h.extraModels.mC === h.catalog.modelOf('mC') : null;
  const elements = distinctElements(fixture.results);
  const mismatches = [];
  let checked = 0;
  let mismatchCount = 0;
  for (const { modelKey, dbId } of elements) {
    const model = modelFor[modelKey];
    let got;
    try { got = model.getObjectTree().getNodeName(dbId); } catch (e) { got = `<threw ${e?.message}>`; }
    checked += 1;
    if (got !== NAME(modelKey, dbId)) {
      mismatchCount += 1;
      if (mismatches.length < 5) mismatches.push({ modelKey, dbId, got, want: NAME(modelKey, dbId) });
    }
  }
  const ok = (fixture.n !== 3 || mcIdentity === true) && mismatchCount === 0;
  return { ok, mcIdentity, checked, mismatchCount, mismatches };
}

/** Fixture-level cold proof: pre-commit match text (display name + dbId) never contains a sentinel. */
export function coldTextProof(fixture) {
  let hits = 0;
  for (const { modelKey, dbId } of distinctElements(fixture.results)) {
    const text = `${DISPLAY_NAMES[modelKey]} ${dbId}`.toLowerCase();
    if (text.includes(T1) || text.includes(T2)) hits += 1;
  }
  return { ok: hits === 0, hits };
}

function nameStats(fixture) {
  let min = Infinity; let max = 0;
  const chars = new Set();
  for (const { modelKey, dbId } of distinctElements(fixture.results)) {
    const name = NAME(modelKey, dbId);
    min = Math.min(min, name.length); max = Math.max(max, name.length);
    for (const ch of name) chars.add(ch);
  }
  return { minLength: min, maxLength: max, charset: [...chars].sort().join('') };
}

const vmOf = (h) => h.controller.getViewModel();

/** Loads + seals the set, lands element grouping, sets S1 (common pre-state minus subscriber/filter). */
async function loadCommon(h, fixture, dl) {
  const N = fixture.N;
  await dl.run('readyHard', () => h.readyHard());
  await dl.run('runToDone', () => h.runToDone(fixture.set, { status: 'completed' }));
  let r = await dl.wait('seal', h.scheduler, () => { const vm = vmOf(h); return vm.run.counts.total === N && vm.run.counts.filtered === N && vm.filters.busy === false; });
  if (r !== 'ok') throw new SetupInvalid(`sealed list did not land (${r})`);
  await dl.run('group-mode', () => h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' }));
  r = await dl.wait('grouping', h.scheduler, () => { const vm = vmOf(h); return vm.results.view === 'grouped' && vm.filters.busy === false && vm.results.state === 'list'; });
  if (r !== 'ok') throw new SetupInvalid(`element grouping did not land (${r})`);
  await dl.run('sort-s1', () => h.dispatch({ type: INTENT.SORT_SET, value: S1 }));
  const vm = vmOf(h);
  if (vm.filters.sort !== S1 || vm.filters.busy !== false || vm.results.state !== 'list') throw new SetupInvalid('S1 sort did not land');
}

/** §6.2 (iii) count proof on the first grouped VM (+ page walk for the exact group count; restored to page 0). */
async function firstVmCounts(h, fixture, dl) {
  const exp = expectedCounts(fixture.N);
  const vm = vmOf(h);
  const size = vm.results.page.size;
  const pages = vm.results.page.count;
  await dl.run('count-walk', () => h.dispatch({ type: INTENT.NAV_PAGE, page: pages - 1 }));
  const last = vmOf(h);
  const lastRows = last.results.rows.filter((r) => r.kind === 'group').length;
  const groups = (pages - 1) * size + lastRows;
  await dl.run('count-walk-back', () => h.dispatch({ type: INTENT.NAV_PAGE, page: 0 }));
  const back = vmOf(h);
  const observed = {
    total: vm.run.counts.total, filtered: vm.run.counts.filtered, view: vm.results.view,
    elementGroups: groups, pageIndexRestored: back.results.page.index === 0,
    allRowsGroups: last.results.rows.every((r) => r.kind === 'group') && vm.results.rows.every((r) => r.kind === 'group'),
  };
  const ok = observed.total === fixture.N && observed.filtered === fixture.N && observed.view === 'grouped'
    && observed.elementGroups === exp.elementGroups && exp.elementGroups === exp.uniqueParticipants
    && observed.pageIndexRestored && observed.allRowsGroups && size === PAGE_ROWS;
  return { ok, observed, expected: exp };
}

/** Sets the draft text outside the window and fires the debounce, then waits for P-WARM(T) (untimed, bounded). */
async function proveWarm(h, dl, T, W, reference, capMs = Infinity) {
  await dl.run(`filter-${T}`, () => h.dispatch({ type: INTENT.FILTER_TEXT, value: T }));
  await dl.run(`debounce-${T}`, () => h.scheduler.advance(FILTER_DEBOUNCE_MS));
  const r = await dl.wait(`P-WARM(${T})`, h.scheduler, () => pWarmFailures(vmOf(h), T, W, reference).length === 0, { capMs });
  return { outcome: r, failures: pWarmFailures(vmOf(h), T, W, reference) };
}

// ── the cell ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {{family:'R', scenario:string, scale:number, nModels:1|2|3, kind:'warm'|'cold', profile:'UNIFORM', cellId:string}} cellSpec
 * @param {object} [testOptions] TEST-ONLY knobs for negative paths (never used by the campaign runner):
 *   skipMcInjection (bool), maxRounds (number), untimedBoundMs (number, default 120000; prepare/reset bound),
 *   hooks: { beforeTrigger?: () => any, beforeStep?: (where) => any, dispose?: (h, role) => any }
 *   (`dispose` REPLACES the real controller disposal; role is 'prep' | 'main' | 'cold').
 */
export function createCell(cellSpec, testOptions = {}) {
  const { scenario, scale: N, nModels: n } = cellSpec;
  if (cellSpec.family !== 'R') throw new Error('familyR: cellSpec.family must be R');
  if (!SCENARIOS.includes(scenario)) throw new Error(`familyR: unknown scenario ${scenario}`);
  if (cellSpec.profile !== 'UNIFORM') throw new Error('familyR: only the UNIFORM profile exists');
  const wantKind = scenario === 'R-COLD' ? 'cold' : 'warm';
  if (cellSpec.kind !== wantKind) throw new Error(`familyR: ${scenario} is a ${wantKind} cell`);
  const harnessOpts = { skipMcInjection: testOptions.skipMcInjection === true };
  const maxRounds = testOptions.maxRounds ?? 20000;
  const untimedBoundMs = testOptions.untimedBoundMs ?? SETUP_TIMEOUT_MS;
  const hooks = testOptions.hooks ?? {};
  const exp = expectedCounts(N);

  let fixture = null;
  let refs = null;
  let manifest = null;
  let h = null;                 // main harness (warm) / per-sample fresh harness (cold)
  let poisoned = false;         // the current harness had an operation exceed its wall-clock bound
  let unsubscribe = null;
  let notifications = 0;
  let transitionLog = null;     // R-COLD only, armed inside the window
  let p0 = null;
  const harnessIds = [];        // R-COLD freshness evidence (test-visible)
  let harnessSeq = 0;

  /** Best-effort, bounded disposal. Failures are returned (never swallowed). */
  async function disposeHarness(hh, role) {
    if (!hh) return { ok: true };
    const fn = typeof hooks.dispose === 'function'
      ? () => hooks.dispose(hh, role)
      : () => drain(hh.scheduler, Promise.resolve().then(() => hh.controller.dispose()), 2000);
    const r = await raceDeadline(Promise.resolve().then(fn), DISPOSE_WAIT_MS);
    if (r.outcome === 'ok') return { ok: true };
    return { ok: false, error: r.outcome === 'timeout' ? `disposal did not finish within ${DISPOSE_WAIT_MS} ms` : String(r.error?.message ?? r.error) };
  }

  const subscribe = (hh) => {
    notifications = 0;
    unsubscribe = hh.controller.subscribe((vm) => {
      notifications += 1;
      if (transitionLog !== null) {
        transitionLog.push([performance.now(), vm.filters.busy, vm.run.counts.filtered, vm.results.state]);
      }
    });
  };

  async function releaseMain() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const old = h;
    h = null;
    poisoned = false;             // poison is per harness; the discarded harness is never reused
    return disposeHarness(old, scenario === 'R-COLD' ? 'cold' : 'main');
  }

  const selectedOk = (vm) => vm.selected !== null && vm.selected.kind === 'group' && vm.selected.groupId === G_STAR_ID
    && vm.selected.clashCount === S_STAR && vm.selected.participants === exp.gStarParticipants;

  /** Pre-state predicate per scenario (untimed). Returns failure strings. */
  function preStateFailures() {
    const vm = vmOf(h);
    const f = [];
    if (vm.results.view !== 'grouped') f.push('view');
    if (vm.filters.sort !== S1) f.push('sort');
    if (scenario === 'R-BASE' || scenario === 'R-COLD') {
      if (vm.filters.active !== false) f.push('active');
      if (vm.filters.busy !== false) f.push('busy');
      if (vm.results.state !== 'list') f.push('state');
      if (vm.run.counts.filtered !== N) f.push('filtered');
      if (!sameList(identityList(vm), refs.S1)) f.push('firstPage(S1)');
      if (vm.selected !== null) f.push('selection');
    } else {
      f.push(...pWarmFailures(vm, T1, exp.wT1, refs.T1).map((x) => `P-WARM(T1).${x}`));
      if (scenario === 'R-WARM' && vm.selected !== null) f.push('selection');
      if (scenario === 'R-GROUP-WARM') {
        if (!selectedOk(vm)) f.push('selected-group');
        if (h.bridge.groupPresents.length !== p0) f.push('presentGroup-count');
      }
    }
    return f;
  }

  /**
   * Untimed preparatory pass on a THROWAWAY harness (§5.2, §7.3): name proof, first-VM counts, S1/S2 references,
   * T1/T2 references (with exact W(T)), max group size, G* membership. Never a sample.
   */
  async function preparatoryPass(dl) {
    const hh = makeNamedHarness(n, harnessOpts);
    let failure = null;
    try {
      const proof = nameProof(hh, fixture);
      if (!proof.ok) throw new SetupInvalid('name proof failed', { nameProof: proof });
      dl.check('prep-name-proof');
      await loadCommon(hh, fixture, dl);
      const counts = await firstVmCounts(hh, fixture, dl);
      if (!counts.ok) throw new SetupInvalid('first-VM count proof failed', { counts });
      const s1 = identityList(vmOf(hh));
      await dl.run('prep-sort-s2', () => hh.dispatch({ type: INTENT.SORT_SET, value: S2 }));
      let vm = vmOf(hh);
      if (vm.filters.sort !== S2 || vm.filters.busy !== false || vm.results.state !== 'list') throw new SetupInvalid('S2 sort did not land in the preparatory pass');
      const s2 = identityList(vm);
      const maxGroupSize = vm.results.rows[0]?.count ?? null;
      await dl.run('prep-sort-s1', () => hh.dispatch({ type: INTENT.SORT_SET, value: S1 }));
      if (!sameList(identityList(vmOf(hh)), s1)) throw new SetupInvalid('S1 list not reproduced after S2 → S1');
      const w1 = await proveWarm(hh, dl, T1, exp.wT1, null, WARM_PROOF_TIMEOUT_MS);
      if (w1.outcome !== 'ok') throw new SetupInvalid(`preparatory P-WARM(T1) not reached (${w1.outcome}; ${w1.failures.join(',')})`);
      const t1 = identityList(vmOf(hh));
      const wT1Observed = vmOf(hh).run.counts.filtered;
      const w2 = await proveWarm(hh, dl, T2, exp.wT2, null, WARM_PROOF_TIMEOUT_MS);
      if (w2.outcome !== 'ok') throw new SetupInvalid(`preparatory P-WARM(T2) not reached (${w2.outcome}; ${w2.failures.join(',')})`);
      const t2 = identityList(vmOf(hh));
      const wT2Observed = vmOf(hh).run.counts.filtered;
      await dl.run('prep-group-present', () => hh.dispatch({ type: INTENT.GROUP_PRESENT, groupId: G_STAR_ID }));
      vm = vmOf(hh);
      const gStar = { kind: vm.selected?.kind ?? null, groupId: vm.selected?.groupId ?? null, clashCount: vm.selected?.clashCount ?? null, participants: vm.selected?.participants ?? null };
      const observedCounts = { ...counts.observed, maxGroupSize, wT1: wT1Observed, wT2: wT2Observed, gStarClashCount: gStar.clashCount, gStarParticipants: gStar.participants };
      if (maxGroupSize !== exp.maxGroupSize || gStar.kind !== 'group' || gStar.groupId !== G_STAR_ID
        || gStar.clashCount !== exp.sStar || gStar.participants !== exp.gStarParticipants) {
        throw new SetupInvalid('S*/G* count proof failed', { observedCounts });
      }
      return { nameProof: proof, observedCounts, refs: { S1: s1, S2: s2, T1: t1, T2: t2 } };
    } catch (e) {
      failure = e;
      throw e;
    } finally {
      const d = await disposeHarness(hh, 'prep');
      if (!d.ok) {
        manifest.cleanupFailures = [...(manifest.cleanupFailures ?? []), `prep: ${d.error}`];
        if (failure === null) throw new SetupInvalid(`dispose failed (preparatory harness): ${d.error}`);   // eslint-disable-line no-unsafe-finally
      }
    }
  }

  /** Fresh harness with the common pre-state (used by warm setup and by every R-COLD sample). */
  async function buildMain(dl) {
    const hh = makeNamedHarness(n, harnessOpts);
    harnessSeq += 1;
    hh.calibrationHarnessId = harnessSeq;
    try {
      const proof = nameProof(hh, fixture);
      if (!proof.ok) throw new SetupInvalid('name proof failed', { nameProof: proof });
      await loadCommon(hh, fixture, dl);
      const counts = await firstVmCounts(hh, fixture, dl);
      if (!counts.ok) throw new SetupInvalid('first-VM count proof failed', { counts });
      return { hh, proof };
    } catch (e) {
      const d = await disposeHarness(hh, scenario === 'R-COLD' ? 'cold' : 'main');
      if (!d.ok) e.cleanupFailure = d.error;
      throw e;
    }
  }

  async function setup({ setupTimeoutMs = SETUP_TIMEOUT_MS } = {}) {
    const dl = deadlineOf(setupTimeoutMs, hooks.beforeStep ?? null);
    const started = performance.now();
    manifest = {
      protocol: 'CTM8-P0-v4', family: 'R', parameters: { ...cellSpec }, generator: 'UNIFORM §6.2',
      expectedCounts: exp, gStar: { ...G_STAR, groupId: G_STAR_ID }, sentinels: { T1, T2 }, sorts: { S1, S2 },
      mcInjection: n === 3 ? (harnessOpts.skipMcInjection ? 'SKIPPED (test-only negative path)' : 'getObjectTree replaced immediately after makeHarness') : 'n/a',
    };
    try {
      dl.check('start');
      fixture = buildFixture(N, n);                 // hashed BEFORE any sample
      manifest.fixtureHash = fixture.hash;
      manifest.nameStats = nameStats(fixture);
      const cold = coldTextProof(fixture);
      manifest.coldTextProof = cold;
      if (!cold.ok) throw new SetupInvalid('cold-text proof failed');
      dl.check('fixture');
      const prep = await preparatoryPass(dl);
      refs = prep.refs;
      manifest.nameProof = prep.nameProof;
      manifest.observedCounts = prep.observedCounts;
      manifest.references = Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, refSummary(v)]));
      if (scenario !== 'R-COLD') {
        const { hh, proof } = await buildMain(dl);
        h = hh;
        manifest.mainNameProof = { ok: proof.ok, mcIdentity: proof.mcIdentity, checked: proof.checked };
        subscribe(h);                               // §7.2: one no-op subscriber before warm-up
        if (scenario === 'R-WARM' || scenario === 'R-GROUP-WARM') {
          const w = await proveWarm(h, dl, T1, exp.wT1, refs.T1, WARM_PROOF_TIMEOUT_MS);
          if (w.outcome !== 'ok') throw new Unavailable(`warm state not proven (${w.outcome}; ${w.failures.join(',')})`);
          manifest.warmProof = { ok: true };
          if (scenario === 'R-GROUP-WARM') {
            await dl.run('group-present', () => h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: G_STAR_ID }));
            p0 = h.bridge.groupPresents.length;
            if (!selectedOk(vmOf(h)) || p0 < 1) throw new SetupInvalid('G* selection did not land');
            manifest.p0 = p0;
          }
        }
        const f = preStateFailures();
        if (f.length > 0) throw new SetupInvalid(`pre-state not established: ${f.join(',')}`);
      }
      manifest.setupWallMs = performance.now() - started;
      return { status: 'OK', manifest };
    } catch (e) {
      manifest.setupWallMs = performance.now() - started;
      const d = await releaseMain();
      const cleanup = [...(manifest.cleanupFailures ?? []), ...(e?.cleanupFailure ? [`build: ${e.cleanupFailure}`] : []), ...(d.ok ? [] : [`main: ${d.error}`])];
      if (cleanup.length > 0) manifest.cleanupFailures = cleanup;
      if (e instanceof SetupTimeout) return { status: 'SETUP_TIMEOUT', reason: e.message, manifest };
      if (e instanceof Unavailable) { manifest.warmProof = { ok: false, reason: e.message }; return { status: 'UNAVAILABLE', reason: 'warm state not proven', manifest }; }
      if (e instanceof SetupInvalid) { if (e.detail) manifest.failure = e.detail; return { status: 'INVALID_SETUP', reason: e.message, manifest }; }
      return { status: 'INVALID_SETUP', reason: `setup threw: ${e?.message ?? e}`, manifest };
    }
  }

  /** Maps an exception from a bounded untimed step to a {ok:false} result, poisoning the harness on a hang. */
  function untimedFailure(e, label) {
    if (e instanceof SetupTimeout) {
      if (e.poisoned) poisoned = true;
      return { ok: false, reason: `${label}: ${e.message}${e.poisoned ? ` (${POISONED_REASON})` : ''}` };
    }
    return { ok: false, reason: `${label}: ${e?.message ?? e}` };
  }

  async function prepareSample() {
    try {
      if (scenario === 'R-COLD') {
        if (h !== null) {                           // never reuse a cold harness
          const d = await releaseMain();
          if (!d.ok) return { ok: false, reason: `dispose failed: ${d.error}` };
        }
        const dl = deadlineOf(untimedBoundMs, hooks.beforeStep ?? null);
        let built;
        try { built = await buildMain(dl); } catch (e) {
          if (e instanceof SetupTimeout && e.poisoned) return { ok: false, reason: `cold build: ${e.message} (${POISONED_REASON})` };
          return untimedFailure(e, 'cold build');
        }
        h = built.hh;
        harnessIds.push(h.calibrationHarnessId);
        subscribe(h);
        const f = preStateFailures();
        if (f.length > 0) return { ok: false, reason: `cold pre-state: ${f.join(',')}` };
        await dl.run('cold-draft', () => h.dispatch({ type: INTENT.FILTER_TEXT, value: T1 }));   // draft only, outside the window
        const vm = vmOf(h);
        if (vm.filters.text !== T1 || vm.filters.active !== false || vm.run.counts.filtered !== N || h.scheduler.pendingTimers() < 1) {
          return { ok: false, reason: 'cold draft T1 not staged' };
        }
        return { ok: true };
      }
      if (h === null) return { ok: false, reason: 'no harness (setup not OK)' };
      if (poisoned) return { ok: false, reason: POISONED_REASON };
      const f = preStateFailures();
      if (f.length > 0) return { ok: false, reason: `pre-state: ${f.join(',')}` };
      if (scenario === 'R-WARM' || scenario === 'R-GROUP-WARM') {
        const dl = deadlineOf(untimedBoundMs, hooks.beforeStep ?? null);
        await dl.run('draft-T2', () => h.dispatch({ type: INTENT.FILTER_TEXT, value: T2 }));   // draft only, outside the window
        const vm = vmOf(h);
        if (vm.filters.text !== T2 || vm.run.counts.filtered !== exp.wT1 || h.scheduler.pendingTimers() < 1) return { ok: false, reason: 'draft T2 not staged' };
        if (scenario === 'R-GROUP-WARM' && (!selectedOk(vm) || h.bridge.groupPresents.length !== p0)) return { ok: false, reason: 'G* selection lost while staging' };
      }
      return { ok: true };
    } catch (e) {
      return untimedFailure(e, 'prepareSample');
    }
  }

  function completion(vm) {
    if (scenario === 'R-BASE') {
      const f = [];
      if (vm.filters.sort !== S2) f.push('sort');
      if (vm.filters.busy !== false) f.push('busy');
      if (vm.results.state !== 'list') f.push('state');
      if (!sameList(identityList(vm), refs.S2)) f.push('firstPage(S2)');
      return f;
    }
    if (scenario === 'R-COLD') return pWarmFailures(vm, T1, exp.wT1, refs.T1);
    const f = pWarmFailures(vm, T2, exp.wT2, refs.T2);
    if (scenario === 'R-GROUP-WARM') {
      if (vm.selected?.kind !== 'group' || vm.selected?.groupId !== G_STAR_ID) f.push('selected.groupId');
      if (vm.selected?.clashCount !== S_STAR) f.push('selected.clashCount');
    }
    return f;
  }

  async function runSample({ timeoutMs = TIMED_TIMEOUT_MS } = {}) {
    if (!(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)) {
      throw new RangeError(`familyR.runSample: timeoutMs must be a positive finite number (got ${String(timeoutMs)})`);
    }
    if (h === null) return { status: 'INVALID', durationMs: null, notificationCount: null, yieldDelta: null, catalogListDelta: null, extra: { reason: 'no harness' } };
    if (poisoned) return { status: 'INVALID', durationMs: null, notificationCount: null, yieldDelta: null, catalogListDelta: null, extra: { reason: POISONED_REASON } };
    const sched = h.scheduler;
    const ctl = h.controller;
    const n0 = notifications;
    const y0 = sched.yieldCount;
    const v0 = ctl.getViewModel().version;
    const trigger = async () => {
      if (typeof hooks.beforeTrigger === 'function') await hooks.beforeTrigger();
      if (scenario === 'R-BASE') await ctl.dispatch({ type: INTENT.SORT_SET, value: S2 });
      else await sched.advance(FILTER_DEBOUNCE_MS);
    };
    if (scenario === 'R-COLD') transitionLog = [];
    // ── timed window: ONE wall-clock deadline bounds the trigger AND the predicate wait ──
    const t0 = performance.now();
    const tr = await raceDeadline(trigger(), timeoutMs);
    let outcome;
    if (tr.outcome === 'timeout') outcome = 'trigger-timeout';
    else if (tr.outcome === 'error') outcome = 'trigger-error';
    else outcome = await waitFor(sched, () => completion(ctl.getViewModel()).length === 0, { wallMs: timeoutMs - (performance.now() - t0), maxRounds });
    const vm = outcome === 'trigger-timeout' ? null : ctl.getViewModel();
    const t1 = performance.now();
    // ── end window ──
    const transitions = transitionLog;
    transitionLog = null;
    const durationMs = t1 - t0;
    const extra = { scenario, timeoutMs };
    if (vm !== null) extra.vmVersionDelta = vm.version - v0;
    if (scenario === 'R-COLD') { extra.transitions = transitions; extra.harnessId = h.calibrationHarnessId; }
    let status = 'OK';
    if (outcome === 'trigger-timeout' || outcome === 'timeout-stuck') {
      poisoned = true;                               // the hung operation may still mutate this harness
      status = 'TIMEOUT';
      extra.reason = outcome === 'trigger-timeout' ? 'trigger exceeded the wall-clock deadline' : 'predicate loop did not stop after the deadline';
      extra.poisoned = true;
    } else if (outcome === 'trigger-error') {
      status = 'INVALID'; extra.reason = `trigger threw: ${String(tr.error?.message ?? tr.error)}`;
    } else if (outcome === 'timeout' || durationMs >= timeoutMs) {
      status = 'TIMEOUT';
    } else if (outcome === 'rounds-exhausted') {
      status = 'INVALID'; extra.reason = 'until-rounds-exhausted';
    } else {
      const failures = completion(vm);
      if (scenario === 'R-GROUP-WARM') {
        extra.presentGroupDelta = h.bridge.groupPresents.length - p0;
        if (extra.presentGroupDelta !== 0) failures.push('presentGroup-called-in-window');
        if (vm.selected?.participants !== exp.gStarParticipants) failures.push('selected.participants');
      }
      if (failures.length > 0) { status = 'INVALID'; extra.reason = `validity: ${failures.join(',')}`; }
    }
    return { status, durationMs, notificationCount: notifications - n0, yieldDelta: sched.yieldCount - y0, catalogListDelta: null, extra };
  }

  async function resetSample() {
    try {
      if (scenario === 'R-COLD') {
        const d = await releaseMain();
        return d.ok ? { ok: true } : { ok: false, reason: `dispose failed: ${d.error}` };
      }
      if (h === null) return { ok: false, reason: 'no harness' };
      if (poisoned) return { ok: false, reason: POISONED_REASON };
      const dl = deadlineOf(untimedBoundMs, hooks.beforeStep ?? null);
      if (scenario === 'R-BASE') {
        await dl.run('reset-sort-s1', () => h.dispatch({ type: INTENT.SORT_SET, value: S1 }));
      } else {
        const w = await proveWarm(h, dl, T1, exp.wT1, refs.T1);
        if (w.outcome !== 'ok') return { ok: false, reason: `reset: P-WARM(T1) not re-proven (${w.outcome}; ${w.failures.join(',')})` };
      }
      const f = preStateFailures();
      return f.length === 0 ? { ok: true } : { ok: false, reason: `reset pre-state: ${f.join(',')}` };
    } catch (e) {
      return untimedFailure(e, 'resetSample');
    }
  }

  /** Best-effort bounded cleanup; a disposal failure is rethrown after cleanup (never swallowed). */
  async function teardown() {
    const d = await releaseMain();
    if (!d.ok) throw new Error(`familyR.teardown: dispose failed: ${d.error}`);
  }

  return {
    cellSpec, setup, prepareSample, runSample, resetSample, teardown,
    /** test-visible introspection of the calibration fixture (never controller internals) */
    _debug: { harness: () => h, harnessIds, references: () => refs, fixture: () => fixture, poisoned: () => poisoned },
  };
}
