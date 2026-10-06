// wwwroot/extensions/clashPanelNames.js
//
// A tiny shared registry of friendly model names keyed by URN. The demo loader (which knows
// "Structure" / "Mechanical") writes here; the Clash Panel host catalog reads it lazily, so names
// declared before OR after the panel exists both work. Plain strings only (no model references).
const names = new Map();

/** 'urn:abc' and 'abc' name the same model: loadModel() prepends 'urn:', model.getData().urn carries it. */
export function normalizeUrnKey(urn) {
  if (typeof urn !== 'string') return '';
  const t = urn.trim();
  return t.startsWith('urn:') ? t.slice(4) : t;
}

export function declareModelDisplayName(urn, displayName) {
  const k = normalizeUrnKey(urn);
  if (k === '' || typeof displayName !== 'string' || displayName === '') return;
  names.set(k, displayName);
}

export function declaredDisplayNameFor(urn) {
  return names.get(normalizeUrnKey(urn)) ?? null;
}

export function clearDeclaredDisplayNames() {
  names.clear();
}
