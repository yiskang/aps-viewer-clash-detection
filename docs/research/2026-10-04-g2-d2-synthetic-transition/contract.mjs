// Shared contract for the D2-OFFLINE synthetic simulator (research tooling only).
// Everything here is [SYN] unless the spec says otherwise (spec §5.4, §9). No randomness, no I/O at import.
import { readFileSync } from 'node:fs';

export const PHI_LEN = 32;

/** Normative sample map (spec §5.4): Φ(p)[j] = p[j mod 4] · (1 + j/32) + j, multiplication then addition. */
export function phi(p) {
  const out = new Array(PHI_LEN);
  for (let j = 0; j < PHI_LEN; j += 1) out[j] = p[j % 4] * (1 + j / 32) + j;
  return out;
}

/** T4 equality (spec §5.4): ∀j |a[j] − b[j]| ≤ tol, same strict form as the harness (`!(abs <= tol)` ⇒ false). */
export function cameraSamplesWithin(a, b, tol = 1e-9) {
  if (!a || !b || a.length !== PHI_LEN || b.length !== PHI_LEN) return false;
  for (let i = 0; i < PHI_LEN; i += 1) if (!(Math.abs(a[i] - b[i]) <= tol)) return false;
  return true;
}

/** Parse fixtures.json from a path or already-read text (injectable for hash-failure tests). */
export function parseFixtures(text) {
  return JSON.parse(text);
}
/** TEST-ONLY convenience: reopens the path. Production code (runSimulation) must consume the validated owned snapshot instead. */
export function loadFixtures(path) {
  return parseFixtures(readFileSync(path, 'utf8'));
}

export const ORD_NAMES = ['HAT', 'HTA', 'AHT', 'ATH', 'THA', 'TAH'];
export const RESTORE_VARIANTS = ['OK-SAME', 'OK-NEXT', 'NOOP', 'THROW'];
export const FAMILIES = ['F0', 'F1', 'F2'];
export const MODES = ['CL', 'OP'];
