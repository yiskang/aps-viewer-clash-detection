# Federated Clash Test & Results — Core Engine Implementation Plan (master)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This master document is the index, dependency graph, gate register and cross-package contract. The task-level work lives in the per-phase files listed in §3; an executor reads this master first, then only the phase file it is executing.

**Goal:** Build the Viewer-neutral core of the Federated Clash Test & Results engine (`clashtest/`): test definitions, deterministic identity, coverage planning, orchestration over `CollisionWorld.findClashes`, run lifecycle, sealed Result Sets, in-memory stores, and claim/freshness semantics.

**Architecture:** A new sibling ESM module `clashtest/` that consumes only the public `CollisionWorld` surface and two injected ports (`ElementEnumerator`, `ModelRegistry`). The core is built bottom-up in dependency-ordered phases (foundations → identity → definitions → planner → executor/diagnostics → result sets/stores → run lifecycle → engine facade), each phase ending in a green, independently reviewable test suite. Nothing in the core imports the Viewer, `three`, or `collision/` internals.

**Tech Stack:** Node.js ESM (`.mjs` tests, `.js` modules), the existing `node --test` runner via `scripts/run-tests.mjs` (discovers every `*.test.mjs`), no new runtime dependencies.

**Spec (frozen core design):** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../specs/2026-09-20-federated-clash-test-and-results-design.md) — read together with the convergence authority [`docs/reviews/2026-09-20-federated-clash-test-and-results-convergence-review.md`](../../reviews/2026-09-20-federated-clash-test-and-results-convergence-review.md). Where this plan and the spec disagree on an *externally observable safety invariant*, the spec wins and the plan has a defect. Where the spec's §25 history or an implementation-level mechanism is silent or over-specified, the plan's phase file decides (convergence review §2).

**Status:** DRAFT — ready for plan review. Not authorized for implementation until the plan-review gate (§6) is passed and the scope decision "core-only" is recorded by the milestone owner. No code has been written.

## Global Constraints

Copied from the spec / repo; every task inherits them.

- **No collision-core change.** `collision/` is read-only for this plan (spec D1, §19.1, §21.2). The engine calls `world.findClashes` and the documented public accessors only; it never reaches a `_`-prefixed member or a module internal.
- **Layering:** `clashtest/` core imports nothing from `wwwroot/`, the Viewer, `three`, or `collision/` internals (spec §2.1). Only `clashtest/viewer/` (out of scope here) may touch Viewer APIs.
- **Module system:** ESM (`"type": "module"`); modules `.js`, tests `*.test.mjs` under `test/clashtest/**` (the existing runner discovers them; `npm test` must stay free of any live server or APS credentials — spec §21.3).
- **Plain data at every boundary:** definitions, unit descriptions, `UnitOutcome`, Result Sets are structured-clone / JSON safe; no `Model`, `loadEpoch`, `modelId`, `fragmentId`, `geometryIndex` in durable data (spec D3, D11, §13.4).
- **Fail-closed semantics:** missing work is a gap, incomplete evidence is a caveat, unknown diagnostic reasons are completeness-affecting, an empty result alone never proves absence (spec D7, D10).
- **Defaults live in one place:** spec §17.1 is the single source of provisional default values; `clashtest/options.js` (P0) is the single code home; tests import defaults from it and never hard-code numbers (convergence errata item 3). All caps remain **provisional** until the AC-12 calibration gate (G-CAL) closes.
- **Injectable time/scheduling seams:** every module that measures time or yields takes `now` / `yieldToScheduler` (spec §18) so tests run with a fake clock; no wall-clock sleeps in tests.
- **TDD discipline:** RED → GREEN → commit for every task. Commits only on explicit user authorization (project CLAUDE.md); the per-task "Commit" steps below are *checkpoints for an authorized executor*, not standing permission.
- **Hard/Soft:** one collision mode per test; `clearance` requires a caller-supplied finite positive `clearance`; the library has no default (spec F10).
- **Provisional numbers:** `frameBudgetMs = 8`, `maxFragmentsPerDbId = 5,000`, `maxCollisionInstancesPerEpoch = 20,000` etc. are inherited from `collision/constants.js`; the engine may not hard-code copies of them.
- **Handoff:** every phase that materially changes project state updates `docs/handoffs/latest.md` (project CLAUDE.md "Agent Handoff Convention").

---

## 1. Scope

### 1.1 In scope (the core engine)

Spec sections implemented: §4 identity, §5 definitions (in-memory `ClashTestStore`), §6 planning (over the `ElementEnumerator` *port*), §7 execution, §8 lifecycle/outcome/claim rule, §9 progress, §10 cancellation, §11 results, §12 diagnostics, §13 durable Result Set (sealing, serialization, `ResultStore` port with the **in-memory reference implementation**, resident bound, untrusted-read validation, schema evolution), §15.3 rerun and §15.1 determinism metadata, §16 stale/epoch/freshness/settlement, §17 caps and option validation, §18 engine facade, §21.3 CHANGELOG/README/handoff.

### 1.2 Excluded from this plan (separate artifacts; not blockers for core)

| Excluded area | Where it goes | Why |
|---|---|---|
| Viewer adapter: `ElementEnumerator` Viewer implementation, `ModelRegistry` Viewer wiring, owner-mapping | OQ-4 research artifact → later adapter plan (`clashtest/viewer/`) | OQ-4 live evidence does not exist; core plans over the port with a fake enumerator (convergence §3). |
| Remote/server-backed persistence: ambiguous-commit reconciliation (`reconcileTimeoutMs`, `PersistenceOutcomeUnknownError` reconcile loop), detached disposal of in-flight remote writes, remote listing/pagination behavior | Focused persistence design **only if** remote persistence is in v1 | Convergence §2 "Persistence attempt state machine"; distributed protocol deserves its own design. The core keeps the `ResultStore` port transactional; the error type and a port-conformance suite are in P5 so a remote backend can be added later without core change. |
| Annotation layer (§14.5 `ElementAttributeSource`, `engine.annotate`) | Annotation/derivation follow-up spec or plan | Convergence §2 "Annotation lifecycle". Facets that need annotations are `unavailable` until then. |
| Facet/`groupBy`/`filter`/`compareResultSets` async derivation machinery (§14.2–§14.4, §15.4) | **P8 (deferrable, not on the critical path)** — kept in this plan so the engine surface in §18 has an owner, but **core acceptance (§5 Definition of Done) does not require P8** | Convergence §2 "Derivations and comparison"; scheduler ownership is an implementation choice made in P8 and can be split into its own plan. |
| Product decisions: OQ-1 identity witnesses, OQ-16 hierarchy acceptance, OQ-17 placement owner, OQ-19 bracketed-proof policy, browser memory/stall budget | Decision records (owner: product/Host) | Core is parameterized over each (see gates, §4). |
| Calibration values (AC-12 memory/stall, schema ceilings, scheduler makespan) | Measurement artifact | Values require measurement, not prose; core ships provisional defaults flagged as such. |
| Viewer Clash Panel UI, workflow/status, approvals | Panel | Spec §20, §23. |
| M4 Phase 4 / workers / transferables | Not authorized | Spec D15, §17.5. |

---

## 2. Module map and cross-phase contract

All paths are repo-relative. Each module has exactly one owning phase; a consumer lists the interface in its task's **Consumes** block and must not re-implement it.

```text
clashtest/
  index.js                      public exports (P7)
  engine.js                     createClashTestEngine (P7)
  errors.js                     every typed error of spec §18 (P0)
  options.js                    RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS, resolveRunOptions, resolveEngineLimits,
                                producer/reader invariant (P0)      ← spec §17.1 / §17.1.1 single source of defaults
  util/capture.js               descriptor-based detached capture (spec §5.3 algorithm) (P0)
  util/canonical.js             canonical JSON + digest (spec §5.4, §13.4) (P0)
  util/slicer.js                sliced-work helper over now/yieldToScheduler (P0)
  identity/ModelRegistry.js     ModelRegistry, binding, snapshotBindings, registrySessionId (P1)
  identity/ids.js               ElementRef key, makePairId, makeResultId, symmetry class (P1)
  definition/validate.js        validateTest (pure, never throws for data errors) (P2)
  definition/normalize.js       normalization to root antichain inputs, semanticDigest (P2)
  definition/operations.js      store-bound §18 definition surface: validateTest/saveTest/getTest/
                                listTests/archiveTest; P7's engine delegates to it (P2)
  stores/InMemoryClashTestStore.js  ClashTestStore reference impl incl. resolveForRun/isTombstoned (P2)
  planning/ElementEnumerator.js port contract + JSDoc + conformance helper (P3)
  planning/scopeDigest.js       scope digests (spec §6.2.1), compareScopeExpectation, and
                                checkScopeBracket — the ONE re-digest-and-compare bracket half,
                                consumed by P4 (per unit) and P6 (read time) (P3)
  planning/planner.js           createPlan/planRun facade, materializeUnit, rootsForRanges (P3)
  planning/rootResolution.js    selection → root antichain resolution (P3)
  planning/owners.js            owner mapping, reachability/hierarchy-internal classification (P3)
  planning/decompose.js         the three-cell decomposition of §6.3 (P3)
  planning/sizing.js            unit sizing and target-side bounds (§6.4 H2/M7) (P3)
  planning/planTables.js        run-scoped plan tables (roots, models, ranges) (P3)
  planning/ledger.js            RecordBudget, coverage ledger, UnitRecord classes, toLedgerRecord (P3)
  planning/splitting.js         planSplit/splitUnit, SPLIT_REFUSAL_REASONS (P3)
  execution/UnitExecutor.js     port contract + closed DTO schemas (ExecutionRequest / UnitOutcome) (P4)
  execution/LocalUnitExecutor.js  the one findClashes call + error taxonomy (spec §7.2, §7.5) (P4)
  execution/diagnostics.js      NormalizedDiagnostic / ProjectedDiagnostic, isCompletenessAffecting, dedup/caps (P4)
  results/resultSet.js          ResultSet construction, sealing, provenance (P5). The deep-freeze
                                helper itself is P0's (`util/capture.js` :: deepFreeze /
                                deepFreezeSliced); P5 calls it and owns no copy
  results/validateResultSet.js  untrusted-read contract, CorruptResultSetError (P5)
  results/claim.js              assessNoClashClaim, canClaimNoClashes, freshnessStateOf (pure) (P5)
  results/status.js             getPairStatus / getElementStatus / createStatusReader / readLedger —
                                the ONE §12.5 taint rule and the sealed-ledger layout reader (P5;
                                P8 re-exports, never re-implements)
  results/InMemoryResultStore.js  ResultStore reference impl incl. tombstoneTest, byte-guard (P5)
  results/residency.js          resident bound, retain/release, persistence state (P5)
  run/coordinator.js            world-scoped run coordinator (one engine run at a time per world) (P6)
  run/Run.js                    RunHandle, state machine, progress, cancellation (P6)
  run/emitter.js                throttled progress / state / unit / persistence emission, listener
                                isolation (P6)
  run/freshness.js              getFreshness read-time three-snapshot loop, placement generation (P6).
                                The per-unit scope bracket is NOT here — see planning/scopeDigest.js
  run/settlement.js             terminal-status precedence (spec §16.7) (P6)
  derive/*                      facets, groupBy, filter, summarize, compare (P8, deferrable)
test/clashtest/**/*.test.mjs    mirrors the tree above
test/clashtest/support/         shared fakes (P0): fake world, fake enumerator, fake registry, fake clock
```

### 2.1 Cross-phase interface rules

1. **The owning phase's "Produces" block is the contract.** Names in §18 of the spec are the public names; internal names are chosen by the owning phase and listed in its Produces block.
2. **Closed DTOs.** Every plain-data DTO (definition, `ExecutionRequest`, `UnitOutcome`, `ProjectedDiagnostic`, `NormalizedDiagnostic`, `RunOutcome`, `ResultSet`) has exactly one schema module and a `validate*` function; consumers call it rather than duck-typing.
3. **Two diagnostic DTOs** (errata item 2): `ProjectedDiagnostic` (per-unit executor projection, P4 `execution/diagnostics.js`) and `NormalizedDiagnostic` (stored, aggregated across units, P4 `execution/diagnostics.js`, consumed by P5/P6). A projection→aggregation function is the only bridge.
4. **`result.mode`** (errata item 1): a persisted `ClashResult` carries `mode`; nothing in the plan checks `result.type`.
5. **Shared test support** lives only in `test/clashtest/support/` (P0). Later phases add to it; they do not fork it.
6. **The reconciled cross-phase signature register is [`federated-clash-test-core/interface-reconciliation.md`](federated-clash-test-core/interface-reconciliation.md).** Where a phase file's `Assumed` / `Consumes` block and the owning phase's *Phase interface summary* disagree, that file records the decision and the edit applied. It is the authority for every cross-phase name; P7 Task P7.1 verifies it rather than re-deriving it.

---

## 3. Phase index and dependency graph

| Phase | Title | Spec | Depends on | Phase file |
|---|---|---|---|---|
| **P0** | Foundations: errors, options/limits, capture, canonical/digest, slicer, test support | §5.3 capture, §5.4, §13.4, §17.1, §17.1.1, §18 errors | — | [p0-foundations](federated-clash-test-core/p0-foundations.md) |
| **P1** | Identity: `ModelRegistry`, `ElementRef`, `PairId`, `ResultId` | §4 | P0 | [p1-identity](federated-clash-test-core/p1-identity.md) |
| **P2** | Definitions, validation, in-memory `ClashTestStore`, lifecycle | §5 | P0, P1 (real edge: `validate.js` imports `CLASH_MODES` / `pairSemanticsOf` from `identity/ids.js`) | [p2-definitions](federated-clash-test-core/p2-definitions.md) |
| **P3** | Planner: enumerator port, scope digests, three-cell decomposition, splitting, ledger | §6, §5.6 | P0, P1, P2 | [p3-planner](federated-clash-test-core/p3-planner.md) |
| **P4** | Executor and diagnostics: `UnitExecutor`, `LocalUnitExecutor`, error taxonomy, diagnostics | §7, §11.2, §12 | P0, P1, **P3** (unit description DTO + `planning/scopeDigest.js` bracket half) | [p4-executor-diagnostics](federated-clash-test-core/p4-executor-diagnostics.md) |
| **P5** | Result Set: results, sealing, `validateResultSet`, claim rule, in-memory `ResultStore`, residency/persistence | §8.3, §11, §13 | P0, P1, P2, P4 | [p5-result-set](federated-clash-test-core/p5-result-set.md) |
| **P6** | Run lifecycle: coordinator, state machine, progress, cancellation, freshness, settlement | §8, §9, §10, §16 | P3, P4, P5 | [p6-run-lifecycle](federated-clash-test-core/p6-run-lifecycle.md) |
| **P7** | Engine facade, rerun, differential/integration tests against the real `CollisionWorld`, docs | §15.1/§15.3, §18, §19, §21.3, §22 | P0–P6 | [p7-engine-integration](federated-clash-test-core/p7-engine-integration.md) |
| **P8** | Derivations (deferrable): summarize, facets, groupBy, filter, compare | §14.2–§14.4, §15.4 | P5 (P7 for engine binding) | [p8-derivations](federated-clash-test-core/p8-derivations.md) |

```text
P0 ──► P1 ──► P2 ──► P3 ─────────┐
 │      │                       ▼
 │      └──────────────► P4 ──► P6 ──► P7 ──► (core DoD)
 │                       │      ▲
 └───────────────────────┴─► P5 ┘
                              └──────────────► P8 (deferrable, after P5; engine binding after P7)
```

Parallelizable after P2: **P3 ∥ P4** and **P5 ∥ P3/P4** once P4's `NormalizedDiagnostic` schema lands. P6 needs all of P3, P4, P5. P8 can start any time after P5 and never blocks P7.

**P3 → P4 is a real module edge** (reconciliation file, duplicate-ownership D1): P4's `LocalUnitExecutor` imports `compareScopeExpectation` and `checkScopeBracket` from P3 `planning/scopeDigest.js` and reads its `scopeExpect` out of `materializeUnit(plan, unit)`. P4 can still be started in parallel with P3 because P3's Task P3.2 (`planning/scopeDigest.js`) is one of its first tasks and P4.8 is one of its last; only P4.8 is blocked. **There is no P4 → P6 edge**: the bracket half P6 originally planned in `run/freshness.js` moved to P3, so nothing in `execution/` imports `run/`.

---

## 4. Gate register

A gate blocks **only the work package named in "Blocks"**; everything else proceeds. "Core" means P0–P7.

| Gate | Kind | Blocks | Does **not** block | Core treatment |
|---|---|---|---|---|
| **G-PLAN** — plan review passed and "core-only" scope recorded by the milestone owner | Process | Start of P0 implementation | Authoring, plan review | Handoff records "ready for plan review". |
| **G-OQ4** — OQ-4 Viewer owner-mapping/enumeration evidence artifact | Research | The Viewer-adapter work package (out of this plan) | All of P0–P8 | Planner tested against a fake `ElementEnumerator` satisfying the port conformance helper (P3). |
| **G-OQ1** — durable `modelKey`/`modelVersion` witness derivation (product/Host) | Product | Viewer adapter, Panel wiring | P0–P8 | Core takes host-supplied opaque `modelKey` + `modelVersion`; tests use fixtures. |
| **G-OQ17** — placement-invalidation owner | Product | Host integration | P0–P8 | Core exposes `invalidateModelPlacement`; freshness fails closed on unreported changes it can detect. |
| **G-OQ16** — hierarchy-internal acceptance policy | Product | Enabling a *qualified* claim in a Host build | P0–P8 | Engine option `hierarchyInternalAcceptance` defaults `null` (unaccepted ⇒ claim blocked); P5/P7 test both branches. |
| **G-OQ19** — bracketed-proof tightening review | Product (non-gating) | Nothing | Everything | Spec §8.3 fixes the standing policy; no work. |
| **G-CAL** — AC-12 memory/synchronous-capture/stall measurement + product-confirmed browser budget | Calibration | **Promoting provisional caps and schema ceilings to deployable defaults** (P0 task "freeze defaults", P5 ceilings) | All functional work | Defaults ship as documented provisional values; the measurement harness/test at calibrated ceilings is specified in P7 (task "maximum-shape round trip") and executed when G-CAL supplies numbers. |
| **G-REMOTE** — remote persistence in v1? | Product | The remote-persistence follow-up package (excluded) | All of P0–P8 | Local transactional `ResultStore` only. |
| **G-RESP** — responsiveness target/device scope confirmation (carried over from M4) | Product | Any *responsiveness claim* | All functional work | Responsiveness figures are characterization-only (spec D16). |
| **G-LEDGER-CLS** — RESOLVED by plan ruling (§8 OPEN-2): the digested sealed-ledger `rootOwners` rows carry the per-root class marker `cls` (Codex P5 review; nothing is implemented yet, so it is a one-field schema choice, and the alternative under-reports element-level hierarchy caveats). Retained here so the reversal cost is visible: removing it later costs a ledger `schemaVersion` bump. | Plan ruling | — | — | P3 emits `cls`; P5 pins and digests it; P8 reads it via `readLedger`. |

---

## 5. Definition of Done for the core (what "core ready" means)

Core-engine milestone is done when **all** of the following hold; P8 and every excluded item are not required:

1. P0–P7 phase acceptance checklists pass (each phase file ends with one).
2. `npm test` passes from a clean checkout with no server, no APS credentials, no network.
3. Every spec acceptance criterion in §22 (AC-1 … AC-21) that falls inside §1.1 above is mapped to at least one named test in the AC traceability table in `p7-engine-integration.md`, and each mapped test passes. AC items that are entirely inside an excluded area (annotation AC-13 parts, remote persistence, Viewer live evidence AC-17 live parts) are listed there as **deferred with owner**, not silently dropped.
4. The differential suite (P7) shows engine-over-real-`CollisionWorld` equals a brute-force reference on the shared fixtures for all four modes, for same-model, cross-model, whole-model-target and whole-model-source (via the fake enumerator) selections.
5. Coverage exact-cover property test (P3) passes over the seeded random-selection generator with the ledger sum equal to the required pair space.
6. `docs/handoffs/latest.md`, `CHANGELOG.md`, `README` pointer updated (spec §21.3).

## 6. Plan-review gate and process

- Internal Codex review of **this plan** (not of the design spec) is permitted once per phase-file batch; it does not restart the design-spec review loop. Findings that require a design change are recorded as *follow-up spec items*, not applied to the frozen spec.
- After internal review, the plan is marked "ready for independent ChatGPT Work review" in `docs/handoffs/latest.md` (project CLAUDE.md).
- **Unresolved-at-plan-time items** are recorded in each phase file under "Open items for implementation" with the work package they gate; none may be silently resolved by an implementer contrary to the spec.

## 7. AC → phase map

**The authoritative AC → test map is the `## AC traceability (spec §22)` table in [`p7-engine-integration.md`](federated-clash-test-core/p7-engine-integration.md).** It names, for every AC-1 … AC-21, the exact test file and test name that satisfies it, or the deferred owner and the gate. Nothing else in this plan restates it; the table below is a navigation aid only and is subordinate to P7's.

The earlier summary here mis-numbered eight rows against spec §22. Corrected primary phases:

| Spec AC (§22 numbering) | Primary phase(s) |
|---|---|
| AC-1 definition validation, options, store, tombstone | P2, P0 (options), P7 (`deleteTest` order) |
| AC-2 planner exact cover, hierarchy, scope-digest conformance, unresolved selections | **P3** |
| AC-3 executor DTO closure, outcome validation, overflow, library-call conformance | P4, P7 (call conformance) |
| AC-4 partition and broad-phase independence | **P7** (differential suite) |
| AC-5 single-query equivalence | **P7** (differential suite) |
| AC-6 determinism | **P7** (T2 arm); T3 reload arm deferred to the Viewer adapter (G-OQ4) |
| AC-7 cancellation | P6, P7 |
| AC-8 engine-bound claim, source bracket, read-time freshness | P6, P5, P7 |
| AC-9 progress | **P6** (+ P3 split parts) |
| AC-10 diagnostics and completeness | P4, P5 |
| AC-11 serialization and persistence | P5, P6, P7 |
| AC-12 memory and span ceilings | P7 harness + **G-CAL** |
| AC-13 grouping, filters, facets, annotation lifecycle | **P8** + annotation follow-up |
| AC-14 comparison | **P8** (deferrable) |
| AC-15 live acceptance on the Audubon fixture | **deferred** — Viewer-adapter live evidence (G-OQ4/G-OQ1/G-OQ16); never in `npm test` |
| AC-16 resident bound and identity enforcement | P5, P1, P3, P2, P7 |
| AC-17 mixed reachable/unreachable owner | P3, P5, P7 |
| AC-18 target fan-out bounded before the first call | **P3 + P7** |
| AC-19 epoch cache, placement contention, geometry readiness | P4, P6, P7 |
| AC-20 hierarchy-internal exclusions through the claim helper | P3, P5, P7 |
| AC-21 settlement precedence | P6, P7 |

---

## 8. Plan-level rulings on the reconciliation's open items

Source: [`interface-reconciliation.md`](federated-clash-test-core/interface-reconciliation.md) §(iv). These are **plan-level** rulings (the spec is frozen and untouched). Rulings marked *confirm* are the controller's default and remain open to the milestone owner at the plan-review gate.

| Item | Ruling | Effect |
|---|---|---|
| **OPEN-1** `startRun` throws vs. rejects | **Narrow reading (confirm).** `startRun` returns a `RunHandle`, so it throws synchronously (`InvalidTestDefinitionError`, `InvalidOptionsError`, `ResultCapacityError`, `EngineDisposedError`). The R19-1 "reject, never throw" rule applies only to Promise-returning entry points (`rerun`, `getFreshness`, both claim methods, derivations). | No change to P2.1 / P5.8 / P7.4. |
| **OPEN-2** per-root `cls` marker in the sealed ledger | **Option (a): persist and digest `cls` on the ledger `rootOwners` rows.** P3 emits it, P5 pins it in the ledger schema and digest, P8 reads it only through P5's `readLedger`. The bounded-examples fallback (c) is dropped. | G-LEDGER-CLS resolved. |
| **OPEN-3** `derivations` key / `isDisposed()` | **Core engine ships without `derivations`/`annotate`; `exports.test.mjs` pins their absence; P8.8 legitimately edits that one test and adds the key, `isDisposed()` accessor and resolved-limits access as an additive change.** P7 need not reserve the key. | P8.8 only. |
| **OPEN-4** `COMPARE_TOLERANCE_DEFAULTS` location | **Strict reading.** Move `{distanceTolerance, pointTolerance}` (`1e-6`) into `clashtest/options.js` beside the other defaults (flag provisional); `derive/compare.js` imports them. | One-line change in P8 implementer item 5 when P8 is scheduled. |

## 9. Standing rules for executors

- **Frozen spec.** Do not edit the design spec. Seven items are recorded as *PROPOSED SPEC ERRATUM — needs user authorization to reopen* in the reconciliation's Spec issues register; each has a plan-level workaround, so none blocks P0. Reopening any of them needs the user's explicit authorization (project `CLAUDE.md`, Review boundary).
- **Interface authority.** Where a phase file's text disagrees with the reconciliation register, the register (and the producer phase's *Phase interface summary*) wins. P7.1 re-checks this before implementation begins.
- **Highest-risk reconciled interfaces** (silent wrong answers if regressed): `splitUnit` refusal value (N17), `Binding.dead` fail-closed (N10), `ModelBindingError.reason` (N1), single-owner scope bracket (D1, in P3), lease gate (D2), diagnostics aggregation (D3), `getPairStatus`/`getElementStatus` (D4, in P5), capture-function homes (N29).

## 10. Plan review history (for the independent gate)

Two Codex rounds each on P6 and P5 (records in `docs/reviews/2026-09-20-core-engine-plan-p{5,6}-*codex-review.md`); all findings remediated; no Codex round after the final remediation. P0–P4, P7, P8 have had conformance sweeps and scratch execution only. Line counts at this checkpoint are ~23,000 across the ten phase/reconciliation files — the independent reviewer should start from §3–§9 here and then P6, P5, P3, P7. Implementation is not authorized until G-PLAN.
