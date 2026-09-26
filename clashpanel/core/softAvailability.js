// clashpanel/core/softAvailability.js
// Spec 6.2 step 4 / PD-17: Soft is available iff |P| = 1 or the host's measurement-basis verdict is `verified`;
// otherwise it is unavailable with a FIXED explanation plus the verdict reason as plain text. Display units are never
// consulted (a label or a conversion cannot make an unverified basis valid, OD-13).
import { BASIS_VERDICT_TIMEOUT_MS, SOFT_UNAVAILABLE_TEXT } from './constants.js';
import { readBasisVerdict } from './ports.js';

export async function evaluateSoftAvailability({ participants, catalog, scheduler, timeoutMs = BASIS_VERDICT_TIMEOUT_MS } = {}) {
  if (!Array.isArray(participants) || !participants.every((k) => typeof k === 'string')) {
    throw new TypeError('evaluateSoftAvailability: participants must be an array of model keys');
  }
  const keys = [...new Set(participants)].sort();
  if (keys.length === 0) return Object.freeze({ available: false, verdict: null, explanation: null });
  if (keys.length === 1) return Object.freeze({ available: true, verdict: null, explanation: null });
  const verdict = await readBasisVerdict(catalog, keys, { scheduler, timeoutMs });
  if (verdict.state === 'verified') return Object.freeze({ available: true, verdict, explanation: null });
  const reason = typeof verdict.reason === 'string' ? verdict.reason : '';
  return Object.freeze({ available: false, verdict, explanation: reason.length > 0 ? `${SOFT_UNAVAILABLE_TEXT} ${reason}` : SOFT_UNAVAILABLE_TEXT });
}
