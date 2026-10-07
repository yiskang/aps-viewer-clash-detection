// clashpanel/core/measurementBasis.js
// The Soft measurement-basis contract (owner decision 2026-10-07; spec 6.2 step 4 addendum). Core's `clearance` is one
// unit-less world-space number compared with raw distances, and the collision layer never converts between models. So:
//   verified        the host verdict was `verified` (or only one model participates): common basis evidenced.
//   user-supplied   the user attested that ALL participating models share one coordinate unit and entered the clearance
//                   in that same unit. The number reaches Core UNCHANGED (no conversion, no unit guessing); the unit is
//                   a label and an attestation, never evidence.
//   raw-model-units the user chose to enter the clearance directly in the Viewer's model units; no unit is implied.
//   unavailable     Soft is selected on an unverified basis and the user has not supplied one yet (Run stays disabled).
// `user-supplied` and `raw-model-units` are never reported as `verified`.
import { BASIS_RAW, BASIS_UNITS } from './constants.js';

export const BASIS_STATE = Object.freeze({
  VERIFIED: 'verified', USER_SUPPLIED: 'user-supplied', RAW: 'raw-model-units', UNAVAILABLE: 'unavailable',
});

export const isBasisChoice = (v) => v === '' || v === BASIS_RAW || BASIS_UNITS.includes(v);

/** `verifiedBasis`: the evaluated Soft availability says the host verified the basis (or one model participates). */
export function resolveBasis({ basisUnit, verifiedBasis }) {
  if (verifiedBasis === true) return Object.freeze({ state: BASIS_STATE.VERIFIED, unit: null });
  if (basisUnit === BASIS_RAW) return Object.freeze({ state: BASIS_STATE.RAW, unit: null });
  if (BASIS_UNITS.includes(basisUnit)) return Object.freeze({ state: BASIS_STATE.USER_SUPPLIED, unit: basisUnit });
  return Object.freeze({ state: BASIS_STATE.UNAVAILABLE, unit: null });
}

/** Run-details text for a basis recorded at run start. */
export function basisProvenanceText(basis, verdict) {
  switch (basis?.state) {
    case BASIS_STATE.USER_SUPPLIED:
      return `user-supplied, not verified — models declared to share the unit "${basis.unit}"; the clearance was entered in that unit and used unchanged`;
    case BASIS_STATE.RAW:
      return 'raw model units, not verified — the clearance is in Viewer model units; no physical unit is implied';
    case BASIS_STATE.VERIFIED:
      return verdict?.state === 'verified' ? `verified (${String(verdict.basisKey)})` : 'verified (single model: no cross-model comparison)';
    default:
      return 'unavailable';
  }
}
