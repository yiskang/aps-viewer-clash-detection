// test/clashtest/support/definitions.mjs
export function makeDefinition(overrides = {}) {
  return {
    schemaVersion: 1,
    testId: 'T1',
    revision: 1,
    name: 'structure vs mep',
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [2, 1] }] },
    selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] },
    mode: 'volume-overlap',
    ...overrides,
  };
}
