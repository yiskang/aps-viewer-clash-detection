// clashpanel/core/constants.js
// Presentation constants (spec 12.4, PD-14): provisional and uncalibrated. They are internal tuning values, not
// options, and are never re-exported from core/index.js (asserted by Task 19). No wall-clock assertion may depend on
// any of them.
export const PAGE_SIZE = 50;                     // rows per results page
export const FILTER_DEBOUNCE_MS = 150;           // text-filter debounce
export const LIST_CHUNK_SIZE = 2000;             // records per slice of a filter/list pass before yielding
export const LABEL_CACHE_MAX = 5000;             // bounded LRU of element display labels
export const READINESS_POLL_MS = 1000;           // poll while the panel is visible and a participating model is not ready
export const DERIVATION_BUSY_RETRY_MS = 50;      // backoff after a DerivationBusyError
export const DERIVATION_BUSY_MAX_RETRIES = 5;    // retries (after the first attempt) before the job reports an error
export const BASIS_VERDICT_TIMEOUT_MS = 2000;    // wait for the host's measurement-basis verdict before failing closed
export const GAP_UNIT_LABEL = 'scene units';     // display label for Soft gaps until a common unit is verified (OD-13)
export const GAP_DECIMALS = 3;                   // fixed decimals for a displayed gap

// PD-17 / spec 6.2 step 4: the fixed sentence shown whenever Soft is unavailable.
export const SOFT_UNAVAILABLE_TEXT = "Soft (clearance) isn't available for these models: they don't share a verified common measurement basis.";

// Owner decision 2026-10-07 (Test Setup UX cleanup): an unverified measurement basis no longer disables Soft.
// The user may attest a unit for the participating models, or choose raw model units. Neither is ever `verified`.
export const SOFT_BASIS_HEADLINE = 'Soft clearance needs a measurement basis. Hard clash is available.';
export const SOFT_BASIS_NOT_VERIFIED_TEXT = 'Measurement basis was not verified automatically. Choose the units/basis to run a Soft clearance test.';
export const BASIS_UNITS = Object.freeze(['mm', 'cm', 'm', 'in', 'ft']);   // declared units: LABELS only, never converted
export const BASIS_RAW = 'raw';                                             // "Model units (raw, unverified)"
