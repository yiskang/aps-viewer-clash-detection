// test/performance/m4/r6-calibration.mjs
//
// M4 Task 3.5: pure sub-logic for §5.2.1's R6 sequence -- transform comparison and the one-time
// calibration magnitude/pair-set-diff decisions. The live move->invalidate->refresh->restore
// sequence itself (setPlacementTransform, invalidateModelPlacement, the try/finally restoration,
// and the tlasBuilds arm-specific assertion) lives in run-gate-m4.mjs, this task's live half --
// it requires a real CollisionWorld/Viewer and cannot be unit-tested here.

// §5.2.1: two placement matrices are equal when every one of their 16 elements agrees within an
// absolute 1e-9 -- used both for the "restored transform verified equal to T0" gate and for the
// render-stabilisation confirmation.
export function matricesEqual(a, b, eps = 1e-9) {
  if (a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

// §5.2.1's frozen calibration sequence, world units.
export const R6_CALIBRATION_SEQUENCE = [0.02, 0.04, 0.06, 0.10, 0.20];

// The smallest step at which the R3 pair set FIRST changes -- take the FIRST true, never search
// for a "best" or largest change. null (NOT EXERCISED) if none of the sequence changes anything.
export function selectCalibrationMagnitude(changedFlags) {
  const idx = changedFlags.findIndex(Boolean);
  return idx === -1 ? null : R6_CALIBRATION_SEQUENCE[idx];
}

// Order-insensitive pair-set-signature comparison -- used for both the calibration pass's own
// "did the pair set change" probe and the measured P0/P1 comparison.
export function pairSetsDiffer(pairSignaturesA, pairSignaturesB) {
  const a = [...pairSignaturesA].sort();
  const b = [...pairSignaturesB].sort();
  return JSON.stringify(a) !== JSON.stringify(b);
}
