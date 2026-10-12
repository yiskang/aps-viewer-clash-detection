// CTM8-P0-v4 §4.2 / §7.5: mandatory cell enumeration, seeded shuffle, and the
// campaign arithmetic. Non-production calibration support only.
// Arithmetic is computed from constants so the spec numbers are verified, not asserted.

export const PROTOCOL = 'CTM8-P0-v4';

export const SCENARIOS = Object.freeze([
  { family: 'M', scenario: 'M-BASE', kind: 'warm' },
  { family: 'M', scenario: 'M-REC', kind: 'warm' },
  { family: 'M', scenario: 'M-HIT', kind: 'warm' },
  { family: 'R', scenario: 'R-BASE', kind: 'warm' },
  { family: 'R', scenario: 'R-WARM', kind: 'warm' },
  { family: 'R', scenario: 'R-GROUP-WARM', kind: 'warm' },
  { family: 'R', scenario: 'R-COLD', kind: 'cold' },
]);

export const SCALES = Object.freeze([100, 1000, 5000, 10000]);
export const MODELS = Object.freeze([1, 2, 3]);
export const LAUNCHES = 3;
export const REPS = Object.freeze({ warmup: 5, warmMeasured: 30, coldMeasured: 15 });
export const SEED_BASE = 20261011;

// Documented exclusions only (§4.3); never enumerated and never counted.
export const OPTIONAL_NOT_MANDATORY = Object.freeze([
  'SKEWED fixture profile',
  'R-FLAT',
  'R-GROUP',
  'R-GROUP-MEMBERSHIP',
  'PULL variants (pull-only, no subscriber)',
  'Family-M catalog larger than referenced models',
  'M-REC-MGRONLY (UNAVAILABLE)',
]);

export function enumerateCells() {
  const cells = [];
  for (const s of SCENARIOS) {
    for (const scale of SCALES) {
      for (const nModels of MODELS) {
        cells.push({
          family: s.family,
          scenario: s.scenario,
          scale,
          nModels,
          kind: s.kind,
          profile: s.family === 'R' ? 'UNIFORM' : null,
          cellId: `${s.scenario}/${scale}/${nModels}`,
        });
      }
    }
  }
  return cells;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleCells(cells, launchIndex) {
  const seed = SEED_BASE + launchIndex;
  const rng = mulberry32(seed);
  const order = cells.slice(); // never mutate the caller's array
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { order, seed, algorithm: 'Fisher-Yates/mulberry32' };
}

export function arithmetic() {
  const cells = enumerateCells();
  const count = (pred) => cells.filter(pred).length;
  const cellsPerLaunch = cells.length;
  const familyM = count((c) => c.family === 'M');
  const familyR = count((c) => c.family === 'R');
  const warmCells = count((c) => c.kind === 'warm');
  const coldCells = count((c) => c.kind === 'cold');
  const warmMeasured = warmCells * REPS.warmMeasured * LAUNCHES;
  const coldMeasured = coldCells * REPS.coldMeasured * LAUNCHES;
  const measured = warmMeasured + coldMeasured;
  const warmups = warmCells * REPS.warmup * LAUNCHES;
  return {
    cellsPerLaunch,
    familyM,
    familyR,
    warmCells,
    coldCells,
    launches: LAUNCHES,
    cellExecutions: cellsPerLaunch * LAUNCHES,
    measured,
    warmMeasured,
    coldMeasured,
    warmups,
    totalOps: measured + warmups,
  };
}
