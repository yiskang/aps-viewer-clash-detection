// clashtest/results/InMemoryResultStore.js
//
// Task P5.7: the reference `ResultStore` port implementation (spec S13.5). Durable form: each set
// is kept as its OWN canonical JSON string plus a precomputed byte length -- never as a live
// reference to the caller's object, and never via native `structuredClone` on it (spec S13.6: "an
// engine never produces a set it cannot read", and the byte guard below must reject an oversized
// set "without materializing the value", which is only possible if the size can be checked against
// a string BEFORE `JSON.parse` is ever called). This is spec erratum A6 (owner-authorized
// 2026-09-21, S-P5-2 SETTLED): S13.3's "uses `structuredClone` both ways" sentence is corrected to
// the canonical JSON string -- the observable contract (copy on write and on read, atomic
// create-only `put`, byte-guarded `get`) is unchanged; only the mechanism is.
//
// `put` runs entirely BEFORE its first `await` (there is none): every check (runId identity,
// tombstone reservation, every `modelKey -> modelVersion` identity claim) and the eventual insert
// happen in one synchronous prefix, so two concurrent callers can never interleave mid-`put` --
// JS's own run-to-completion semantics make the whole operation atomic and linearizable for free,
// which is exactly the property the conformance suite's three races (and its `makeYieldingStore`
// negative case) exist to prove.

import { canonicalJson } from '../util/canonical.js';
import { validateResultSetSummary } from './validateResultSet.js';
import {
  RunIdConflictError, IdentityConflictError, TestDeletedError,
  ResultSetTooLargeError, CorruptListingError, InvalidOptionsError,
} from '../errors.js';

const LIST_DEFAULT_LIMIT = 100;
const LIST_MAX_LIMIT = 1000;                // spec S13.5 "Listing contract": 1 <= limit <= 1,000
const CURSOR_PREFIX = 'v1:';
const MAX_LISTING_ISSUES = 20;              // spec S13.5: "first 20 {path, code}, no values"

// UTF-8 byte length of a JS string, computed by scanning code units: no `TextEncoder` allocation,
// no `Buffer`, and no copy of the string itself (codex-review finding, 2026-09-22, Medium: a
// `TextEncoder().encode(s).length` call allocates a full encoded byte array just to read its
// `.length`, doubling transient memory for a set near `maxStoredResultBytes`). Matches this
// codebase's own established local-copy convention (`util/capture.js` and
// `results/resultSetSchema.js` each keep their own same-named function rather than a cross-module
// import). A lone surrogate is 3 bytes (it encodes as U+FFFD), matching Buffer.byteLength/TextEncoder.
function byteLength(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i += 1; }
    else n += 3;
  }
  return n;
}

/**
 * `createInMemoryResultStore({now?}) -> ResultStore`. `now` is accepted for signature parity with
 * every other time-injectable factory in this codebase (master Global Constraints: "every module
 * that measures time or yields takes now") but is not read: this reference store persists no
 * timestamp of its own (LRU/eviction bookkeeping belongs to `residency.js`, a separate layer over
 * this port).
 */
export function createInMemoryResultStore({ now } = {}) {   // eslint-disable-line no-unused-vars
  const sets = new Map();            // runId -> { canonical: string, bytes: number, summary: ResultSetSummary }
  const identity = new Map();        // modelKey -> modelVersion (S4.2: independent of result lifetime; delete() never clears it)
  const tombstones = new Set();      // testId -> permanently reserved (S5.5)

  /**
   * Builds the closed `ResultSetSummary` (spec S13.5) directly from `resultSet` -- reading its
   * properties by plain access is SAFE here (never re-opens the capture-first boundary) only
   * because `put()` calls this AFTER `canonicalJson(resultSet)` has already succeeded: that walk
   * uses the exact same descriptor-based, accessor-rejecting traversal as the untrusted-read
   * boundary (`util/canonical.js`'s own `Reflect.getOwnPropertyDescriptor` + `'value' in d` check)
   * over `resultSet`'s ENTIRE graph, and would already have thrown had any accessor existed
   * anywhere in it. Every value copied out below is therefore a value, never a live getter result.
   *
   * `testRef`/`digests` are shallow-copied (both are flat, primitives-only shapes -- spec S13.1)
   * and `models` is rebuilt as fresh `{modelKey, modelVersion}` rows, so nothing in the returned
   * summary shares a reference with `resultSet` -- copy-on-write into the store, satisfying the
   * exact same detachment guarantee a second full `JSON.parse(canonical)` would, without paying to
   * parse the (potentially huge) `results[]`/`ledger` arrays a second time just to read ~12 header
   * fields (codex-review finding, 2026-09-22: "full-set copies create excessive peak memory during
   * put()" -- a run near `maxStoredResultBytes` no longer transiently doubles its resident graph).
   */
  function summarize(resultSet, bytes) {
    return {
      runId: resultSet.runId,
      testRef: { ...resultSet.testRef },
      status: resultSet.outcome.status,
      coverage: resultSet.outcome.coverage,
      integrity: resultSet.outcome.integrity,
      environmentSensitive: resultSet.outcome.environmentSensitive,
      counts: {
        results: resultSet.results.length,
        units: resultSet.ledger.units.length,
        pairSpaceTotal: resultSet.ledger.pairSpaceTotal,
      },
      serializedBytes: bytes,
      digests: { ...resultSet.digests },
      models: resultSet.provenance.models.map((m) => ({ modelKey: m.modelKey, modelVersion: m.modelVersion })),
      startedAt: resultSet.provenance.startedAt,
      finishedAt: resultSet.provenance.finishedAt,
    };
  }

  return {
    // eslint-disable-next-line no-unused-vars
    async put(resultSet, { signal } = {}) {
      // `signal` is advisory only (spec S13.5 "put versus abort"): this store's whole operation is
      // synchronous, so there is no in-flight work an abort could usefully cut short, and once the
      // insertion has linearized `put` must resolve regardless of a later-observed abort.
      const canonical = canonicalJson(resultSet);
      const existing = sets.get(resultSet.runId);
      if (existing !== undefined) {
        if (existing.canonical === canonical) return;                    // idempotent identical re-put
        throw new RunIdConflictError({ runId: resultSet.runId });
      }
      if (tombstones.has(resultSet.testRef.testId)) {
        throw new TestDeletedError({ testId: resultSet.testRef.testId });
      }
      // Stage every claim from THIS set first (codex-review finding, 2026-09-22, Important,
      // confirmed): a modelKey repeated at two DIFFERENT versions WITHIN one incoming set is
      // exactly as much a conflict as one against the durable global index, and the original code
      // only ever compared against the global map -- `[[M,'vA'],[M,'vB']]` passed both individual
      // checks (M unclaimed either time) and the second claim silently overwrote the first.
      const staged = new Map();
      for (const m of resultSet.provenance.models) {
        const already = staged.get(m.modelKey);
        if (already !== undefined && already !== m.modelVersion) {
          throw new IdentityConflictError({ modelKey: m.modelKey, existingVersion: already, offeredVersion: m.modelVersion });
        }
        staged.set(m.modelKey, m.modelVersion);
      }
      // THEN check every staged claim against the durable index. Still no mutation of any kind:
      // check EVERY key before claiming ANY (S4.2 identity index, S13.5 "one step, across
      // different runIds too") -- a conflict on model N must leave models 1..N-1 unclaimed too.
      for (const [modelKey, modelVersion] of staged) {
        const claimed = identity.get(modelKey);
        if (claimed !== undefined && claimed !== modelVersion) {
          throw new IdentityConflictError({ modelKey, existingVersion: claimed, offeredVersion: modelVersion });
        }
      }
      const bytes = byteLength(canonical);
      // Build the summary BEFORE committing anything (codex-review finding, 2026-09-22, Important,
      // confirmed): the original code claimed every model identity FIRST and built the summary
      // after -- a malformed-but-canonicalizable set (e.g. missing `outcome` entirely) made
      // `summarize` throw while the identity claims had already landed, permanently poisoning every
      // later legitimate write that reused one of those modelKeys even though nothing was ever
      // actually stored. `summarize` is the last fallible step; nothing after it can throw.
      const summary = summarize(resultSet, bytes);
      for (const [modelKey, modelVersion] of staged) identity.set(modelKey, modelVersion);
      sets.set(resultSet.runId, { canonical, bytes, summary });
    },

    async tombstoneTest(testId) { tombstones.add(testId); },

    async isTombstoned(testId) { return tombstones.has(testId); },

    async get(runId, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
      const record = sets.get(runId);
      if (record === undefined) return null;
      // The byte guard: checked against the STRING's own length, before any parse -- the "reject
      // without materializing the value" contract of spec S13.6.
      if (record.bytes > maxBytes) throw new ResultSetTooLargeError({ runId });
      return JSON.parse(record.canonical);                                // a fresh copy every call
    },

    async list({ testId, limit = LIST_DEFAULT_LIMIT, cursor, ...unknown } = {}) {
      if (Object.keys(unknown).length > 0) {
        throw new InvalidOptionsError({ reason: 'unknown-key', issues: Object.keys(unknown).map((k) => ({ path: `/${k}`, code: 'unknown-key' })) });
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX_LIMIT) {
        throw new InvalidOptionsError({ reason: 'limit', issues: [{ path: '/limit', code: 'out-of-range' }] });
      }
      let after = null;
      if (cursor !== undefined) {
        if (typeof cursor !== 'string' || !cursor.startsWith(CURSOR_PREFIX)) {
          throw new InvalidOptionsError({ reason: 'bad-cursor', issues: [{ path: '/cursor', code: 'bad-cursor' }] });
        }
        after = cursor.slice(CURSOR_PREFIX.length);
      }
      // Keyset paging (spec S13.5 "Listing contract"): ascending runId, code-unit order, strictly
      // greater than the cursor's key -- never an offset into a live, mutable collection.
      const keys = [...sets.keys()].sort()
        .filter((k) => (after === null || k > after)
          && (testId === undefined || sets.get(k).summary.testRef.testId === testId));
      const page = keys.slice(0, limit).map((k) => structuredClone(sets.get(k).summary));
      // "Listings are untrusted data too" (S15-6): the whole page is captured (it already is --
      // every row is a fresh `structuredClone`) and validated before it is returned; any invalid
      // row rejects the WHOLE page, never a silent per-row skip.
      const issues = page.flatMap((s) => validateResultSetSummary(s, {}).issues).slice(0, MAX_LISTING_ISSUES);
      if (issues.length > 0) throw new CorruptListingError({ issues });
      return keys.length > limit
        ? { summaries: page, next: CURSOR_PREFIX + page[page.length - 1].runId }
        : { summaries: page };
    },

    async delete(runId) { sets.delete(runId); },   // the identity index is NEVER cleared (S4.2)
  };
}
