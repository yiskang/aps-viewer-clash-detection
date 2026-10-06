// Partitions, exhaustive 512-subset search, minimal sets and necessity (spec §8.1, §8.5–§8.7).
// [SYN] research tooling only.
//
// Exactness. Two projected traces are "the same" iff their canonical JSON bytes are equal. The canonical array is the
// comma-join of the canonical strings of its events, so byte equality <=> equality of the sequence of per-event
// canonical strings. Each per-event canonical string is interned to an integer (an injective map), so byte equality
// <=> equality of integer sequences. Blocks are found with a 53-bit hash of the integer sequence and every hash hit is
// confirmed by an exact element-wise comparison with the block representative (hash collisions are chained, never
// merged). The fast path is therefore exact, not merely fail-safe. Every per-event string is produced by project.mjs
// and D2 canonicalStringify; nothing is serialized by a second, hand-written encoder.
import { project, SEARCH_ATOMS, ATOM_INDEX, KIND_GATE, atomsOfMask } from './project.mjs';

export const N_SUBSETS = 512;
const MODE_ATOMS = ['P-FRM', 'P-XS', 'V-PEND', 'V-ACT']; // atoms that change event content (not just presence)
const PRESENCE_ALL = ['P-TICK', 'P-CC', 'P-CC0', 'P-TC', 'V-EDGE'];
export const modeOfMask = (m) => (m & 1) | (((m >> 1) & 1) << 1) | (((m >> 6) & 1) << 2) | (((m >> 7) & 1) << 3);
const modeAtoms = (mode) => MODE_ATOMS.filter((_, i) => mode & (1 << i));

/** Interning table (one per identity axis). */
export class Interner {
  constructor() { this.map = new Map(); }
  id(s) { let v = this.map.get(s); if (v === undefined) { v = this.map.size; this.map.set(s, v); } return v; }
}

/**
 * Per-schedule fast data: gate[i] (-1 base, atom index, -2 oracle-only) and ids[mode*n + i] per identity axis.
 * Events not present under a mode (CAM without P-FRM) get id -1 (never read, because CAM is gated by P-FRM).
 */
export function buildFastData(events, within, canonicalStringify, interners) {
  const n = events.length;
  const gate = new Int8Array(n);
  for (let i = 0; i < n; i += 1) {
    const g = KIND_GATE[events[i].k];
    gate[i] = g === null ? -1 : (g in ATOM_INDEX ? ATOM_INDEX[g] : -2);
  }
  const ids = {};
  for (const axis of ['OFF', 'ON']) {
    const arr = new Int32Array(16 * n).fill(-1);
    for (let mode = 0; mode < 16; mode += 1) {
      const proj = project(events, [...modeAtoms(mode), ...PRESENCE_ALL], axis, within);
      let j = 0;
      for (let i = 0; i < n; i += 1) {
        if (gate[i] === -2) continue;
        if (events[i].k === 'CAM' && !(mode & 1)) continue;
        const pe = proj[j]; j += 1;
        if (pe.k !== events[i].k || pe.f !== events[i].f) throw new Error('fast-data alignment failure');
        arr[mode * n + i] = interners[axis].id(canonicalStringify(pe));
      }
      if (j !== proj.length) throw new Error('fast-data alignment length failure');
    }
    ids[axis] = arr;
  }
  return { n, gate, ids };
}

/**
 * Evaluates all 512 subsets for one (cell, axis).
 * `data[]` fast data per relevant schedule (cell order = ascending schedule id); `labels[q][s]` label indices.
 * Returns { blocks: Int32Array(512), amb: Int32Array(512*nQ), ambBlocks: Int32Array(512*nQ), blockOf: {mask: Int32Array} }
 * blockOf is recorded only for masks listed in `keepMasks`.
 */
export function evaluateSubsets(data, labels, axis, keepMasks = []) {
  const nS = data.length;
  const nQ = labels.length;
  const blocksOut = new Int32Array(N_SUBSETS);
  const amb = new Int32Array(N_SUBSETS * nQ);
  const ambBlocks = new Int32Array(N_SUBSETS * nQ);
  const blockOf = {};
  let maxLen = 0;
  for (const d of data) if (d.n > maxLen) maxLen = d.n;
  const scratch = new Int32Array(maxLen);
  const blk = new Int32Array(nS);
  for (let mask = 0; mask < N_SUBSETS; mask += 1) {
    const mode = modeOfMask(mask);
    const table = new Map(); // hash -> first block index
    const chainNext = [];
    const repStart = []; const repLen = [];
    let repBuf = new Int32Array(1 << 16); let repUsed = 0;
    let nb = 0;
    for (let s = 0; s < nS; s += 1) {
      const d = data[s];
      const ids = d.ids[axis];
      const base = mode * d.n;
      let len = 0; let h1 = 0x811c9dc5 | 0; let h2 = 0x2545f491 | 0;
      for (let i = 0; i < d.n; i += 1) {
        const g = d.gate[i];
        if (g === -2) continue;
        if (g >= 0 && !((mask >> g) & 1)) continue;
        const v = ids[base + i];
        scratch[len] = v; len += 1;
        h1 = Math.imul(h1 ^ v, 0x01000193);
        h2 = Math.imul(h2 + v + 0x9e3779b9 | 0, 0x85ebca6b) ^ (h2 >>> 13);
      }
      h1 = Math.imul(h1 ^ len, 0x01000193);
      const key = (h1 >>> 0) * 2097152 + ((h2 >>> 0) >>> 11);
      let b = table.has(key) ? table.get(key) : -1;
      let found = -1; let last = -1;
      while (b !== -1) {
        if (repLen[b] === len) {
          let eq = true; const st = repStart[b];
          for (let i = 0; i < len; i += 1) if (repBuf[st + i] !== scratch[i]) { eq = false; break; }
          if (eq) { found = b; break; }
        }
        last = b; b = chainNext[b];
      }
      if (found === -1) {
        found = nb; nb += 1;
        if (repUsed + len > repBuf.length) { const nbuf = new Int32Array(Math.max(repBuf.length * 2, repUsed + len)); nbuf.set(repBuf.subarray(0, repUsed)); repBuf = nbuf; }
        repBuf.set(scratch.subarray(0, len), repUsed);
        repStart.push(repUsed); repLen.push(len); repUsed += len;
        chainNext.push(-1);
        if (last === -1) table.set(key, found); else chainNext[last] = found;
      }
      blk[s] = found;
    }
    blocksOut[mask] = nb;
    const size = new Int32Array(nb);
    for (let s = 0; s < nS; s += 1) size[blk[s]] += 1;
    for (let q = 0; q < nQ; q += 1) {
      const lab = labels[q];
      const first = new Int32Array(nb).fill(-1);
      const mixed = new Uint8Array(nb);
      for (let s = 0; s < nS; s += 1) {
        const bb = blk[s];
        if (first[bb] === -1) first[bb] = lab[s]; else if (first[bb] !== lab[s]) mixed[bb] = 1;
      }
      let a = 0; let ab = 0;
      for (let bb = 0; bb < nb; bb += 1) if (mixed[bb]) { ab += 1; a += size[bb]; }
      amb[mask * nQ + q] = a; ambBlocks[mask * nQ + q] = ab;
    }
    if (keepMasks.includes(mask)) blockOf[mask] = Int32Array.from(blk);
  }
  return { blocks: blocksOut, amb, ambBlocks, blockOf };
}

const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
const V_MASK = (1 << ATOM_INDEX['V-PEND']) | (1 << ATOM_INDEX['V-ACT']) | (1 << ATOM_INDEX['V-EDGE']);
const INF_MASK = 1 << ATOM_INDEX['P-CC0'];
const idxList = (m) => SEARCH_ATOMS.map((_, i) => i).filter((i) => m & (1 << i));

/** Deterministic order (spec §8.6 step 4): fewest atoms, fewest V-* atoms, lexicographically smallest index array. */
export function compareMasks(a, b) {
  const pa = popcount(a); const pb = popcount(b);
  if (pa !== pb) return pa - pb;
  const va = popcount(a & V_MASK); const vb = popcount(b & V_MASK);
  if (va !== vb) return va - vb;
  const ia = idxList(a); const ib = idxList(b);
  for (let i = 0; i < ia.length; i += 1) if (ia[i] !== ib[i]) return ia[i] - ib[i];
  return 0;
}

/**
 * Minimal-set extraction against the full 512-entry sufficiency table (no pruning, no monotonicity assumption).
 * `suff` is a boolean array indexed by mask. Returns { status, minimal: [mask], recommended, recommendedIncludingInf,
 * subsetsEvaluated, monotonicityViolations }.
 */
export function extractMinimal(suff) {
  if (suff.length !== N_SUBSETS) throw new Error('sufficiency table must have 512 entries');
  const minimal = [];
  for (let m = 0; m < N_SUBSETS; m += 1) {
    if (!suff[m]) continue;
    let isMin = true;
    for (let sub = (m - 1) & m; ; sub = (sub - 1) & m) { // every proper subset, checked directly
      if (sub !== m && suff[sub]) { isMin = false; break; }
      if (sub === 0) break;
    }
    if (isMin) minimal.push(m);
  }
  minimal.sort(compareMasks);
  let viol = 0;
  for (let sup = 0; sup < N_SUBSETS; sup += 1) {
    if (suff[sup]) continue;
    for (let sub = (sup - 1) & sup; ; sub = (sub - 1) & sup) {
      if (sub !== sup && suff[sub]) viol += 1;
      if (sub === 0) break;
    }
  }
  const anySufficient = minimal.length > 0;
  const rec = minimal.find((m) => !(m & INF_MASK));
  return {
    status: anySufficient ? 'SUFFICIENT_SETS_FOUND' : 'INSUFFICIENT_BELOW_ORACLE',
    fullSetSufficient: !!suff[N_SUBSETS - 1],
    minimal,
    recommended: rec === undefined ? null : rec,
    recommendedIncludingInf: anySufficient ? minimal[0] : null,
    subsetsEvaluated: N_SUBSETS,
    monotonicityViolations: viol,
  };
}

/** Necessity rule for an atom group under ID-ON minimal sets (spec §8.7). */
export function groupNecessity(minimalOn, groupMask) {
  if (!minimalOn.length) return 'INSUFFICIENT_BELOW_ORACLE';
  return minimalOn.every((m) => m & groupMask) ? 'NECESSARY' : 'NOT_NECESSARY_IN_D2';
}

export function requestIdentityNecessity(minimalOff, minimalOn) {
  if (minimalOff.length) return 'NOT_DEMONSTRATED_IN_D2';
  if (minimalOn.length) return 'NECESSARY';
  return 'INSUFFICIENT_BELOW_ORACLE';
}

export function oracleBundleNecessity(minimalOn, bundleSufficient) {
  if (minimalOn.length) return 'NOT_NECESSARY_IN_D2';
  return bundleSufficient ? 'RESOLVED_BY_NAMED_BUNDLE' : 'NOT_RESOLVED_BY_NAMED_BUNDLE';
}

export { atomsOfMask };
