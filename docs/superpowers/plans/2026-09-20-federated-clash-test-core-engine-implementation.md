# Federated Clash Test & Results — Core Engine Implementation Plan (master)

> **For agentic workers:** Execution workflow (optional recommendation): an agent environment that provides the `superpowers:subagent-driven-development` or `superpowers:executing-plans` skill may use it, but no skill is required. Repository-native fallback (sufficient on its own): execute the tasks in order, run each task's RED then GREEN steps, run the phase verification section, and tick this plan's own checkboxes (`- [ ]`) as you go. Steps use checkbox (`- [ ]`) syntax for tracking. This master document is the index, dependency graph, gate register and cross-package contract. The task-level work lives in the per-phase files listed in §3; an executor reads this master first, then only the phase file it is executing.

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
| **P4** | Executor and diagnostics: `UnitExecutor`, `LocalUnitExecutor`, error taxonomy, diagnostics | §7, §11.2, §12 | P0, P1, **P3** (unit description DTO + `planning/scopeDigest.js` bracket half). **Task-level:** only P4.8 has a P3 production import (P3.2); see the task-level edge table below | [p4-executor-diagnostics](federated-clash-test-core/p4-executor-diagnostics.md) |
| **P5** | Result Set: results, sealing, `validateResultSet`, claim rule, in-memory `ResultStore`, residency/persistence | §8.3, §11, §13 | P0, P1, P2, P4 (task-level: only P4.1's `isCompletenessAffecting` is imported, by P5.6), **P3** (contract only: P5 pins the sealed-ledger shape and the `cls` literals that P3 must emit; no P3 production import) | [p5-result-set](federated-clash-test-core/p5-result-set.md) |
| **P6** | Run lifecycle: coordinator, state machine, progress, cancellation, freshness, settlement | §8, §9, §10, §16 | P3, P4, P5 | [p6-run-lifecycle](federated-clash-test-core/p6-run-lifecycle.md) |
| **P7** | Engine facade, rerun, differential/integration tests against the real `CollisionWorld`, docs | §15.1/§15.3, §18, §19, §21.3, §22 | P0–P6 | [p7-engine-integration](federated-clash-test-core/p7-engine-integration.md) |
| **P8** | Derivations (deferrable): summarize, facets, groupBy, filter, compare | §14.2–§14.4, §15.4 | P5 (P7 for engine binding) | [p8-derivations](federated-clash-test-core/p8-derivations.md) |

```text
P0 ──► P1 ──► P2 ──► P3 ═══════════════► P6 ──► P7 ──► (core DoD)
 │      │             ┆  P3.2 ⇒ P4.8       ▲ ▲
 │      └──────────► P4 ══════════════════╯ │
 │                    ┆  P4.1 ⇒ P5.6        │
 └────────────────────┴────────────────► P5 ╯
                                          └──► P8 (deferrable, after P5; engine binding after P7)
```

`══►` / `──►` are phase-level edges (the **Depends on** column; a phase is *complete* only when all its producers are). `┆` marks the only **task-level** release edges that let a consumer phase start before its producer phase is complete; each still implies the phase-level completion order (P3 complete before P4 is complete; P4 complete before P5 is complete; P3 contract-only into P5). The graph is the phase-level view, and the task-level table below is what an executor schedules from. If task-level scheduling is not wanted, run strictly **P3 → P4 → P5** — that order is always safe.

**Task-level early-start edges (established from each phase file's *Consumes* blocks and import lines):**

| Consumer task(s) | May start when | Released by (producer checkpoint) | Basis |
|---|---|---|---|
| **P4.1–P4.7, P4.9** | P0 and P1 complete (P3 may still be in progress) | none from P3 | No P4 file outside P4.8 imports `planning/`. P4.4's ledger-budget oracle `admit(n)` is injected by P6 (default `() => true`); P4.5/P4.6 build requests through P4's own `support/executionRequests.mjs` fixture and follow the `WorkUnit` / `materializeUnit(...) → {sourceDbIds, targets, scopeExpect}` rows of **P3's already-written *Phase interface summary*** (shape only). If P3 changes those rows, P4.5 is re-checked at the P3.9 checkpoint |
| **P4.8** (lease handling and bracketed scope-digest protocol) | **P3.2 complete** (`planning/scopeDigest.js`; P3.2 in turn needs P3.1's enumerator-port validators, so "P3.1–P3.2 complete") | P3.1–P3.2 done | Only production import in P4 from P3: `checkScopeBracket` from `../planning/scopeDigest.js` (P4.8). P4 does **not** import `compareScopeExpectation` |
| **P5.1–P5.5, P5.7, P5.8** | P0, P1, P2 complete | none from P3/P4 code | P5 has **no** production import from `planning/` or `run/`; its tests use P5-local fixtures (`test/clashtest/support/resultSetFixtures.mjs`). P5.1/P5.2/P5.5 read `UnitOutcome`/`DiagnosticsSummary`/`NormalizedDiagnostic` as **shapes** from P4's summary, so P5.5's structural table is conformance-checked against P4.9 (`NormalizedDiagnostic`) and P4.5 (`UnitOutcome`) when those tasks are done, not imported |
| **P5.6** (pair/element status) | **P4.1 complete** | P4.1 done | Sole production import from P4: `isCompletenessAffecting` from `../execution/diagnostics.js` |
| **P5.9** (round-trip acceptance) | P5.1–P5.8 complete | P5.1–P5.8 done | Harness over P5's own exports |
| **P5 ↔ P3 (contract only)** | n/a — no code wait | P3.4 (owner-class `ROOT_CLASS` literals) and P3.8 (ledger record classes) are checked against P5's pinned ledger schema at the **P3.9** checkpoint | P5 pins the sealed-ledger JSON and the `cls` marker (OPEN-2); P3 must emit exactly that shape. A mismatch is fixed on the P3 side (P5 owns the shape) |
| **P6 (all tasks)** | P3, P4 and P5 **all complete** | P3.9, P4.9, P5.9 | P6 wires every P3/P4/P5 export together; no early start is claimed |

The earlier sentence "P3 ∥ P4 and P5 ∥ P3/P4" is therefore made precise as: P4.1–P4.7/P4.9 ∥ P3; P4.8 waits for P3.1–P3.2; P5.1–P5.5/P5.7/P5.8 ∥ P3 and P4; P5.6 waits for P4.1. Nothing else overlaps.

**P3 → P4 is a real module edge** (reconciliation file, duplicate-ownership D1): P4's `LocalUnitExecutor` imports `checkScopeBracket` from P3 `planning/scopeDigest.js` (which itself folds `compareScopeExpectation`) and reads its `scopeExpect` out of `materializeUnit(plan, unit)`. That is why P4's row lists P3; the early start above is possible because P3's Task P3.2 is one of its first tasks and P4.8 is one of its last. **There is no P4 → P6 edge**: the bracket half P6 originally planned in `run/freshness.js` moved to P3, so nothing in `execution/` imports `run/`.

---

## 4. Gate register

A gate blocks **only the work package named in "Blocks"**; everything else proceeds. "Core" means P0–P7.

| Gate | Kind | Blocks | Does **not** block | Core treatment |
|---|---|---|---|---|
| **G-PLAN** — plan review passed and "core-only" scope recorded by the milestone owner | Process | Start of P0 implementation | Authoring, plan review | Handoff records "ready for plan review". Checkable via the **G-PLAN acceptance record** in §6 (lines a–e; all five checked and owner-recorded 2026-09-21 — scope limited to core-only P0–P7 per line (b)). |
| **G-OQ4** — OQ-4 Viewer owner-mapping/enumeration evidence artifact | Research | The Viewer-adapter work package (out of this plan) | All of P0–P8 | Planner tested against a fake `ElementEnumerator` satisfying the port conformance helper (P3). |
| **G-OQ1** — durable `modelKey`/`modelVersion` witness derivation (product/Host) | Product | Viewer adapter, Panel wiring | P0–P8 | Core takes host-supplied opaque `modelKey` + `modelVersion`; tests use fixtures. |
| **G-OQ17** — placement-invalidation owner | Product | Host integration | P0–P8 | Core exposes `invalidateModelPlacement`; freshness fails closed on unreported changes it can detect. |
| **G-OQ16** — hierarchy-internal acceptance policy | Product | Enabling a *qualified* claim in a Host build | P0–P8 | Engine option `hierarchyInternalAcceptance` defaults `null` (unaccepted ⇒ claim blocked); P5/P7 test both branches. |
| **G-OQ19** — bracketed-proof tightening review | Product (non-gating) | Nothing | Everything | Spec §8.3 fixes the standing policy; no work. |
| **G-CAL** — AC-12 memory/synchronous-capture/stall measurement + product-confirmed browser budget | Calibration | **Promoting provisional caps and schema ceilings to deployable defaults** (P0 task "freeze defaults", P5 ceilings) | All functional work | Defaults ship as documented provisional values; the measurement harness/test at calibrated ceilings is specified in P7 (task "maximum-shape round trip") and executed when G-CAL supplies numbers. **The functional harness asserts slicing *structure* only** — yield/checkpoint occurrence, bounded per-slice work-item cadence, and the absence of size-dependent unsliced work — **and records span durations without any wall-clock threshold** (no comparison against `frameBudgetMs`, which is provisional). The calibrated `span ≤ frame budget` assertion, run on a calibrated environment profile, belongs to **this gate's** work package, so a functional core run can never be mistaken for AC-12 calibration evidence. |
| **G-REMOTE** — remote persistence in v1? | Product | The remote-persistence follow-up package (excluded) | All of P0–P8 | Local transactional `ResultStore` only. |
| **G-RESP** — responsiveness target/device scope confirmation (carried over from M4) | Product | Any *responsiveness claim* | All functional work | Responsiveness figures are characterization-only (spec D16). |
| **G-LEDGER-CLS** — RESOLVED by owner disposition (§8 OPEN-2) **and pinned in the spec by erratum A9 (2026-09-21)**: the digested sealed-ledger `rootOwners` rows are the v1 row `{rootDbId, ownerDbIds, cls}` (§5.6 item 2), and `rootOwners` incl. `cls` is in §13.1's `ledgerDigest` enumeration — at `schemaVersion` 1, because nothing v1 has been persisted. Retained here so the reversal cost is visible: removing `cls` later costs a ledger `schemaVersion` bump. | Plan ruling | — | — | P3 emits `cls`; P5 pins and digests it; P8 reads it via `readLedger`. |

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

### G-PLAN acceptance record

G-PLAN (§4) is satisfied only when **every** line below is checked by the milestone owner (or checked by an agent quoting a dated owner statement, with the location recorded on the line). **Checkpoint 2026-09-21:** (a), (c), (d), (e) are ticked by the owner's sign-off (Eason, 2026-09-21), and **(b) core-only implementation authorization (P0–P7) is ticked and recorded — owner Eason, 2026-09-21; all five lines (a)–(e) are now checked.** **Nothing in a review recommendation — internal Codex review, independent ChatGPT Work review, a handoff entry, or this plan's own text — fills in any line;** a recommendation is not an authorization (project `CLAUDE.md`, *Milestone and phase transition authorization*). Until all five lines — (a) through (e), including (b) — are checked, P0 implementation must not start; with all five checked, the authorization is limited to the scope recorded on line (b).

- [x] **(a) Plan review passed** — a plan review (`docs/reviews/…`) reports **no blocking (Critical/High) plan findings** against the current plan text. Review artifacts and result: `docs/reviews/2026-09-21-federated-clash-test-core-engine-implementation-plan-remediation-review.md` (original 1 Critical/3 High resolved; 3 High/2 Medium raised) and `docs/reviews/2026-09-21-federated-clash-test-core-engine-implementation-plan-targeted-rereview-closeout.md` (targeted re-review: no remaining blocking findings), plus the 2026-09-21 targeted checks of errata A2–A9 and the A8 single-rule consistency (no blocking findings after the recorded wording fixes). **OWNER SIGN-OFF: approved by Eason, 2026-09-21 (recorded from the owner's message; the ticked box is the owner's approval).**
- [x] **(b) Core-only authorization recorded** — the milestone owner has authorized starting **core-only** (P0–P7; P8 and every §1.2 exclusion stay out of scope). Recorded by (name) `Eason (milestone owner)`, date `2026-09-21`, location (handoff entry / review adjudication / chat quote) `chat quote — owner's message in the Claude Code session, 2026-09-21: "I authorize core-only implementation for P0–P7 under master §6(b)"; also recorded in docs/handoffs/latest.md`. **Authorized scope:** Federated Clash Test & Results core-only implementation, **P0–P7**. **NOT authorized by this line (each still requires its own explicit authorization or gate):** P8 (deferrable; outside the core-only gate); Viewer-adapter planning or implementation; OQ-4-dependent work (G-OQ4); host integration gated by OQ-1 / OQ-17 (G-OQ1, G-OQ17); remote persistence (G-REMOTE) unless separately authorized; hierarchy-qualified claim enablement before OQ-16 (G-OQ16); freezing deployment caps before G-CAL; responsiveness claims before G-RESP; M4 Phase 4 / worker work; reopening the frozen core design except under the project `CLAUDE.md` freeze exceptions. **This records authorization only — P0 has not been started.** **OWNER AUTHORIZATION: Eason, 2026-09-21.**
- [x] **(c) Owner dispositions of the two plan rulings recorded — BOTH RECORDED 2026-09-21** — (i) **OPEN-1**: **CONFIRMED by the milestone owner 2026-09-21 — Option A.** `startRun` stays **synchronous**: it returns a `RunHandle` or **throws synchronously**. Every Promise-returning API — **`rerun` included** — `getFreshness`, both claim methods and the deferred derivations **reject** and never throw. No change to P2.1 / P5.8 / P7.4. (ii) **OPEN-2**: **CONFIRMED by the milestone owner 2026-09-21 — Option A (= the plan's option (a)).** The per-root `cls` marker is **persisted and digested on every sealed-ledger `rootOwners` row**; P3 emits it, P5 pins/validates/digests it, P8 reads it only through P5's `readLedger`, and the bounded-`examples` fallback (option (c)) stays dropped. **G-LEDGER-CLS** is resolved by owner disposition, not merely by controller default. Recorded by/date/location: **recorded 2026-09-21 from the owner's message in the milestone-owner task that also carried line (d)'s errata authorizations.** **A9 AUTHORIZED 2026-09-21 — the OPEN-2 schema gap this line recorded is CLOSED and APPLIED.** The follow-up found by the post-disposition targeted check (OPEN-2 as confirmed makes `cls` a REQUIRED, validated, P8-interpreted and DIGESTED field, which spec §13.6's schema-evolution rule and §13.1's `ledgerDigest` enumeration did not then permit as a plan-only choice) was **authorized by the milestone owner on 2026-09-21** and applied as spec erratum **A9** (§25): §5.6 item 2 now defines the v1 row `{rootDbId, ownerDbIds, cls}` with `cls` the per-root planning class of §6.3 (`'A'` = `A'_m`, `'B'` = `B'_m`, `'C'` = `C_m = A_m ∩ B_m`), and §13.1 names `rootOwners` — **including `cls`** — in both the `Ledger` field list and the normative `ledgerDigest` enumeration. **`schemaVersion` stays `1`:** no v1 Result Set has been implemented or persisted in this repository, so this corrects the initial v1 contract rather than migrating a shipped one, and `schemaVersion: 2` was explicitly NOT introduced. `pairSetDigest` is unaffected; §6.5.1's record budget is unchanged (`cls` is inline on an existing row). P5's `cls` schema is therefore **unblocked**. **OWNER SIGN-OFF: approved by Eason, 2026-09-21 (recorded from the owner's message; the ticked box is the owner's approval).**
- [x] **(d) Owner disposition of the seven proposed spec errata recorded — ALL SEVEN ACCEPTED 2026-09-21 and APPLIED to the spec as errata rows A2–A8 (spec §25)** — the seven register entries **S-P2-1, S-P3-2, S-P4-1, S-P4-4, S-P5-2, S-P6-C3, S-P7-1** are no longer *proposed*; in each case the plan-level workaround is now the **owner-authorized reading**, and the accepted disposition is: (i) **S-P2-1 → A2** — `TestSummary` gains `name`, so the **four-field** closed shape `{testId, latestRevision, archived, name}` is authoritative and §5.5's three-field list is corrected (P2's `validateTestSummaryPage` validates four fields, unchanged); (ii) **S-P3-2 → A3** — the whole-model-sentinel eligibility condition **`A_n = ∅` applies to cell 1** as well as cell 2 in §6.3 (P3 decision D3, unchanged); (iii) **S-P4-1 → A4** — the **engine-side diagnostic aggregator** applies `maxDistinctReasons` and **owns `omittedReasonOccurrences`**, while the executor applies **only** the two whole-array caps of §7.1 (P4's binding decision, unchanged); (iv) **S-P4-4 → A5** — the completeness filter is **verdict-only, at §12.5 taint rule 1**; §12.2.1's per-unit taint table stays **unfiltered**, and a taint whose reason is not completeness-affecting is still listed in `caveats[]` (P4 records, P5 filters — unchanged); (v) **S-P5-2 → A6** — the reference store holds the **canonical JSON string**, not a `structuredClone` (P5.7, unchanged); (vi) **S-P6-C3 → A7** — **CLARIFIED, Option A:** `secondaryCauses` retains the **first 8 distinct** causes in **canonical** order; the truncation is **deterministic and expected**, `RunOutcome.reasons` remains the **complete** record, and spec §16.7 and AC-21 are reconciled to say so (P6 C3, unchanged); (vii) **S-P7-1 → A8** — **Promise-rejection semantics for `rerun`**, with the "throws" wording at §15.3 / §13.1 / §17.1.1 fixed (P7's reading, unchanged; `startRun` still throws synchronously — line (c) OPEN-1). No phase file's implementation steps change as a consequence of any of the seven. Recorded by/date/location: **recorded 2026-09-21 from the owner's message (the same message as line (c)); the errata are applied to the spec as §25 rows A2–A8 by the spec-side agent.** **Scope of erratum A8 — CONFIRMED by owner 2026-09-21.** A8 was applied to §4.2 (point 3), §15.3, §13.1, §17.1.1, §13.5.2 (`ResultCapacityError` delivery) and §22 AC-7 — the same `rerun`-rejects semantics, wider than the three sections named in the owner's original message — and the owner **confirmed the broader scope** on 2026-09-21 under one governing rule: **`startRun` remains synchronous and throws before a handle exists; `rerun` and every other Promise-returning §18 entry point report failures by REJECTING their Promise.** The same authorization covered a whole-spec sweep for residual “throws” phrasing on a Promise-returning entry point, which additionally corrected §5.5 (`deleteTest`, and the `StoreNotConfiguredError` list), §10.2 + §13.5.2 (the blanket “every method throws `EngineDisposedError`”), §13.5.2 (`discardRun` ⇒ `RunNotTerminalError`; `retryPersist` ⇒ `ResultNotResidentError`) and the matching §22 AC-11 clauses; those five are recorded in A8's own §25 row. **Plan-side sweep (same rule):** the P7/P5 prose and tests that still read “throws” for two Promise-returning entry points were corrected — `p7-engine-integration.md` Task P7.5 Step 1 now uses `await assert.rejects(engine.discardRun(…), RunNotTerminalError)` and `await assert.rejects(engine.retryPersist(…), ResultNotResidentError)` (they were `assert.throws`, contradicting P7's own disposed-surface split and §13.5.2), and the `retryPersist` legality prose in `p7-engine-integration.md` (P7.5 *Consumes*) and `p5-result-set.md` (P5.8 + *Gates and open items* item 7) now says **rejects**. `retainResultSet`/`releaseResultSet` stay synchronous throws. No other phase file's implementation steps change. **OWNER SIGN-OFF: approved by Eason, 2026-09-21 (recorded from the owner's message; the ticked box is the owner's approval).**
- [x] **(e) 2026-09-21 owner dispositions recorded and carried by the cited passing review** — **AC-16 erratum A1** (spec §5.5/§22 AC-16/§25 row A1, owner-authorized "Option 2": no durable field-level issue recording; `PlanningGap` unchanged; test = P7.4 Step 3a) and the two test owners **AC-19 (b′) = P7.8 Step 17a**, **AC-19 (d′) T2 = P7.8 Step 17b** (test names in the P7 AC traceability AC-19 row). The line-(a) review must have re-checked these three. The AC-16 `migration-failed` coverage gate (unreachable at definition schema v1) is **no longer an open owner question** — disposition **recorded 2026-09-21: ACCEPTED as a deferral, by the milestone owner**, in these exact terms: (i) `migration-failed` **remains** part of the forward-compatible failure taxonomy and stays a reserved, **DISTINCT** `PLANNING_CAUSES` member; (ii) it is **unreachable in the current `schemaVersion` 1 implementation scope** because no older definition schema and no migration registry exists; (iii) AC-16's migration-failure coverage (clauses (iii)/(iv)) is therefore **DEFERRED** until a real definition migration path exists; (iv) that deferred coverage **must not block** this core-engine implementation plan, Task **P7.11** core acceptance, or **G-PLAN**. The owner explicitly declined to add a definition-migration seam solely to make the cause reachable. **OWNER SIGN-OFF: approved by Eason, 2026-09-21 (recorded from the owner's message; the ticked box is the owner's approval).**

## 7. AC → phase map

**The authoritative AC → test map is the `## AC traceability (spec §22)` table in [`p7-engine-integration.md`](federated-clash-test-core/p7-engine-integration.md).** It names, for every AC-1 … AC-21, the exact test file and test name that satisfies it, or the deferred owner and the gate. Nothing else in this plan restates it; the table below is a navigation aid only and is subordinate to P7's.

The earlier summary here mis-numbered eight rows against spec §22. Corrected primary phases (the AC-16 row was corrected again on 2026-09-21: the §5.5 stored-reference admission conjunct is the **engine's**, not P2's — P2's own P2.8 decision says so — and the sweep added the P0 and P6 owners the row had lost):

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
| AC-16 resident bound and identity enforcement | P5, P1, P3, P0 (the ledger cross-field rule), P6 (shared coordinator), P7 (residency surface **and** §5.5 stored-reference admission *and validation* — its last open sub-conjunct was closed by owner disposition A1, below) |
| AC-17 mixed reachable/unreachable owner | P3, P5, P7 |
| AC-18 target fan-out bounded before the first call | **P3 + P7** |
| AC-19 epoch cache, placement contention, geometry readiness | P4, P6, P7 |
| AC-20 hierarchy-internal exclusions through the claim helper | P3, P5, P7 |
| AC-21 settlement precedence | P6, P7 |

---

## 8. Plan-level rulings on the reconciliation's open items

Source: [`interface-reconciliation.md`](federated-clash-test-core/interface-reconciliation.md) §(iv). These are **plan-level** rulings. **OPEN-1 and OPEN-2 are no longer controller defaults: the milestone owner CONFIRMED both on 2026-09-21 (Option A each), and the dispositions are recorded on line (c) of the §6 G-PLAN acceptance record** — whose box stays unchecked, because ticking it is the owner's own act. **OPEN-3 and OPEN-4 remain controller rulings** open to the owner at the plan-review gate.

| Item | Ruling | Effect |
|---|---|---|
| **OPEN-1** `startRun` throws vs. rejects | **Narrow reading — CONFIRMED by owner 2026-09-21 (Option A).** `startRun` returns a `RunHandle`, so it throws synchronously (`InvalidTestDefinitionError`, `InvalidOptionsError`, `ResultCapacityError`, `EngineDisposedError`). The R19-1 "reject, never throw" rule applies only to Promise-returning entry points (`rerun`, `getFreshness`, both claim methods, derivations). | No change to P2.1 / P5.8 / P7.4. |
| **OPEN-2** per-root `cls` marker in the sealed ledger | **Option (a) — CONFIRMED by owner 2026-09-21 (Option A): persist and digest `cls` on each sealed-ledger `rootOwners` row.** P3 emits it, P5 pins it in the ledger schema and digest, P8 reads it only through P5's `readLedger`. The bounded-examples fallback (c) is dropped. | G-LEDGER-CLS resolved by owner disposition, and the spec side is now **APPLIED as erratum A9** (2026-09-21): §5.6 item 2 defines the v1 row `{rootDbId, ownerDbIds, cls}` and §13.1 names `rootOwners` incl. `cls` in the `ledgerDigest` enumeration, at `schemaVersion` 1. |
| **OPEN-3** `derivations` key / `isDisposed()` | **Core engine ships without `derivations`/`annotate`; `exports.test.mjs` pins their absence; P8.8 legitimately edits that one test and adds the key, `isDisposed()` accessor and resolved-limits access as an additive change.** P7 need not reserve the key. | P8.8 only. |
| **OPEN-4** `COMPARE_TOLERANCE_DEFAULTS` location | **Strict reading.** Move `{distanceTolerance, pointTolerance}` (`1e-6`) into `clashtest/options.js` beside the other defaults (flag provisional); `derive/compare.js` imports them. | One-line change in P8 implementer item 5 when P8 is scheduled. |

**Owner disposition A1 — AC-16's stored-reference issues carrier (2026-09-21, "Option 2"; not a plan-level ruling but an *applied spec amendment*).** The one AC-16 sub-conjunct the 2026-09-21 H1 traceability sweep left open — §22 AC-16's requirement that the four §5.5 stored-reference failures record "at most 20 `{path, code}` issues" durably, which had no home in P5's closed sealed `PlanningGap` (`{phase, cause}`) — was **resolved by the milestone owner**, who authorized a narrow spec amendment rather than a schema widening. The durable field-level recording is removed; **P5's `PlanningGap` shape is unchanged and is not widened by any phase.** The contract P7 must still satisfy: validate with bounded work (`maxValidationIssues` scan bound), **fail closed before planning or collision execution**, seal `failed` with `definition: null` / `testRef.semanticDigest: null`, persist no invalid definition, offending value or field-level (`path`/issue-code) detail, and keep `definition-invalid` / `schema-unsupported` / `migration-failed` distinguishable. Applied as spec errata row **A1** (§5.5, §22 AC-16); registered as **S-P7-5** in the reconciliation's Spec issues register; tested by **Task P7.4 Step 3a**. It was the **first** erratum in that register to reach the spec; on the same date the owner authorized the remaining seven as well, applied as rows **A2–A8** (§6 line (d)), and later the same day the **A9** `rootOwners`/`cls` correction (§6 line (c), OPEN-2), so the register now holds **nine applied errata (A1–A9) and no proposed one**.

**Owner disposition — AC-16's `migration-failed` coverage gate (2026-09-21): ACCEPTED as a deferral.** The narrower coverage gate left inside disposition A1 was dispositioned by the milestone owner on the same date, and is **closed as an owner question**: `migration-failed` **remains** part of the forward-compatible failure taxonomy and stays a reserved, **DISTINCT** member of P3's `PLANNING_CAUSES`; it is **unreachable in the current `schemaVersion` 1 implementation scope** because no older definition schema and no migration registry exists anywhere in the plan; AC-16's migration-failure coverage (clauses (iii)/(iv)) is therefore **DEFERRED until a real definition migration path exists**. The owner **declined to add a definition-migration seam** — a host-facing `definitionMigrations` option, an internal sentinel error, or any other artificial producer — solely to make the cause reachable, because that would test dead protocol rather than stored-reference behaviour. **This deferral is recorded, owner-accepted and non-blocking: it must not block this plan, Task P7.11 core acceptance, or G-PLAN**, and Task P7.11's mechanical AC-traceability walk accepts it rather than reporting it as a plan defect. **Re-open trigger:** when a real definition migration path is introduced (`DEFINITION_SCHEMA_VERSION > 1` / an older definition schema plus a phase that owns the migration registry), the deferred arms are added — a lower-version definition with a registered migration that **throws**; a lower-version definition whose migration produces an **invalid** definition; and a lower-version definition with **no** registered migration ⇒ `migration-failed` — under the load-bearing resolution order **preflight version → migrate → `validateTest` on the migrated definition**. Until then the reachable arms and the `PLANNING_CAUSES.includes('migration-failed')` reserved-member assertion in Task P7.4 Step 3a are the whole of the required coverage. Recorded on §6 G-PLAN line (e) (which the owner still ticks separately).

## 9. Standing rules for executors

- **Frozen spec.** Do not edit the design spec. **The freeze rule itself is unchanged.** What changed on 2026-09-21 is that the register's erratum backlog is now **empty**: the milestone owner authorized **all eight** entries and they are **applied** as spec errata rows **A1–A8** (spec §25) — **A1** = **S-P7-5** (§5.5, §22 AC-16; see §8's *Owner disposition A1*), and **A2–A8** = **S-P2-1, S-P3-2, S-P4-1, S-P4-4, S-P5-2, S-P6-C3, S-P7-1** respectively (see §6 line (d) for each accepted disposition). The owner then authorized a **ninth** erratum the same day — **A9**, the OPEN-2 `rootOwners` row / `ledgerDigest` correction of §5.6 item 2 and §13.1 (see §6 line (c)) — so the applied set is **A1–A9** and the backlog is still empty. **No item in that register is *proposed* or *awaiting authorization* any more, and no executor may apply any further spec amendment without the same explicit owner authorization** (project `CLAUDE.md`, Review boundary). The plan-level readings those eight entries carried are now the owner-authorized readings, so no executor may quietly change one back.
- **Interface authority.** Where a phase file's text disagrees with the reconciliation register, the register (and the producer phase's *Phase interface summary*) wins. P7.1 re-checks this before implementation begins.
- **Highest-risk reconciled interfaces** (silent wrong answers if regressed): `splitUnit` refusal value (N17), `Binding.dead` fail-closed (N10), `ModelBindingError.reason` (N1), single-owner scope bracket (D1, in P3), lease gate (D2), diagnostics aggregation (D3), `getPairStatus`/`getElementStatus` (D4, in P5), capture-function homes (N29).

## 10. Plan review history (for the independent gate)

Two Codex rounds each on P6 and P5 (records in `docs/reviews/2026-09-20-core-engine-plan-p{5,6}-*codex-review.md`); all findings remediated; no Codex round after the final remediation. P0–P4, P7, P8 have had conformance sweeps and scratch execution only. Line counts at this checkpoint are ~23,000 across the ten phase/reconciliation files — the independent reviewer should start from §3–§9 here and then P6, P5, P3, P7. Implementation is not authorized until G-PLAN.
