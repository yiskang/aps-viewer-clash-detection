// clashtest/derive/validate.js
import { InvalidOptionsError } from '../errors.js';
export const invalid = (code, path) => new InvalidOptionsError({ issues: [{ path, code, message: code }] });
export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
export function assertClosed(obj, allowed, path) {
  if (!isPlainObject(obj)) throw invalid('not-an-object', path);
  const bad = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (bad.length) throw new InvalidOptionsError({ issues: bad.map((k) => ({ path: `${path}.${k}`, code: 'unknown-key', message: 'unknown-key' })) });
}
/** Fail-closed (mirrors engine.js isAbortSignal, owner ruling #8): a value that throws while probed is not a signal. No member is invoked. */
export function isAbortSignal(s) {
  if (s === null || typeof s !== 'object') return false;
  try {
    return typeof s.aborted === 'boolean' && typeof s.addEventListener === 'function';
  } catch {
    return false;
  }
}
export function isJsonValue(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  return isPlainObject(v) && Object.values(v).every(isJsonValue);
}
