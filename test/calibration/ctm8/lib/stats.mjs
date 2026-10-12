// CTM8-P0-v4 §11: fixed statistics. Nearest-rank p95, per-launch authoritative,
// pooled secondary (labelled POOLED). No thresholds or pass/fail are derived.
// Only status 'OK' samples count; everything else is tallied but excluded.

export function nearestRank(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) return 'n/a';
  const rank = Math.max(1, Math.ceil(q * n));
  return sortedAsc[rank - 1];
}

export function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 'n/a';
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function tally(samples) {
  const valid = [];
  let n_timeout = 0;
  let n_invalid = 0;
  for (const s of samples) {
    if (s.status === 'OK') valid.push(s.durationMs);
    else if (s.status === 'TIMEOUT') n_timeout++;
    else n_invalid++; // INVALID and INVALID_SETUP
  }
  valid.sort((a, b) => a - b);
  return { valid, n_timeout, n_invalid };
}

function base(samples) {
  const { valid, n_timeout, n_invalid } = tally(samples);
  const n = valid.length;
  return {
    valid,
    out: {
      n_valid: n,
      n_timeout,
      n_invalid,
      min: n ? valid[0] : 'n/a',
      median: n ? median(valid) : 'n/a',
      max: n ? valid[n - 1] : 'n/a',
    },
  };
}

export function summarizeLaunchCell(samples, { kind }) {
  const { valid, out } = base(samples);
  // Cold per-launch n=15 is too small for a tail estimate: always n/a.
  out.p95 = kind === 'warm' && valid.length >= 20 ? nearestRank(valid, 0.95) : 'n/a';
  return out;
}

export function headlineMedianOfMedians(perLaunch) {
  const meds = perLaunch.map((s) => s.median).filter((m) => typeof m === 'number');
  return meds.length ? median(meds) : 'n/a';
}

export function pooledSummary(samples) {
  const { valid, out } = base(samples);
  out.p95 = valid.length >= 30 ? nearestRank(valid, 0.95) : 'n/a';
  return { label: 'POOLED', ...out };
}

export function pairedDelta(groupWarmPerLaunch, warmPerLaunch) {
  // Three per-launch differences of medians, never one pooled subtraction.
  const perLaunch = groupWarmPerLaunch.map((g, i) => {
    const a = g.median;
    const b = warmPerLaunch[i].median;
    return typeof a === 'number' && typeof b === 'number' ? a - b : 'n/a';
  });
  const nums = perLaunch.filter((d) => typeof d === 'number');
  return { perLaunch, headline: nums.length ? median(nums) : 'n/a' };
}
