// clashtest/stores/InMemoryClashTestStore.js
import { RevisionConflictError, TestArchivedError, TestDeletedError, InvalidOptionsError } from '../errors.js';
import { LIST_LIMIT } from '../definition/validate.js';
import { deepFreezeDefinition } from '../definition/normalize.js';

/**
 * @typedef {Object} ClashTestStore  the port of spec 5.5 (every method linearizable per testId)
 * @property {(def) => Promise<object>} put
 * @property {(testId: string, revision?: number) => Promise<object|null>} get
 * @property {(testId: string, revision?: number) => Promise<{status: 'live'|'archived'|'deleted'|'missing',
 *            definition: object|null, latestRevision: number|null}>} resolveForRun
 * @property {(opts?: {limit?: number, cursor?: string}) => Promise<{summaries: object[], next?: string}>} list
 * @property {(testId: string) => Promise<void>} archive
 * @property {(testId: string) => Promise<void>} delete
 * @property {(testId: string) => Promise<boolean>} isTombstoned
 */

const LIST_OPTION_KEYS = ['limit', 'cursor'];
const CURSOR_PREFIX = 'v1:';
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // local; normalize.js keeps its own copy

function parseListOptions(opts) {
  const issues = [];
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new InvalidOptionsError({ issues: [{ path: '/', code: 'not-an-object' }] });
  }
  for (const k of Object.keys(opts)) {
    if (!LIST_OPTION_KEYS.includes(k)) issues.push({ path: `/${k}`, code: 'unknown-property' });
  }
  let limit = LIST_LIMIT.default;
  if (opts.limit !== undefined) {
    if (typeof opts.limit !== 'number' || !Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > LIST_LIMIT.max) {
      issues.push({ path: '/limit', code: 'out-of-range' });
    } else limit = opts.limit;
  }
  let after = null;
  let badCursor = false;
  if (opts.cursor !== undefined) {
    if (typeof opts.cursor !== 'string' || !opts.cursor.startsWith(CURSOR_PREFIX)) badCursor = true;
    else {
      try { after = decodeURIComponent(opts.cursor.slice(CURSOR_PREFIX.length)); }
      catch { badCursor = true; }
    }
  }
  if (badCursor) issues.push({ path: '/cursor', code: 'bad-cursor' });
  if (issues.length > 0) throw new InvalidOptionsError({ issues, reason: badCursor ? 'bad-cursor' : null });
  return { limit, after };
}

/** `now` is accepted for signature parity with the other stores; nothing here reads a clock. */
export function createInMemoryClashTestStore(_opts = {}) {
  /** @type {Map<string, {revisions: Map<number, object>, latest: number, archived: boolean}>} */
  const tests = new Map();
  /** @type {Set<string>} */
  const tombstones = new Set();

  // Every body below is one synchronous critical section: no await between read and write.
  return {
    async put(def) {
      const { testId, revision } = def;
      if (tombstones.has(testId)) throw new TestDeletedError({ testId });
      const record = tests.get(testId);
      if (record && record.archived) throw new TestArchivedError({ testId });
      const latest = record ? record.latest : null;
      const expected = record ? record.latest + 1 : 1;
      if (revision !== expected) throw new RevisionConflictError({ testId, latest, offered: revision });
      const frozen = deepFreezeDefinition(def);
      if (record) { record.revisions.set(revision, frozen); record.latest = revision; }
      else tests.set(testId, { revisions: new Map([[revision, frozen]]), latest: revision, archived: false });
      return frozen;
    },

    async get(testId, revision) {
      const record = tests.get(testId);
      if (!record) return null;
      if (revision === undefined) return record.revisions.get(record.latest) ?? null;
      return record.revisions.get(revision) ?? null;
    },

    async resolveForRun(testId, revision) {
      if (tombstones.has(testId)) return { status: 'deleted', definition: null, latestRevision: null };
      const record = tests.get(testId);
      if (!record) return { status: 'missing', definition: null, latestRevision: null };
      const wanted = revision === undefined ? record.latest : revision;
      const definition = record.revisions.get(wanted) ?? null;
      // 5.5: a requested revision that does not exist is `missing` (latestRevision null for missing)
      if (!definition) return { status: 'missing', definition: null, latestRevision: null };
      return { status: record.archived ? 'archived' : 'live', definition, latestRevision: record.latest };
    },

    async list(opts = {}) {
      const { limit, after } = parseListOptions(opts);
      const ids = [...tests.keys()].sort(byCodeUnit)
        .filter((id) => after === null || byCodeUnit(id, after) > 0);   // keyset: strictly after
      const page = ids.slice(0, limit);
      const summaries = page.map((testId) => {
        const record = tests.get(testId);
        return { testId, latestRevision: record.latest, archived: record.archived, name: record.revisions.get(record.latest).name };
      });
      const result = { summaries };
      if (ids.length > page.length) result.next = CURSOR_PREFIX + encodeURIComponent(page[page.length - 1]);
      return result;
    },

    async archive(testId) {
      const record = tests.get(testId);
      if (record) record.archived = true;      // one-way, idempotent, covers every revision
    },

    async delete(testId) {
      // ONE linearization point: the tombstone and the body removal happen together.
      tombstones.add(testId);
      tests.delete(testId);
    },

    async isTombstoned(testId) { return tombstones.has(testId); },
  };
}
