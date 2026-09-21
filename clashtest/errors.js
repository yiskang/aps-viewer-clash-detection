// clashtest/errors.js
//
// Every typed error of spec section 18 (the engine's own API errors, plus the three ports' errors
// the spec names: IdentityConflictError / RunIdConflictError / PersistenceOutcomeUnknownError come
// from a ResultStore, TestDeletedError / RevisionConflictError from a ClashTestStore). Library
// (collision/) errors are never re-exported or wrapped here: the engine maps them to unit
// outcomes, it does not throw them.
//
// Convention: `new XError({ ...typedFields, message?, cause? })`. `error.name` is the class name
// (persistence records `error.name`, spec 13.5.1). Typed fields are plain data (JSON-safe) so an
// error can be summarised into a Result Set or a progress event without a live object.

/** Base class: lets a host write `err instanceof ClashTestError`. */
export class ClashTestError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ClashTestError';
  }
}

/** @type {Array<{ name: string, fields: string[] }>} */
const catalogue = [];

/**
 * @param {string} name
 * @param {Record<string, unknown | (() => unknown)>} fields typed fields and their defaults
 *        (a function default is called per instance so arrays are never shared)
 * @param {(init: any) => string} describe default message
 * @param {(init: any) => any} [normalize] input clean-up applied before the fields are copied
 */
function defineError(name, fields, describe, normalize) {
  const cls = {
    [name]: class extends ClashTestError {
      constructor(init = {}) {
        const src = normalize ? normalize({ ...init }) : init;
        super(init.message ?? describe(src), init.cause);
        this.name = name;
        for (const [field, dflt] of Object.entries(fields)) {
          this[field] = src[field] !== undefined ? src[field] : (typeof dflt === 'function' ? dflt() : dflt);
        }
      }
    },
  }[name];
  catalogue.push(Object.freeze({ name, fields: Object.freeze(Object.keys(fields)) }));
  return cls;
}

const sample = (issues) => (issues && issues[0] ? ` (first: ${issues[0].code} at ${issues[0].path})` : '');
// A rejected schemaVersion is caller data: keep only a number or a short string, never an object.
const boundedVersion = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? v.slice(0, 64) : null);
const fullIssues = (init) => ({
  ...init,
  issues: Object.freeze((init.issues ?? []).map(({ path, code, message }) => Object.freeze({ path, code, message: message ?? '' }))),
});
// Persisted-set and listing errors carry NO values (spec 13.6): first 20 {path, code} only.
const bareIssues = (init) => ({
  ...init,
  issues: Object.freeze((init.issues ?? []).slice(0, 20).map(({ path, code }) => Object.freeze({ path, code }))),
});

// ---- definitions and options ----------------------------------------------------------------------
export const InvalidTestDefinitionError = defineError('InvalidTestDefinitionError',
  { issues: () => [], issuesTruncated: false },
  (i) => `invalid clash test definition${sample(i.issues)}`, fullIssues);
export const UnsupportedSchemaVersionError = defineError('UnsupportedSchemaVersionError',
  { type: null, schemaVersion: null, supported: null },
  (i) => `unsupported ${i.type ?? 'schema'} version`,
  (i) => ({ ...i, schemaVersion: boundedVersion(i.schemaVersion) }));
export const InvalidOptionsError = defineError('InvalidOptionsError',
  { issues: () => [], reason: null },
  (i) => `invalid options${i.reason ? ` [${i.reason}]` : ''}${sample(i.issues)}`, fullIssues);

// ---- identity, registry, stores -------------------------------------------------------------------
export const ModelBindingError = defineError('ModelBindingError',
  { reason: null, modelKey: null }, (i) => `model binding error${i.reason ? ` [${i.reason}]` : ''}`);
export const ModelKeyVersionConflictError = defineError('ModelKeyVersionConflictError',
  { modelKey: null, existingVersion: null, offeredVersion: null }, (i) => `modelKey ${i.modelKey} is already bound to a different modelVersion`);
export const IdentityConflictError = defineError('IdentityConflictError',
  { modelKey: null, existingVersion: null, offeredVersion: null }, (i) => `result store already maps modelKey ${i.modelKey} to a different modelVersion`);
export const RevisionConflictError = defineError('RevisionConflictError',
  { testId: null, latest: null, offered: null }, (i) => `revision ${i.offered} rejected for test ${i.testId} (latest ${i.latest})`);
export const TestDeletedError = defineError('TestDeletedError', { testId: null }, (i) => `test ${i.testId} was deleted`);
export const TestArchivedError = defineError('TestArchivedError', { testId: null }, (i) => `test ${i.testId} is archived`);
export const RunIdConflictError = defineError('RunIdConflictError', { runId: null }, (i) => `run ${i.runId} already stored with different content`);
export const PersistenceOutcomeUnknownError = defineError('PersistenceOutcomeUnknownError', { runId: null }, () => 'persistence outcome unknown');
export const StoreNotConfiguredError = defineError('StoreNotConfiguredError', { store: null }, (i) => `no ${i.store} is configured`);
export const CorruptListingError = defineError('CorruptListingError',
  { issues: () => [] }, (i) => `corrupt store listing${sample(i.issues)}`, bareIssues);

// ---- runs and residency ---------------------------------------------------------------------------
export const RunQueueFullError = defineError('RunQueueFullError', { limit: null, queued: null }, (i) => `run queue is full (limit ${i.limit})`);
export const ResultCapacityError = defineError('ResultCapacityError',
  { cap: null, active: () => [], retained: () => [], held: () => [] },
  (i) => `result capacity ${i.cap} exhausted`);
export const ResultSetRetainedError = defineError('ResultSetRetainedError', { runId: null }, (i) => `result set ${i.runId} is retained`);
export const UnsavedResultSetError = defineError('UnsavedResultSetError', { runId: null }, (i) => `result set ${i.runId} is not saved`);
export const RunNotTerminalError = defineError('RunNotTerminalError', { runId: null }, (i) => `run ${i.runId} is not terminal`);
export const ResultNotResidentError = defineError('ResultNotResidentError', { runId: null }, (i) => `result set ${i.runId} is not resident`);
export const EngineDisposedError = defineError('EngineDisposedError', {}, () => 'engine has been disposed');

// ---- persisted sets and reads ---------------------------------------------------------------------
export const CorruptResultSetError = defineError('CorruptResultSetError',
  { runId: null, issues: () => [] }, (i) => `corrupt result set${sample(i.issues)}`, bareIssues);
export const ResultSetTooLargeError = defineError('ResultSetTooLargeError', { runId: null }, (i) => `result set ${i.runId} exceeds this engine's read limits`);
export const ReadCapacityError = defineError('ReadCapacityError', { limit: null }, (i) => `read capacity ${i.limit} exhausted`);
export const ReadAbortedError = defineError('ReadAbortedError', {}, () => 'read aborted');

// ---- planning --------------------------------------------------------------------------------------
// reason: 'cancelled' | 'lease-dead' | 'disposed' (spec 6.2 EnumerationContext.checkpoint)
export const EnumerationCancelledError = defineError('EnumerationCancelledError', { reason: null }, (i) => `enumeration cancelled${i.reason ? ` [${i.reason}]` : ''}`);

// ---- annotation and derivations --------------------------------------------------------------------
export const AnnotationTooLargeError = defineError('AnnotationTooLargeError', { limit: null, observed: null }, (i) => `annotation exceeds ${i.limit}`);
export const AnnotationSupersededError = defineError('AnnotationSupersededError', { runId: null }, () => 'annotation superseded');
export const AnnotationBusyError = defineError('AnnotationBusyError', { limit: null }, (i) => `annotation concurrency ${i.limit} exhausted`);
export const AttributeSourceError = defineError('AttributeSourceError', { modelKey: null }, () => 'attribute source failed');
export const DerivationAbortedError = defineError('DerivationAbortedError', {}, () => 'derivation aborted');
export const DerivationBusyError = defineError('DerivationBusyError', { limit: null }, (i) => `derivation concurrency ${i.limit} exhausted`);
export const GroupingTooLargeError = defineError('GroupingTooLargeError', { limit: null, observed: null }, (i) => `grouping exceeds ${i.limit}`);
export const ComparisonTooLargeError = defineError('ComparisonTooLargeError', { limit: null, observed: null }, (i) => `comparison exceeds ${i.limit}`);
export const FacetRangeError = defineError('FacetRangeError', { facetId: null }, (i) => `facet ${i.facetId} value out of range`);

/** Frozen list of `{ name, fields }` for every class above (used by the catalogue test and docs). */
export const ERROR_CATALOGUE = Object.freeze(catalogue.slice());
