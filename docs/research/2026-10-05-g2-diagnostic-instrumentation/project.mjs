// Atoms, named configurations, projection, sample classing and the transitivity gate (spec §8.3–§8.5).
// [SYN] research tooling only. A projection is a lossy view of one ground-truth trace (observer.mjs).

/** Searchable atoms in canonical order, index 0..8 (spec §8.3). */
export const SEARCH_ATOMS = ['P-FRM', 'P-XS', 'P-TICK', 'P-CC', 'P-CC0', 'P-TC', 'V-PEND', 'V-ACT', 'V-EDGE'];
export const ATOM_INDEX = Object.fromEntries(SEARCH_ATOMS.map((a, i) => [a, i]));
export const BASE_ATOMS = ['H-CALL', 'H-T4'];
export const ORACLE_ATOMS = ['X-OWN', 'X-TAG'];
export const INF_ATOMS = ['P-CC0'];

/** Atom metadata for the summary, in canonical order (base, searchable, oracle). */
export const ATOMS = [
  { id: 'H-CALL', class: 'HAR', observables: ['O-1', 'O-2', 'O-13', 'O-24'], vbDeps: [], inf: false, base: true },
  { id: 'H-T4', class: 'HAR', observables: ['O-21', 'O-22', 'O-24', 'O-26'], vbDeps: [], inf: false, base: true },
  { id: 'P-FRM', class: 'PUB', observables: ['O-21', 'O-22'], vbDeps: [], inf: false, base: false },
  { id: 'P-XS', class: 'PUB', observables: ['O-22'], vbDeps: [], inf: false, base: false },
  { id: 'P-TICK', class: 'PUB', observables: ['O-18'], vbDeps: [], inf: false, base: false },
  { id: 'P-CC', class: 'PUB†', observables: ['O-15'], vbDeps: ['VB-9'], inf: false, base: false },
  { id: 'P-CC0', class: 'PUB†', observables: ['O-15'], vbDeps: ['VB-9'], inf: true, base: false },
  { id: 'P-TC', class: 'PUB', observables: ['O-16'], vbDeps: [], inf: false, base: false },
  { id: 'V-PEND', class: 'VB7124', observables: ['O-5'], vbDeps: ['VB-0', 'VB-1'], inf: false, base: false },
  { id: 'V-ACT', class: 'VB7124', observables: ['O-7'], vbDeps: ['VB-0', 'VB-2'], inf: false, base: false },
  { id: 'V-EDGE', class: 'VB7124', observables: ['O-8'], vbDeps: ['VB-0', 'VB-3'], inf: false, base: false },
  { id: 'X-OWN', class: 'SYN', observables: ['O-12', 'O-27'], vbDeps: [], inf: false, base: false },
  { id: 'X-TAG', class: 'SYN', observables: ['O-27'], vbDeps: [], inf: false, base: false },
];

const PUB = ['P-FRM', 'P-XS', 'P-TICK', 'P-CC', 'P-TC'];
const VB = [...PUB, 'V-PEND', 'V-ACT', 'V-EDGE'];
/** Named configurations (spec §8.3), canonical order. */
export const NAMED_CONFIGS = [
  { id: 'T-PUB/OFF', atoms: PUB, idAxis: 'OFF' },
  { id: 'T-PUB/ON', atoms: PUB, idAxis: 'ON' },
  { id: 'T-PUB+CC0/OFF', atoms: [...PUB, 'P-CC0'], idAxis: 'OFF' },
  { id: 'T-PUB+CC0/ON', atoms: [...PUB, 'P-CC0'], idAxis: 'ON' },
  { id: 'T-VB/OFF', atoms: VB, idAxis: 'OFF' },
  { id: 'T-VB/ON', atoms: VB, idAxis: 'ON' },
  { id: 'T-VB+OWN/ON', atoms: [...VB, 'X-OWN'], idAxis: 'ON' },
  { id: 'T-VB+TAG/ON', atoms: [...VB, 'X-TAG'], idAxis: 'ON' },
  { id: 'T-ORACLE/ON', atoms: [...VB, 'X-OWN', 'X-TAG'], idAxis: 'ON' },
].map((c) => ({ ...c, atoms: sortAtoms(c.atoms) }));

export function sortAtoms(atoms) {
  const order = [...BASE_ATOMS, ...SEARCH_ATOMS, ...ORACLE_ATOMS];
  return [...atoms].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
export const maskOf = (atoms) => atoms.reduce((m, a) => (a in ATOM_INDEX ? m | (1 << ATOM_INDEX[a]) : m), 0);
export const atomsOfMask = (mask) => SEARCH_ATOMS.filter((_, i) => mask & (1 << i));
export const isOracleFree = (atoms) => !atoms.some((a) => ORACLE_ATOMS.includes(a));

/** Kind -> gating atom (null = base). XTC is gated by the oracle atom X-TAG. */
export const KIND_GATE = { FIT: null, RST: null, SST: null, SMP: null, CAM: 'P-FRM', TCK: 'P-TICK', CC: 'P-CC', CC0: 'P-CC0', TC: 'P-TC', AE: 'V-EDGE', XTC: 'X-TAG' };
const READ_KINDS = new Set(['FIT', 'RST', 'SMP', 'CAM']);
export const hasRead = (e) => READ_KINDS.has(e.k) && e.cam !== undefined;

/** Bitwise identity key of a 32-entry camera value (exact class). */
export function exactKey(cam) {
  const f = new Float64Array(cam);
  return Buffer.from(f.buffer).toString('base64');
}

/**
 * Transitivity gate (spec §8.5): over ALL camera values of the ground-truth trace, the 1e-9 relation must be an
 * equivalence relation. Returns true/false. Reflexive and symmetric by construction of cameraSamplesWithin.
 */
export function transitivityHolds(events, within) {
  const seen = new Map();
  for (const e of events) if (hasRead(e)) { const k = exactKey(e.cam); if (!seen.has(k)) seen.set(k, e.cam); }
  const vals = [...seen.values()];
  const n = vals.length;
  const rel = [];
  for (let i = 0; i < n; i += 1) { rel.push([]); for (let j = 0; j < n; j += 1) rel[i].push(within(vals[i], vals[j], 1e-9)); }
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) if (rel[i][j]) for (let k = 0; k < n; k += 1) if (rel[j][k] && !rel[i][k]) return false;
  return true;
}

/**
 * R2 slot binding (spec §6.2) over the ground-truth slot handles: a FIT whose post-call handle is non-null and differs
 * from its pre-call handle binds that handle to the FIT's token. A same-object post-call read never rebinds.
 * Returns Map(handle -> token). Handles never bound read as "U".
 */
export function bindSlots(events) {
  const binding = new Map();
  for (const e of events) {
    if (e.k === 'FIT' && e.post && e.pre && e.post.h !== 0 && e.post.h !== e.pre.h && !binding.has(e.post.h)) binding.set(e.post.h, e.r);
  }
  return binding;
}

/**
 * Projection (spec §8.3/§8.4): keeps events/fields whose atom is in base ∪ atoms, applies the identity axis,
 * recomputes cl/xc and pd.ch over the visible reads only. `within` is D2 cameraSamplesWithin. Returns event objects.
 */
export function project(events, atoms, idAxis, within) {
  const A = new Set(atoms);
  const on = idAxis === 'ON';
  const frm = A.has('P-FRM'); const xs = A.has('P-XS'); const pend = A.has('V-PEND'); const act = A.has('V-ACT'); const own = A.has('X-OWN');
  const binding = new Map(); // built incrementally in trace order (R2): a read before its binding FIT shows "U"
  const clReps = []; // first member of each tolerance class
  const xcKeys = new Map(); // exact key -> index (lookup only; output order comes from first appearance)
  let prevH = 0; // previous visible slot read (0 = null slot)
  const out = [];
  const cls = (cam) => {
    let c = clReps.findIndex((r) => within(r, cam, 1e-9));
    if (c < 0) { clReps.push(cam); c = clReps.length - 1; }
    return c;
  };
  const xcl = (cam) => {
    const k = exactKey(cam);
    if (!xcKeys.has(k)) xcKeys.set(k, xcKeys.size);
    return xcKeys.get(k);
  };
  const slot = (h) => {
    if (on) { const o = { p: h ? 1 : 0 }; if (h) o.b = binding.has(h) ? binding.get(h) : 'U'; return o; }
    const o = { p: h ? 1 : 0, ch: h !== prevH ? 1 : 0 };
    return o;
  };
  const addReads = (o, e, camVisible) => {
    if (camVisible) { o.cl = cls(e.cam); if (xs) o.xc = xcl(e.cam); }
    if (pend) { o.pd = slot(e.post.h); prevH = e.post.h; }
    if (act) o.ac = e.ac;
    if (own) o.ow = e.ow;
  };
  for (const e of events) {
    const gate = KIND_GATE[e.k];
    if (gate !== null && !A.has(gate)) continue;
    const o = { f: e.f, k: e.k };
    switch (e.k) {
      case 'FIT':
        if (on) o.r = e.r;
        if (pend) { o.pq = slot(e.pre.h); prevH = e.pre.h; }
        if (e.post.h !== 0 && e.post.h !== e.pre.h && !binding.has(e.post.h)) binding.set(e.post.h, e.r);
        addReads(o, e, frm);
        if (pend) o.pd.nw = e.post.h !== 0 && e.post.h !== e.pre.h ? 1 : 0;
        break;
      case 'RST':
        o.rs = e.rs;
        if (e.rs !== 'THROW') addReads(o, e, frm);
        break;
      case 'SST':
        o.s = e.s; if (on) o.r = e.r;
        break;
      case 'SMP':
        o.s = e.s; o.n = e.n; o.d = e.d; if (e.fr) o.fr = 1;
        addReads(o, e, true);
        break;
      case 'CAM':
        addReads(o, e, true);
        break;
      case 'AE': o.ev = e.ev; break;
      case 'XTC': o.tg = e.tg; break;
      default: break;
    }
    out.push(o);
  }
  return out;
}

/** The full (all atoms + oracle) projection used for the ground-truth caps, per identity axis. */
export const FULL_ATOMS = [...SEARCH_ATOMS, ...ORACLE_ATOMS];
