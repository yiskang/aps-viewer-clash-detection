// Input hashing (spec §15) with fail-closed semantics (spec §12.1: C1-INVALID => exit 2).
import { readFileSync } from 'node:fs';
import { sha256Hex } from './canonical.mjs';

/**
 * Pinned expected digests (spec, harness, R1, fixtures). The spec and fixtures pins were ratified by the independent
 * Work review. A null expected value in validateInputs() means "record observed only"; runSimulation() requires all four.
 */
export const EXPECTED_INPUT_HASHES = Object.freeze({
  spec: '635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574',
  harness: 'cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b',
  r1: '4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148',
  fixtures: '6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0', // ratified by the independent Work review
});

const NAMES = ['spec', 'harness', 'r1', 'fixtures'];

/**
 * Reads `path` exactly once through `reader` into one owned byte snapshot and hashes those same bytes.
 * Returns { bytes, digest } or { bytes: null, digest: null } when unreadable. Never throws, never reopens the path.
 */
export function readSnapshot(path, reader = readFileSync) {
  try {
    const bytes = Buffer.from(reader(path)); // owned copy: later mutation of the backing file/buffer cannot change it
    return { bytes, digest: sha256Hex(bytes) };
  } catch {
    return { bytes: null, digest: null };
  }
}

/**
 * Reads one input once, then checks its digest against `expected` (null => record only). `bytes` is returned only when
 * the digest matches (or expected is null and the file was readable); unvalidated bytes are never handed back.
 */
export function readValidatedSnapshot(path, expected = null, reader = readFileSync) {
  const { bytes, digest } = readSnapshot(path, reader);
  const ok = bytes !== null && (expected === null || digest === expected);
  return { ok, bytes: ok ? bytes : null, digest };
}

/**
 * Reads each file once, hashes the owned bytes, and returns those validated bytes in `snapshots` (name => Buffer; present
 * only for inputs that validated). `records` carries digests only. Never throws. null expected => no check. Unreadable => mismatch.
 */
export function validateInputs({ paths, expected, reader = readFileSync }) {
  const records = {};
  const snapshots = {};
  const mismatches = [];
  for (const n of NAMES) {
    const exp = expected && expected[n] !== undefined ? expected[n] : null;
    const p = paths ? paths[n] : undefined;
    const snap = typeof p === 'string' ? readValidatedSnapshot(p, exp, reader) : { ok: false, bytes: null, digest: null };
    records[n] = { expected: exp, observed: snap.digest };
    if (snap.ok) snapshots[n] = snap.bytes;
    else mismatches.push(n);
  }
  return { ok: mismatches.length === 0, records, mismatches, snapshots };
}

/** Throws Error{exitCode:2, code:'C1-INVALID', result} on any mismatch; otherwise returns the result. */
export function assertInputs(args) {
  const result = validateInputs(args);
  if (!result.ok) {
    const e = new Error(`C1-INVALID: input hash mismatch/unreadable: ${result.mismatches.join(', ')}`);
    e.exitCode = 2;
    e.code = 'C1-INVALID';
    e.result = result;
    throw e;
  }
  return result;
}
