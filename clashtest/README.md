# clashtest — federated clash-test core engine

A Viewer-independent engine that turns a saved **clash test** (two selections, one collision mode,
optional clearance) into a reproducible **Result Set**: it plans the work into units, runs them through
an executor over an injected `CollisionWorld`, and seals a result that records not only the clashes
found but what was and was not covered, so "no clashes" can be claimed only when it is proven.

It is additive. `collision/` is unchanged, and the core imports nothing from the Viewer, `three`, or
`collision/` internals: it reaches `CollisionWorld` only through the injected world and the two
Viewer-facing ports below.

Import from the single entry point, never from the implementation modules:

```js
import { createClashTestEngine, createInMemoryClashTestStore, createInMemoryResultStore,
         createLocalUnitExecutor, canClaimNoClashes, RUN_OPTION_DEFAULTS } from './clashtest/index.js';
```

`clashtest/index.js` is a pure re-export (no side effects, no global read). It exposes
`createClashTestEngine`, `validateTest`, `assessNoClashClaim`, `canClaimNoClashes`, `getPairStatus`,
`getElementStatus`, `getFreshness`, the two in-memory stores, `createLocalUnitExecutor`,
`createModelRegistry`, `RUN_OPTION_DEFAULTS`, `ENGINE_LIMIT_DEFAULTS` and every error class of
`clashtest/errors.js`. Everything else in `engine.js` (`createEngineCore`, `ENGINE_METHODS`, the
stored-definition resolver and validator hook, the `scheduleTimeout` seam) is internal;
`test/clashtest/engine/exports.test.mjs` pins that by name.

## Verification status of this checkpoint

**The engine is verified at the T1 level:** fakes, a scripted `UnitExecutor`, and synthesized/sealed
Result Sets. The `LocalUnitExecutor` on its own also has tests over a real `CollisionWorld` with mock
models (`test/clashtest/execution/localExecutor.realWorld.test.mjs`), but **the engine as a whole has
not been verified end-to-end over the real `CollisionWorld` and the real `LocalUnitExecutor`.** That
real-world integration suite (P7.8) is pending open owner decisions, and until it runs, do not read
the T1 results as evidence for the real path. See `docs/handoffs/latest.md` for the current state and
what is blocked.

## The six ports

`createClashTestEngine({ world, enumerator, registry?, unitExecutor?, testStore?, resultStore?, ... })`
depends on six ports. Five have a reference implementation; the enumerator does not:

| Port | Reference implementation |
| --- | --- |
| World (`CollisionWorld`, injected) | the existing `collision/` library; not part of `clashtest/` |
| `ModelRegistry` (one per world, joined through the world coordinator) | `createModelRegistry` (`identity/ModelRegistry.js`) |
| `UnitExecutor` | `createLocalUnitExecutor` (`execution/LocalUnitExecutor.js`) |
| `ClashTestStore` | `createInMemoryClashTestStore` |
| `ResultStore` | `createInMemoryResultStore` |
| `ElementEnumerator` | **none.** Only the port contract and a conformance helper (`planning/ElementEnumerator.js`) plus a test fake; the Viewer adapter is deferred (below). |

## One collision mode per test

A test definition carries exactly one `mode` (one of the four library modes), and `clearance` applies
only to the clearance mode. To ask a question in a second mode, save a second test; a run never mixes
modes, and swapping `selectionA`/`selectionB` is a different question with a different
`semanticDigest`.

## Every cap in `options.js` is provisional

Every default, ceiling and cross-field rule in `options.js` (`RUN_OPTION_DEFAULTS`,
`ENGINE_LIMIT_DEFAULTS`, and the ceilings behind them) is **provisional until the AC-12 calibration gate
(G-CAL) closes**. They are overridable defaults, not frozen constants of the design, and
`DEFAULTS_STATUS` in `options.js` says so machine-readably. No test here asserts a wall-clock budget;
span durations are recorded, not gated.

## Deliberately absent from the core

| Not in the core | Where it lives |
| --- | --- |
| Annotation (`annotate`) | A follow-up to the derivations phase. Absent from the engine object, not stubbed. |
| Derivations and comparison (`derivations`, `createDerivationContext`, `compareResultSets`) | Phase P8 (`docs/superpowers/plans/federated-clash-test-core/p8-derivations.md`). |
| Viewer adapter (`ElementEnumerator` over a live model tree) | Proposed `clashtest/viewer/`; open question OQ-4. |
| Remote persistence and the ambiguous-commit reconciliation loop | Gate G-REMOTE. The `ResultStore` port here is local and transactional, so a rejected `put` ends the attempt. The typed `PersistenceOutcomeUnknownError` stays in `errors.js`. |
| The `migration-failed` planning cause | Reserved with no producer: the definition `schemaVersion` is 1, so it is unreachable. |

## Design and plan

- Spec: `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`
- Plan: `docs/superpowers/plans/2026-09-20-federated-clash-test-core-engine-implementation.md`
  (phase files under `docs/superpowers/plans/federated-clash-test-core/`)
- Current state and open items: `docs/handoffs/latest.md`
