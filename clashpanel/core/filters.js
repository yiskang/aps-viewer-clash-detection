// clashpanel/core/filters.js
//
// Spec §10.1: every v1 filter is a Panel-side PURE predicate over the frozen `results[]` — no Core
// derivation per interaction (AC-P4). The only Core-derived input is the cached `caveated` mask
// (one derivations.filter per run, owned by the controller). Passes run in LIST_CHUNK_SIZE chunks
// with a scheduler yield between chunks and a supersession check per chunk; text debounce is the
// controller's job. Output: ascending canonical indexes in a Uint32Array (bounded memory).
import { LIST_CHUNK_SIZE } from './constants.js';

/** Shown when the "unverified" filter is on but the caveated mask is pending or failed (plain text). */
export const FILTER_MASK_UNAVAILABLE_TEXT = 'The “unverified” filter couldn\'t be evaluated for this run — turn it off to continue.';

export const EMPTY_FILTER_SPEC = Object.freeze({
  text: '', models: Object.freeze([]), elementOnly: null, maxGap: null, unverified: false, hasLocation: false,
});

export function isFilterActive(spec) {
  if (!spec) return false;
  return (typeof spec.text === 'string' && spec.text.trim() !== '')
    || (Array.isArray(spec.models) && spec.models.length > 0)
    || spec.elementOnly != null
    || Number.isFinite(spec.maxGap)
    || spec.unverified === true
    || spec.hasLocation === true;
}

/** Max gap input (Soft only): a finite number ≥ 0 and ≤ the run's clearance. Increasing the
 *  clearance needs a rerun (setup-changed), so values above it are rejected, never silently clamped. */
export function parseMaxGap(text, clearance) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (raw === '') return { value: null, error: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { value: null, error: 'Enter a number of 0 or more.' };
  if (Number.isFinite(clearance) && n > clearance) {
    return { value: null, error: `Max gap cannot exceed the run's clearance (${clearance}); run again with a larger clearance instead.` };
  }
  return { value: n, error: null };
}

export function createRecordPredicate(spec, { caveatedIds = null, labelText = () => '' } = {}) {
  const needle = typeof spec?.text === 'string' ? spec.text.trim().toLowerCase() : '';
  const digits = needle.startsWith('#') ? needle.slice(1) : needle;
  const numeric = /^\d+$/.test(digits);
  const models = Array.isArray(spec?.models) && spec.models.length > 0 ? new Set(spec.models) : null;
  const el = spec?.elementOnly ?? null;
  const maxGap = Number.isFinite(spec?.maxGap) ? spec.maxGap : null;
  const unverified = spec?.unverified === true;
  const hasLocation = spec?.hasLocation === true;
  if (unverified && !(caveatedIds instanceof Set)) {
    throw new TypeError('createRecordPredicate: the unverified filter needs the caveated mask (runFilterPass reports mask-missing)');
  }
  const sideText = (ref) => (numeric && String(ref.dbId).includes(digits)) || labelText(ref).includes(needle);
  return (record) => {
    const { first, second } = record.pair;
    if (models !== null && !models.has(first.modelKey) && !models.has(second.modelKey)) return false;
    if (el !== null && !((first.modelKey === el.modelKey && first.dbId === el.dbId)
      || (second.modelKey === el.modelKey && second.dbId === el.dbId))) return false;
    if (maxGap !== null && record.mode === 'clearance' && !(record.evidence.distance <= maxGap)) return false;
    if (unverified && !caveatedIds.has(record.resultId)) return false;
    if (hasLocation && record.flags?.witnessUnavailable === true) return false;
    if (needle !== '' && !sideText(first) && !sideText(second)) return false;
    return true;
  };
}

/** Sliced pass over the index. Returns the matching canonical indexes (ascending); 'superseded' as soon as
 *  isCurrent() is false at a chunk boundary (or before the fast path); 'mask-missing' when the unverified
 *  filter is on but the caveated mask is pending or failed — NEVER an empty result in that case. */
export async function runFilterPass({ index, spec, caveatedIds = null, labelText, scheduler, isCurrent = () => true }) {
  const count = index.count;
  if (!isCurrent()) return 'superseded';
  if (spec?.unverified === true && !(caveatedIds instanceof Set)) return 'mask-missing';
  if (!isFilterActive(spec)) {                               // fast path: everything, canonical order
    const all = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) all[i] = i;
    return all;
  }
  const predicate = createRecordPredicate(spec, { caveatedIds, labelText });
  const out = new Uint32Array(count);
  let n = 0;
  for (let start = 0; start < count; start += LIST_CHUNK_SIZE) {
    if (!isCurrent()) return 'superseded';
    const end = Math.min(count, start + LIST_CHUNK_SIZE);
    for (let i = start; i < end; i += 1) if (predicate(index.at(i))) { out[n] = i; n += 1; }
    if (end < count) await scheduler.yield();
  }
  if (!isCurrent()) return 'superseded';
  return out.slice(0, n);                                    // a copy: the full-size scratch buffer is dropped
}
