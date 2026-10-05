// Finite schedule space for D2-OFFLINE (spec §7). Pure; no I/O, no randomness.
// Counts are DERIVED from the declared domains two independent ways (closed-form §7.2 arithmetic and
// explicit enumeration) and both are compared with the spec's accepted numbers; any mismatch is a
// conformance failure (C1-INVALID, exit 2) raised by the caller.
import { ORD_NAMES, RESTORE_VARIANTS, FAMILIES, MODES } from './contract.mjs';

const FAM_IDX = Object.fromEntries(FAMILIES.map((f, i) => [f, i]));
const MODE_IDX = Object.fromEntries(MODES.map((m, i) => [m, i]));

/** Valid (D, L) pairs: L = 0 always; L >= 1 requires D - L >= 2 (spec §7.1). */
export function validPairs(domains) {
  const pairs = [];
  for (const D of domains.D) for (const L of domains.L) if (L === 0 || D - L >= 2) pairs.push({ D, L });
  return pairs;
}

const branchOf = (L) => (L === 0 ? 'primary' : 'tail');
export const cellOf = (s) => `${s.mode}-${branchOf(s.L)}`;

/** Closed-form cardinalities (spec §7.2): derived from domains, independent of the enumerator. */
export function deriveCounts(domains) {
  const pairs = validPairs(domains);
  const nS = domains.S.length;
  const nORD = ORD_NAMES.length;
  const nG = domains.G.length;
  const free = nS * nORD * nG; // 36
  const nV = RESTORE_VARIANTS.length;
  const cells = { 'CL-primary': 0, 'CL-tail': 0, 'OP-primary': 0, 'OP-tail': 0 };
  const perFamilyMode = {};
  const add = (fam, mode, branch, n) => {
    cells[`${mode}-${branch}`] += n;
    const k = `${fam}-${mode}`;
    perFamilyMode[k] = (perFamilyMode[k] || 0) + n;
  };
  for (const { D, L } of pairs) {
    const br = branchOf(L);
    // sum over S of (D + S + 4) = tN / r domain size
    const sumSpan = domains.S.reduce((a, S) => a + (D + S + 4), 0);
    add('F0', 'CL', br, free);
    add('F1', 'CL', br, free * 2);
    add('F2', 'CL', br, free * 2 * 2 * nV);
    add('F1', 'OP', br, sumSpan * nORD * nG);
    add('F2', 'OP', br, sumSpan * nORD * nG * nV * 2);
  }
  const total = Object.values(cells).reduce((a, b) => a + b, 0);
  return { total, cells, perFamilyMode };
}

function base(family, mode, D, L, S, ordIdx, G) {
  return {
    family, mode, D, L, S, ordIdx, ord: ORD_NAMES[ordIdx], G,
    rvIdx: -1, rv: null, delta: -1, tN: -1, r: -1, rho: -1,
  };
}

/** Enumerate every schedule tuple, sort lexicographically per §7.3, assign ids S-nnnnn. */
export function enumerateSchedules(domains) {
  const out = [];
  for (const { D, L } of validPairs(domains)) {
    for (const S of domains.S) {
      const span = D + S + 4; // tN / r in [0, D+S+3]
      for (let ordIdx = 0; ordIdx < ORD_NAMES.length; ordIdx += 1) {
        for (const G of domains.G) {
          out.push(base('F0', 'CL', D, L, S, ordIdx, G));
          for (const delta of [0, 1]) {
            out.push({ ...base('F1', 'CL', D, L, S, ordIdx, G), delta });
            for (let v = 0; v < RESTORE_VARIANTS.length; v += 1) {
              for (const rho of [0, 1]) {
                out.push({ ...base('F2', 'CL', D, L, S, ordIdx, G), delta, rvIdx: v, rv: RESTORE_VARIANTS[v], rho });
              }
            }
          }
          for (let tN = 0; tN < span; tN += 1) out.push({ ...base('F1', 'OP', D, L, S, ordIdx, G), tN });
          for (let r = 0; r < span; r += 1) {
            for (let v = 0; v < RESTORE_VARIANTS.length; v += 1) {
              for (const rho of [0, 1]) {
                out.push({ ...base('F2', 'OP', D, L, S, ordIdx, G), r, rvIdx: v, rv: RESTORE_VARIANTS[v], rho });
              }
            }
          }
        }
      }
    }
  }
  const key = (s) => [FAM_IDX[s.family], MODE_IDX[s.mode], s.D, s.L, s.S, s.ordIdx, s.G, s.rvIdx, s.delta >= 0 ? s.delta : s.tN, s.r, s.rho];
  const keyed = out.map((s) => ({ s, k: key(s) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i += 1) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
    return 0;
  });
  const seen = new Set();
  const schedules = keyed.map(({ s, k }, rank) => {
    const sig = k.join(',');
    if (seen.has(sig)) throw new Error(`duplicate schedule tuple ${sig}`);
    seen.add(sig);
    return { ...s, id: `S-${String(rank).padStart(5, '0')}`, cell: cellOf(s) };
  });
  return schedules;
}

/** 36 D=30 characterization witnesses (spec §7.5): F0, F1(δ=0), F2(OK-SAME, δ=0, ρ=0) × 6 ORD × G∈{0,1}. */
export function characterizationSchedules(fixtures) {
  const { D, L, S } = fixtures.characterization;
  const out = [];
  for (const family of FAMILIES) {
    for (let ordIdx = 0; ordIdx < ORD_NAMES.length; ordIdx += 1) {
      for (const G of fixtures.domains.G) {
        const s = base(family, 'CL', D, L, S, ordIdx, G);
        if (family === 'F1') s.delta = 0;
        if (family === 'F2') Object.assign(s, { delta: 0, rho: 0, rvIdx: 0, rv: 'OK-SAME' });
        out.push({ ...s, id: `CW-${family}-${ORD_NAMES[ordIdx]}-${G}`, cell: 'characterization', characterization: true });
      }
    }
  }
  return out;
}
