// clashtest/index.js
//
// The single public entry point of the federated clash-test core engine (spec 18). A pure re-export:
// this module runs no side effects of its own, reads no global, and (like collision/index.js) is the
// only place a consumer imports from, never the individual implementation modules.
//
// One `export {...} from` per OWNING module, on purpose: NEVER `export * from './engine.js'`. engine.js
// also has internal named exports (createEngineCore, ENGINE_METHODS, createStoredDefinitionResolver,
// withStoredDefinitionValidator) that must not reach consumers; test/clashtest/engine/exports.test.mjs
// pins their absence by name and by comparison with engine.js's own export list.
//
// Deliberately NOT exported (see clashtest/README.md): compareResultSets, annotate, derivations
// (the derivation functions are reached only through a context / `engine.derivations`).
// createDerivationContext is exported from P8.8. getPairStatus / getElementStatus come from P5
// results/status.js, never from P8.

export { createClashTestEngine } from './engine.js';
export { validateTest } from './definition/validate.js';
export { assessNoClashClaim, canClaimNoClashes } from './results/claim.js';
export { getPairStatus, getElementStatus } from './results/status.js';
export { getFreshness } from './run/freshness.js';
export { createDerivationContext } from './derive/index.js';
export { createInMemoryClashTestStore } from './stores/InMemoryClashTestStore.js';
export { createInMemoryResultStore } from './results/InMemoryResultStore.js';
export { createLocalUnitExecutor } from './execution/LocalUnitExecutor.js';
export { createModelRegistry } from './identity/ModelRegistry.js';
export { RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS } from './options.js';
export {
  ClashTestError, InvalidTestDefinitionError, UnsupportedSchemaVersionError, InvalidOptionsError,
  ModelBindingError, ModelKeyVersionConflictError, IdentityConflictError, RevisionConflictError,
  TestDeletedError, TestArchivedError, RunIdConflictError, PersistenceOutcomeUnknownError,
  StoreNotConfiguredError, CorruptListingError, RunQueueFullError, ResultCapacityError,
  ResultSetRetainedError, UnsavedResultSetError, RunNotTerminalError, ResultNotResidentError,
  EngineDisposedError, CorruptResultSetError, ResultSetTooLargeError, ReadCapacityError,
  ReadAbortedError, EnumerationCancelledError, AnnotationTooLargeError, AnnotationSupersededError,
  AnnotationBusyError, AttributeSourceError, DerivationAbortedError, DerivationBusyError,
  GroupingTooLargeError, ComparisonTooLargeError, FacetRangeError,
} from './errors.js';
