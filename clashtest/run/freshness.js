// clashtest/run/freshness.js
//
// Spec §16.4 — read-time freshness as a bracketed WHOLE-OPERATION check:
//   snapshot1 -> pass1 -> snapshot2 -> pass2 -> snapshot3
// `current` only when every bracket agrees AND snapshot1 still matches the SEALED provenance.
// A definite change always beats "could not tell".
//
// The re-digest-and-compare half is P3's `checkScopeBracket` (duplicate-ownership D1) — the same
// function P4's executor calls per unit, so the per-unit proof and the read-time proof are one
// implementation and cannot diverge. This module contributes only the read-time expectation, the
// registry comparisons, and the fold into a `Freshness`.

import { checkScopeBracket } from '../planning/scopeDigest.js';

const STALE = 'stale';
const UNVERIFIABLE = 'unverifiable';
const CURRENT = 'current';

/**
 * Project the SEALED `provenance.models[].scopeDigests` into the entry shape the comparator takes.
 * This applies no planning rule — in particular it does not re-derive R20-1 (P3's `materializeUnit`
 * owns that, D1): the sealed record already lists exactly the scopes the run bracketed, so a
 * whole-model source's population row is present here iff the planner emitted it.
 */
export function sealedScopeExpect(models) {
  const out = [];
  for (const m of models) {
    if (m.scopeDigests.population !== null) {
      out.push(Object.freeze({
        modelKey: m.modelKey, role: 'recorded', scope: 'whole',
        population: Object.freeze({ ...m.scopeDigests.population }),
      }));
    }
    if (m.scopeDigests.roots.length > 0) {
      out.push(Object.freeze({
        modelKey: m.modelKey, role: 'recorded', scope: 'roots',
        roots: Object.freeze(m.scopeDigests.roots.map(({ dbId, subtreeDigest }) =>
          Object.freeze({ dbId, subtreeDigest }))),
      }));
    }
  }
  return Object.freeze(out);
}

/** A4: positions match the input keys, and a `null` entry means dead | unregistered | lease-invalid. */
// P3's `checkScopeBracket` takes `bindings` as a `Map<modelKey, Binding|null>` (its lookup is by
// `entry.modelKey`), while P1's `snapshotBindings` returns a POSITIONAL array aligned to `keys`
// (R7). Building the Map is therefore the caller's job — P4 passes its own `resolved.byKey`.
const bindingMap = (keys, snapshot) => new Map(keys.map((k, i) => [k, snapshot.bindings[i]]));

function foldBracket({ proof, modelKeys }, stale, unverifiable) {
  if (proof === 'drift') for (const k of modelKeys) stale.add(`scope-drift:${k}`);
  else if (proof === 'unverifiable') for (const k of modelKeys) unverifiable.add(`scope-unverifiable:${k}`);
}

/** Two LIVE snapshots, in order. There is no `dead` flag to test (N10). */
function compareSnapshots(keys, a, b, stale) {
  keys.forEach((key, i) => {
    const before = a.bindings[i];
    const after = b.bindings[i];
    if (before === null || after === null) { stale.add(`model-evicted:${key}`); return; }
    if (after.modelVersion !== before.modelVersion) { stale.add(`model-version-conflict:${key}`); return; }
    if (after.placementGeneration !== before.placementGeneration) { stale.add(`placement-changed:${key}`); return; }
    if (after.bindingGeneration !== before.bindingGeneration) stale.add(`model-reloaded:${key}`);
  });
}

/**
 * R9 / review C4 — snapshot1 against the SEALED provenance. Without this, a change that COMPLETED
 * before the call began is invisible: every live snapshot carries the same new generation and the
 * digests match, because scope digests exclude transforms.
 *
 * `modelVersion` is compared unconditionally (a host identity-contract violation, §4.2, is not
 * excused by a different session). The two generation counters are session-local, so they are
 * compared only when the registry session matches the sealed one.
 */
function compareToSealed(models, snapshot, { sameSession }, stale) {
  models.forEach((recorded, i) => {
    const live = snapshot.bindings[i];
    if (live === null) { stale.add(`model-evicted:${recorded.modelKey}`); return; }
    if (live.modelVersion !== recorded.modelVersion) {
      stale.add(`model-version-conflict:${recorded.modelKey}`); return;
    }
    if (!sameSession) return;
    if (live.placementGeneration !== recorded.placementGeneration) {
      stale.add(`placement-changed:${recorded.modelKey}`); return;
    }
    if (live.bindingGeneration !== recorded.bindingGeneration) {
      stale.add(`model-reloaded:${recorded.modelKey}`);
    }
  });
}

export async function getFreshness(resultSet, { registry, enumerator, ctx = { checkpoint() {} } } = {}) {
  const models = resultSet.provenance.models;
  const keys = models.map((m) => m.modelKey);
  const expect = sealedScopeExpect(models);
  const stale = new Set();
  const unverifiable = new Set();

  const sameSession = registry.registrySessionId === resultSet.provenance.registrySessionId;
  if (!sameSession) unverifiable.add('registry-session-mismatch');   // placement cannot be checked
  if (enumerator === undefined || enumerator === null) unverifiable.add('no-enumerator');

  const snapshot1 = registry.snapshotBindings(keys);
  compareToSealed(models, snapshot1, { sameSession }, stale);        // R9
  if (enumerator) {
    foldBracket(await checkScopeBracket(expect, { enumerator, bindings: bindingMap(keys, snapshot1), ctx }),
      stale, unverifiable);
  }

  const snapshot2 = registry.snapshotBindings(keys);
  compareSnapshots(keys, snapshot1, snapshot2, stale);
  if (enumerator) {
    // Each pass is compared against the SEALED expectation, which is strictly stronger than
    // comparing the two passes to each other: any change that persists into either pass differs
    // from the sealed value. The one case neither catches is the declared A->B->A residual.
    foldBracket(await checkScopeBracket(expect, { enumerator, bindings: bindingMap(keys, snapshot2), ctx }),
      stale, unverifiable);
  }

  const snapshot3 = registry.snapshotBindings(keys);                 // ONLY this sees a late placement change
  compareSnapshots(keys, snapshot2, snapshot3, stale);

  if (stale.size > 0) return Object.freeze({ state: STALE, reasons: Object.freeze([...stale].sort()) });
  if (unverifiable.size > 0) {
    return Object.freeze({ state: UNVERIFIABLE, reasons: Object.freeze([...unverifiable].sort()) });
  }
  return Object.freeze({ state: CURRENT, reasons: Object.freeze([]) });
}
