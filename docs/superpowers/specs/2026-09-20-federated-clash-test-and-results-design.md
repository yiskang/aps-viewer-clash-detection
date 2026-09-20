# Federated Clash Test & Results — Design Spec

Status: **DESIGN SPEC — not an implementation plan.** No code, tests, or public library contract is changed by this document. Source of truth is the landed repository state (branch `feature/m4-performance-worker-decision-design`, HEAD `959a8a8` at authoring time), not older design text where the two differ.

Governing inputs (all read for this spec; claims about landed behavior are sourced from code and `collision/README.md`, then cross-checked against the specs):

- Roadmap: `docs/superpowers/specs/collision-library-roadmap.md` (§3 responsibility boundary, §4 binding compatibility constraints, §6 the scope list this spec formalizes, §8 architecture-change discipline).
- Latest status authority: `docs/research/m4-phase3-closeout-disposition.md` (M4 closed, **Verdict D**, Phase 4 not started/authorized) and `docs/handoffs/latest.md`.
- Library: `collision/index.js`, `collision/CollisionWorld.js`, `collision/scheduler.js`, `collision/errors.js`, `collision/constants.js`, `collision/viewer/ViewerModelAdapter.js`, `collision/README.md`.
- Specs: M1 (`2026-08-06-…-milestone1-design.md`), M2 (`2026-09-05-…-milestone2-design.md`), M2.1, M3 (`2026-09-07-…-milestone3-clearance-design.md`), M4 (`2026-09-08-…-milestone4-performance-worker-decision-design.md`), and the two 2026-09-11 fix specs (canonical ordering / operand symmetry; deterministic crossing budget).
- Consumer reference: `wwwroot/extensions/ClashFinderExtension.js`, `test/acceptance/clash-finder.acceptance.mjs`.

**Revision note (review round 1).** An independent `codex-review spec` pass (medium effort, request `20260920-034058-96286-27495`) found 5 critical/high and 9 further issues; every finding was checked against the repository before acceptance. The two most consequential (the second later superseded, see round 2 below) were confirmed as real defects in the first draft: the library's extraction walks each requested dbId's **whole subtree**, so dbId-set disjointness does not imply fragment-set disjointness (now §5.6 and §6, with a plan-time `hierarchy-overlap` rule), and whole-model *target* scope is re-extracted on every call, so a run-start snapshot cannot be promised for it (now §5.2/§16.3, with a drift guard). Others tightened the claim rule (§8.3), `ResultId` (§4.4), pair-level comparison (§12.5/§15.4), the snapshot boundary and world-scoped coordinator (§7.3/§16.1), pre-plan cancellation (§10.2), persistence settlement (§13.5.1), the validation matrix (§5.3), digest format (§5.4/§13.1), the result-cap boundary (§17.1), and executor injection (§18). Dispositions are in §25.

**Revision note (review round 2 — Work review).** Five findings from an independent Work review were addressed: (1) target-scope equality is now *proven per unit* by bracketed scope digests instead of a cumulative `placementCount` (§6.2.1, §16.3, F18); (2) unattributable `dbId: null` diagnostics are first-class and taint pair/run coverage (§12.2.1, §12.5, F17); (3) `modelKey` is defined as one immutable model version with mandatory `modelVersion` witness and three enforcement points (§4.2); (4) resident result sets are hard-bounded with explicit backpressure and no silent drop of unsaved state (§13.5.2); (5) `RunHandle.done`/`persisted` have disjoint one-shot semantics (§13.5.1). Dispositions are in §25.

This spec is the roadmap §6 "post-M4 formal specification". It does **not** reopen M1–M4, does **not** begin Phase 4 or any worker implementation, and does **not** define Viewer Clash Panel UI. Where it depends on a library behavior that is not yet a documented contract, it says so (§1.3) instead of assuming.

---

## 0. Decision summary

Every numbered decision below is normative and is developed in the section named. "Provisional" means chosen by reasoning, revisable by measurement, the same posture `collision/constants.js` already documents for its budgets.

| # | Decision | § |
|---|---|---|
| D1 | The layer is a **pure consumer** of `CollisionWorld`'s existing public surface. **No collision-core change is required.** It lives in a new sibling module (proposed `clashtest/`), Viewer-neutral at its core. | 2, 19 |
| D2 | A **Clash Test definition** is an immutable, revisioned, plain-data value (two selections + one library mode + `clearance` when soft). It holds **no** `Model`, `dbId`-of-a-different-model, epoch, or `modelId`. | 5 |
| D3 | Durable model identity is a host-supplied opaque **`modelKey`**, bound to the live `Model` object by a **`ModelRegistry`** at run time. **A `modelKey` identifies exactly one immutable model version/content identity, forever** (a retranslated or replaced model must get a new `modelKey`); the mandatory `modelVersion` content token is the enforcement witness, and the key→version pairing is checked at `register`, at `ResultStore.put`, and at compare/rerun time (§4.2). The engine never persists a `Model`, `loadEpoch`, `modelId`, `fragmentId`, or `geometryIndex` as identity. | 4 |
| D4 | Pair identity is **`PairId`**: canonical over `(modelKey, dbId)` refs, **unordered** for symmetric modes (`volume-overlap`, `surface-intersection`, `clearance`), **ordered** for `containment`. Result identity is `(testId, semanticDigest, PairId)`: stable across runs and sessions **of the same question over the same model versions**, and deliberately *different* when the mode, clearance or selections change (or, via a new `modelKey`, when model content changes), so workflow state can never silently transfer to a materially different question or alias across a retranslation. | 4.4 |
| D5 | Execution is **one `findClashes` call per Work Unit**, planned deterministically from the definition over **subtree roots** (the library extracts whole subtrees), using a **three-cell decomposition** that covers every required pair exactly once and never relies on same-model source/target overlap (the library's fragment-membership self-exclusion would silently drop it). Nested (ancestor/descendant) selection across the two roles is **not supported in v1** and fails planning with `hierarchy-overlap` rather than mis-covering. | 5.6, 6 |
| D6 | Units run **strictly sequentially, one engine run at a time per world** (a world-scoped coordinator shared by every engine over that world), yielding to the scheduler between units. The library's foreign-revision abort (`ModelPlacementChangedError` on growth by a concurrent caller) makes concurrent `findClashes` against one world unsafe for a batch. Direct `findClashes` callers cannot be serialized by this layer; that residual hazard is handled by bounded retry and documented (OQ-11). | 7 |
| D7 | Run state has **four terminal statuses** (`completed`, `cancelled`, `failed`, `invalidated`) and, orthogonally, **`coverage`** (`full`/`partial`), **`integrity`** (`clean`/`caveated`) and **`freshness`** (`current`/`stale`/`unverifiable`). "No clashes found" may be claimed only for `status: completed ∧ coverage: full ∧ integrity: clean ∧ freshness: current ∧` a non-empty required pair space `∧ ¬emptyOperand ∧ unresolvedSelections = ∅ ∧ unreachablePopulation = ∅` (§8.3). | 8, 12 |
| D8 | **Cancellation is cooperative at Work-Unit boundaries.** The library has no abort seam; an in-flight unit is drained, not discarded, and its valid result is kept. Cancelled runs retain partial results, flagged `coverage: partial`. | 10 |
| D9 | Progress is a monotone, pair-space-weighted fraction plus counters, delivered by snapshot and by throttled events. `unitsTotal` may grow (deterministic splitting); the weighted fraction never regresses. | 9 |
| D10 | Library diagnostics are normalized to plain data, deduplicated at batch scale, capped, and classified by one `isCompletenessAffecting(reason)` predicate. **Unknown reasons count as completeness-affecting** (fail-safe). Diagnostics that cannot be attributed to an element (`dbId: null`: `fragment-not-loaded`, `fragment-owner-unresolvable`) are first-class: they carry an `attribution` class and taint every pair of the affected unit/target model, so they can never yield a false `covered-clean`. | 12 |
| D11 | A **Result Set** is sealed at terminal state, canonically ordered by `PairId`, structured-clone/JSON safe (no live refs), and persisted through a `ResultStore` port. The M1-gate structured-clone crash class is excluded by construction. **Resident sets are hard-bounded** (`maxResidentResultSets` counts in-flight runs and sets with in-flight writes until settlement (§13.5.2); unsaved sets are never auto-evicted; a full engine refuses new runs with `ResultCapacityError` rather than grow or drop state). `done`/`persisted` have disjoint one-shot meanings: `done` resolves at seal + first-persistence-or-timeout, `persisted` resolves with the eventual persistence outcome. | 11, 13 |
| D12 | Aggregation/grouping foundations are **pure, deterministic derivations** over a sealed Result Set (facets, group identity, filters) plus an optional host-supplied attribute snapshot. No UI, status, or workflow state. | 14 |
| D13 | Repeatability is contractual **per mode**: deterministic for `volume-overlap` and `clearance`; **time-sensitive** for `surface-intersection` and `containment` (library-declared exceptions). Reruns are new runs; comparison is a defined diff with an explicit `unverified` class. | 15 |
| D14 | Stale-input handling is explicit: evicted/reloaded/re-placed models never produce silently mixed results; affected units become gaps, tainted units are discarded, and the run may become `invalidated`. **Executed-scope equality is proven, not assumed**: every unit's whole-model-target population and root subtrees are re-digested immediately before and after the call and compared with the planning snapshot; a unit is `evaluated` only if equal (invariant I-scope), so a completed/full run implies demonstrated equality. | 16 |
| D15 | Memory/performance: provisional caps (§17), engine-owned synchronous spans bounded by `frameBudgetMs`, and a **`UnitExecutor` port** whose inputs/outputs are plain data — the only worker seam this spec commits to (it does not adopt a worker). | 7.1, 17 |
| D16 | Verification is tiered (unit → differential on the real `CollisionWorld` → live Viewer), with **responsiveness figures characterization-only** because M4 Verdict D left the target unconfirmed. | 22 |

---

## 1. Baseline: what the library gives and what it does not

### 1.1 Facts this design builds on

Each fact is verified against landed source (file named) and, where a spec or the README states it, that doc.

| # | Fact | Source |
|---|---|---|
| F1 | `findClashes` takes **exactly one source model** and explicit `source.dbIds`; targets are `{targets:[{model, dbIds?}]}` where omitted `dbIds` means whole-model scope. `groupBy` must be `'dbId'`. One mode per call. | `CollisionWorld.js` `findClashes` entry validation |
| F2 | **Source self-exclusion is by fragment membership**: a target fragment is dropped iff its `(loadEpoch, fragmentId)` is in the source's own extracted set (assembly-rooted rule). A whole-model source against the same model as target therefore yields **zero** same-model pairs. | `isSourceOwnFragment`, M2 §4.4 |
| F3 | Pair dedup key is `${sourceEpoch}:${sourceOwnerDbId}:${targetEpoch}:${targetOwnerDbId}` — ordered, epoch-qualified, `ownerDbId` (the fragment-owning node, possibly a descendant of the requested dbId). `pairs` are in **insertion order, not canonical**; TLAS and linear differ in order. | `findClashes` aggregation, README |
| F4 | `ClashPair` carries the **live `Model`** on each operand (`source.model`, `target.model`) plus diagnostic-only `modelId`. A raw `ClashPair[]` is not structured-cloneable (circular reference to `window`) — the tracked M1-gate crash. | `CollisionWorld.js`, closeout follow-up 3 |
| F5 | Lifecycle: `admitModel(model)` → frozen `{model, epoch}` lease (idempotent while live); `loadEpoch` is global to the world, monotonic, never reused; a Model ever evicted can never be re-admitted (a reload is a new object and a new epoch); `isLeaseValid` is total/non-throwing; `evictModel` never throws; `dispose()` is terminal. | `CollisionWorld.js`, M1 |
| F6 | **No per-call cancellation, `AbortSignal`, deadline, or progress hook exists** (`AbortController` appears zero times in `collision/`). Checkpoints throw only `WorldDisposedError`/`ModelEvictedError`/(TLAS) `ModelPlacementChangedError`. Abort granularity is one atomic unit. | `scheduler.js`, M1 §"cancellation", M4 §2.3/§11 |
| F7 | A call that hits a lifecycle/capacity/extraction failure **throws and returns no partial result**. Per-fragment/pair problems are **diagnosed** (`statistics.diagnostics`) and the call resolves. | README "Diagnostics", `errors.js` |
| F8 | Thrown-failure vocabulary: `WorldDisposedError`, `ModelEvictedError`, `ModelPlacementChangedError`, `CapacityExceededError` (`kind` ∈ `call-wide-unique-fragment-precheck`, `bucket-capacity`, `tlas-candidate-budget`, `whole-model-enumeration`, `clearance-narrow-phase-budget`), `ExtractionLimitExceededError`, `ObjectTreeUnavailableError`, plain `Error` (entry validation; linear `maxBroadPhaseInstancePairs`). | `errors.js`, `ViewerModelAdapter.js`, `index.js` |
| F9 | Budgets that bind a batch: `maxFragmentsPerDbId` 5,000 and `maxChildrenPerNode` 10,000 (per requested dbId); `maxCollisionInstancesPerEpoch` 20,000 (cumulative **per epoch**, bucket persists across calls, only released by evicting that model); `maxTlasCandidatePairs` 200,000 and `maxClearanceNarrowPhasePairs` 20,000 (per call); `frameBudgetMs` 8. All provisional. | `collision/constants.js` |
| F10 | Modes: `containment` is **directed** (source surface inside target solid); `volume-overlap`, `surface-intersection`, `clearance` are symmetric in meaning. `clearance` requires a caller-supplied `clearance` (finite, > 0); the library has **no default** (`DEFAULT_CLEARANCE = 0.05` is a Viewer-extension-layer default). | `ContainmentModeQuery.js`, README M3 |
| F11 | Determinism: `volume-overlap` and the clearance Hard-Clash precheck terminate on deterministic operation counts only (PC fix landed). `surface-intersection` and `containment`'s witness term still let wall-clock elapsed time set `aborted` — results can depend on machine speed (README "known exceptions"). Operand-swap invariance holds through `volumeOverlapQuery` **except the rank-6 residue** (pairs tying through rank 5, including byte-identical geometry). | README, canonical-ordering spec |
| F12 | Diagnostics: non-empty `statistics.diagnostics` means the result **may be incomplete**; `witness-unavailable` is the one carve-out (verdict complete, marker missing); all four clearance reasons **do** count. Diagnostic `modelId` is diagnostic-only and not unique. R1 alone emits ~1,709 diagnostics per single query on the M4 fixture. | README, M4 evidence |
| F13 | Placement: TLAS placement data is static until the **caller** calls `invalidateModelPlacement(model)`; `broadPhase: 'linear'` re-reads placement every call. Any foreign placement-revision bump (an explicit invalidation **or** growth by another caller's extraction) aborts an in-flight TLAS query with `ModelPlacementChangedError`; the model stays live and the caller should retry. | README, M2 §6.7.5 |
| F14 | Batch-relevant measurements (M4, one fixture, one dev machine, single `findClashes` calls — **never batches**): tasks stay ~9–25 ms yet frames starve 100–283 ms per query; candidate cost is driven by per-source-instance density, not source count (whole-Structure source, 543 instances → 5,284 clearance candidates, 26% of the 20,000 cap); typed-buffer memory 4–25 MB; per-instance retention 280–388 B; **no** multi-process wall-clock makespan was recorded; no worker overhead was ever measured. | M4 checkpoint/closeout, digest of `m4-gate-1789180565018.json` |
| F15 | Instance-tree readiness: an under-enumerated tree yields a walk that finishes normally with **no diagnostic** ("Mode 2", explicitly left open). Whole-model **source** enumeration is not a library primitive (only whole-model **target** scope, `extractAllFragments`, exists). | `instance-tree-readiness-decision.md`, `findClashes` |
| F16 | **Extraction is subtree-recursive per requested dbId** (an explicit-stack walk of the node and all descendants; each fragment is attributed to the node that *directly* owns it, first-discovery-wins). Two disjoint dbId lists therefore do **not** imply disjoint fragment sets whenever one dbId is an ancestor of another; and the fragment-membership self-exclusion (F2) drops a target fragment that any source subtree walk touched. There is no exact-owner (non-recursive) extraction scope. | `ViewerModelAdapter.js` `extractFragments` |
| F17 | **Two diagnostics are unattributable by construction.** Whole-model *target* extraction (`extractAllFragments`) emits `fragment-not-loaded` (checked before any owner lookup) and `fragment-owner-unresolvable` (`getDbIds` returned `undefined` or an array) with `fragment.dbId` **hard-coded `null`**, `role: 'target'`; the fragment is **dropped** (`continue`, no record), so a clash involving it is silently not found. Every other library diagnostic carries a numeric `ownerDbId`. `extractFragments` (explicit dbIds) emits no diagnostics. | `ViewerModelAdapter.js` `extractAllFragments`; `CollisionWorld.js` `fragmentRef` |
| F18 | **The library exposes no per-call evidence of what target population a call saw.** `statistics` (`emptyStatistics()`) has no target/source fragment count or enumeration identity (`targetTotalCount` is a local). `getEpochPlacementDiagnostics(epoch).placementCount` is a **cumulative, write-once-per-fragmentId epoch table** (union of everything ever extracted for that epoch across all calls; it never shrinks while the epoch is live), so it cannot prove any single call's population — it does not change on replacement of one fragment by another, nor on a fragment that stopped/started being eligible. | `CollisionWorld.js` `emptyStatistics`, `getEpochPlacementDiagnostics`, `_recordPlacement` |

### 1.2 What the roadmap assigns to this layer

Roadmap §3/§6 give this layer: batch/many-object orchestration, test definitions and lifecycle, result-set semantics/lifecycle, aggregation/grouping/filtering-ready data, progress, cancellation/abort with terminal-state semantics, execution state, diagnostics/incomplete-result semantics at batch scale, and interaction with the Hard and Soft Clash modes. Roadmap §4 makes durable model/version identity this layer's to define. Roadmap §4/§6 explicitly hand cancellation policy (reject vs partial vs discard) and progress to this layer. §21 traces each roadmap constraint to where this spec satisfies it.

### 1.3 Library behaviors this spec relies on that are not yet documented contract

Stated so the implementation plan can pin or test them rather than assume:

1. **Concurrency posture.** M4 records concurrent `findClashes` calls as "an existing, handled scenario", while M2 §6.7.5 records that a concurrent caller's *growth* revision bump aborts another in-flight TLAS query. This spec takes the conservative reading (D6). It is not a claim that concurrency is broken.
2. **`getEpochPlacementDiagnostics(epoch).placementRevision`** is a public diagnostic accessor but its revision counter moves on growth as well as invalidation, so it **cannot** by itself detect "the model was moved". The engine therefore owns a separate placement generation (§16.2).
3. **The library exports no version constant.** Provenance records a host-supplied `libraryVersion` (§13.2); absent, repeatability across builds is not asserted.
4. **Whole-model source enumeration** needs an `ElementEnumerator` port (§6.2) because no library primitive exists; the Viewer implementation of that port reads the same `fragList.getDbIds(fragId)` owner mapping `extractAllFragments` already uses (accessor resolved in `docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md` and exercised live by the M2/M3 whole-model-target acceptance). What is **new** here is consuming that mapping to enumerate distinct *source* owners and gating on tree readiness; the plan must verify that use against a real Viewer session (OQ-4).

---

## 2. Scope, layering, non-goals

### 2.1 Layering

```text
Collision Core (collision/)            geometry, query execution, diagnostics, budgets, checkpoints   [unchanged]
        ▲ public CollisionWorld surface only
Federated Clash Test & Results         definitions, planning, orchestration, run lifecycle, results,
(this spec; proposed clashtest/)       diagnostics at batch scale, durable result sets, grouping foundations
        ▲ stable engine contract (§18)
Viewer Clash Panel (future)            presentation, navigation, interaction state, workflow/status
```

The engine's core imports **nothing** from the Viewer, `three`, or `collision/` internals. It touches `CollisionWorld` only through the injected world and through the two ports that isolate Viewer specifics (`ElementEnumerator`, `ModelRegistry`), mirroring how `collision/` itself keeps Viewer specifics in `collision/viewer/`. A Viewer adapter (proposed `clashtest/viewer/`) supplies those ports.

### 2.2 In scope

Test definitions and their lifecycle; model/model-set operands; deterministic planning and batch orchestration over `findClashes`; deterministic pair/result identity; run lifecycle, progress, cancellation; partial/incomplete semantics and batch-scale diagnostics; sealed durable result sets and their persistence port; aggregation/grouping/filter foundations; rerun and comparison; stale-model/epoch/placement handling; memory/performance boundaries; acceptance criteria.

### 2.3 Explicit non-goals

See §23 for the full list. Headline items: no UI (Panel), no issue/approval/assignment workflow, no persistence backend, no worker/off-main-thread execution, no change to collision-core contracts, no Group-By UI, no resume-of-cancelled-run, no user-tunable geometric tolerances.

---

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Clash Test** (definition) | Immutable revisioned value: `selectionA`, `selectionB`, one `mode` (+ `clearance`). The *question*. |
| **Selection** | A set of model scopes: whole model, or an explicit dbId list within one model. Union semantics. |
| **`modelKey`** | Host-supplied durable, opaque model identity. The only model identity that appears in durable data. |
| **`ElementRef`** | `{modelKey, dbId}` — the durable element identity. |
| **Binding** | The runtime association `modelKey → live Model` (+ lease, generations), held by the `ModelRegistry`. |
| **Run** | One execution of one definition revision against one input snapshot. Has a lifecycle. |
| **Work Unit** | One planned `findClashes` call: one source model, an explicit source dbId set, a target scope. |
| **Cell** | One of three disjoint pair-space regions the planner decomposes a test into (§6.3). |
| **Ledger** | The per-run record of every unit's outcome and every declared gap. |
| **Result Set** | The sealed, immutable, plain-data outcome of a run. |
| **Root** | A subtree root: the unit of selection granularity. Selecting a dbId selects its whole subtree; a selection is normalized to an antichain of roots (§5.6). |
| **`PairId` / `ResultId`** | Canonical pair identity / `(testId, semanticDigest, PairId)`. |
| **Gap** | Pair-space the run was required to cover but did not evaluate, with a reason. Absence of a result inside a gap is *unknown*, never *negative*. |
| **Caveat** | A completeness-affecting diagnostic inside evaluated pair-space. |

---

## 4. Durable identity model

### 4.1 Why runtime identity cannot be persisted (F4, F5, F3)

`Model` objects are live, non-serializable, and dead after unload; `loadEpoch` is per-world; `modelId` is diagnostic-only and reuse-prone; `fragmentId`/`geometryIndex` are session-local (`fragmentId` is only empirically stable across identical reloads). The roadmap (§4) makes a durable identity **this layer's** to define and forbids persisting a `Model` or `modelId` as one. Everything durable in this layer is therefore keyed on the identities below, and the runtime identities exist only inside a live run's bindings.

### 4.2 `modelKey` and `modelVersion`

- **Identity contract (chosen, binding): a `modelKey` names one immutable model version — one source document *and* one specific translation/content state — for all time.** `dbId`s are stable only within one such version (§4.4), so every durable identifier built on `(modelKey, dbId)` is only sound if the key can never denote two different contents. The alternative — carrying a version inside every `ElementRef`/`PairId`/`ResultId` — is deliberately **not** chosen: it would make every durable id longer and every definition version-pinned, and it would still rest on the same host honesty about what a "version" string means. A host that re-translates, replaces, or otherwise changes a model's content **must mint a new `modelKey`**; carrying workflow state from the old key to the new one is an explicit host/Panel reconciliation (§23), never an implicit aliasing.
- `modelKey`: non-empty string, **host-supplied**, opaque to the engine (compared by exact code-unit equality; total order by code-unit comparison). The engine never derives, parses, or normalizes it. The same physical model *version* must yield the same `modelKey` across sessions (a reload of unchanged content keeps its key); two different versions must never share one.
- `modelVersion` (**mandatory**): non-empty opaque string that is a **content fingerprint/witness** of that version (for example the translation/derivative revision or a content hash — never a display label and never a constant). The engine does not interpret it; it records it and compares for exact equality. It exists so the identity contract is *checkable*, not so identity can vary within a key.
- **Enforcement points** (a violation is always a loud, typed failure, never silent aliasing):
  1. **`ModelRegistry.register`** — keeps a `firstSeenVersion` per `modelKey` for the registry's lifetime (surviving `unregister`). Registering a `modelKey` with a different `modelVersion` than first seen throws `ModelKeyVersionConflictError{modelKey, seen, offered}`; a missing/empty `modelVersion` throws `ModelBindingError`.
  2. **`ResultStore.put`** — the port contract requires the store to reject with `IdentityConflictError` any Result Set whose `provenance.models[]` maps a `modelKey` to a `modelVersion` different from one ever accepted by that store (the index survives `delete`, §13.5). This is the durable, cross-session enforcement point (all durable `ResultId`s pass through it). A rejection is a persistence failure (`failed`, `error.name = 'IdentityConflictError'`, §13.5.1), never a change to the run outcome.
  3. **`compareResultSets` / `rerun` / `getFreshness`** — if the two sets (or a set and the live binding) record the same `modelKey` with different `modelVersion`s, the contract has been violated by the host: `compareResultSets` classifies **no** pair involving that `modelKey` as `unchanged`/`changed`/`added`/`resolved` and lists them under `identityConflicts` (§15.4); `rerun` against a live binding whose `modelVersion` differs from the base's recorded one throws `ModelKeyVersionConflictError`; `getFreshness` reports `stale` with reason `model-version-conflict:<modelKey>`.
- **Residual trust boundary, stated plainly:** if a host reuses a `modelKey` *and* a `modelVersion` for different content, no engine check can detect it. `modelVersion` must therefore be a genuine content witness; OQ-1 covers how the Viewer host derives it.
- The engine does not choose the derivation. A Viewer adapter may propose one (for example from the loaded document's URN plus derivative version), but that is a host/Panel decision (OQ-1).

### 4.3 Binding: `ModelRegistry`

```text
register(modelKey, model, { modelVersion })     // modelVersion MANDATORY (§4.2); idempotent for the same (key, model, version); throws ModelKeyVersionConflictError on a version change for a known key
unregister(model)                                // wired to BEFORE_MODEL_UNLOAD_EVENT, beside world.evictModel
bindingFor(modelKey) → Binding | null
keyOf(model) → modelKey | null
registrySessionId                                // read-only nonce, fixed for the registry's lifetime (freshness, §16.4)
notifyPlacementChanged(modelKey)                 // §16.2
```

`Binding = { modelKey, model, modelVersion, lease, bindingGeneration, placementGeneration }`.

- `lease` is obtained lazily via `world.admitModel(model)` (F5).
- `bindingGeneration` increments when the same `modelKey` is registered against a **different** `Model` object *with the same `modelVersion`* (a reload of unchanged content). A reload whose content changed must use a new `modelKey` (§4.2); re-registering the old key with a new `modelVersion` throws. `placementGeneration` is an engine-owned counter the host increments via `notifyPlacementChanged` (§16.2).
- `unregister` must never throw (it runs inside an unload-event handler; an uncaught throw there aborts the Viewer's teardown of every remaining model — M1 §"BEFORE_MODEL_UNLOAD_EVENT"). It marks the binding dead **only if** the binding's current `Model` is the exact object being unregistered (object identity, never `modelKey` alone), so a late unload event for an *old* model cannot kill a newer binding registered under the same `modelKey`. Active runs observe the dead binding at their next boundary (§16).
- One live `Model` maps to at most one `modelKey`, and one `modelKey` to at most one live `Model`. Violations reject at `register` with a typed error.
- **The registry is world-scoped, not engine-scoped.** Bindings, `bindingGeneration`, `placementGeneration`, key uniqueness and the `firstSeenVersion` ledger are shared state; serializing runs per world (§7.3) is useless if two engines over one world could hold different generations. The world coordinator (§7.3) therefore **owns the sole `ModelRegistry` for its world**: `createClashTestEngine({world})` joins it, `engine.registry` is that same object for every engine over the world, and `engine.invalidateModelPlacement` / `register` / `unregister` / `notifyPlacementChanged` all act on it. A `registry` option that is not the coordinator's registry for that world throws `ModelBindingError('registry-mismatch')` at construction. A placement change made through one engine is therefore visible to a run in progress in another (invalidating it, §16.3); AC-8 tests exactly that.

### 4.4 `ElementRef`, `PairId`, `ResultId`

- `ElementRef = { modelKey: string, dbId: number }`. `dbId` is model-local (a non-negative safe integer); it is meaningful only alongside its `modelKey`. **Element identity is `(modelKey, dbId)`; nothing stronger is claimed — and it is sound *because* a `modelKey` is one immutable model version (§4.2).** dbIds are stable only within one model version; a re-translated model may renumber, which is exactly why a re-translated model gets a **new `modelKey`** and therefore new `ElementRef`s, `PairId`s and `ResultId`s that cannot alias the old ones (open question OQ-2 covers an optional durable per-element identity such as a Revit unique id for continuity *across* keys; the `ElementRef` shape reserves `externalId?` but the engine never reads it).
- **Element order** (used for every canonical ordering): `modelKey` by code-unit order, then `dbId` numerically.
- **`PairId`**: a pair of `ElementRef`s `(first, second)`.
  - *Unordered* semantics (`volume-overlap`, `surface-intersection`, `clearance`): `first` is the lesser ref in element order, `second` the greater. `first ≠ second` always.
  - *Ordered* semantics (`containment`): `first` = the contained (library *source*) element, `second` = the container (library *target*). No reordering.
- **`ResultId` = `(testId, semanticDigest, PairId)`**, with canonical string form `JSON.stringify([testId, semanticDigest, first.modelKey, first.dbId, second.modelKey, second.dbId])`. Including `semanticDigest` (§5.4) is deliberate: a revision that changes the mode, the clearance, or either selection asks a *different question*, so its results must not inherit an identity that a workflow layer may have attached approval/assignment state to. A revision that changes only `name`/`description` keeps the same `semanticDigest` and therefore the same `ResultId`s. Model content changes are handled one level down: a changed model has a **new `modelKey`** (§4.2), so every `ElementRef`/`PairId`/`ResultId` involving it is different by construction; and because the `semanticDigest` covers the selections' `modelKey`s, a test re-pointed at the new key is also a different question. **Cross-question and cross-version carry-over is never implicit**: a workflow that wants it must go through an explicit reconciliation using `compareResultSets` (§15.4) and `getPairStatus` (§12.5), which compare by `PairId`, and (for a key change) a host-supplied element mapping that is outside this layer (§23). This form is a stable, delimiter-safe encoding; it deliberately avoids the "modelId in a delimited string key" hazard M2 §4.1 calls actively wrong.
- Both forms are **independent of run, epoch, unit boundaries, broad-phase choice, and evaluation orientation**. A pair keeps the same `ResultId` across reruns of the same question, across sessions, and across different unit partitionings — which is what makes rerun diffing (§15) and any later status carry-over (Panel/workflow layer) well-defined.

### 4.5 Symmetry class is derived, not chosen

`pairSemantics` is a function of `mode`: `containment → ordered`; all others `→ unordered`. It is not a definition field; the validator rejects any attempt to supply one. (`clearance` distance is swap-invariant per the canonical-ordering spec; `volume-overlap` is swap-invariant except the rank-6 residue, which §11.4 handles.)

---

## 5. Federated Clash Test definition

### 5.1 Schema

```js
/** @typedef {{ kind: 'model', modelKey: string }
 *          | { kind: 'elements', modelKey: string, dbIds: number[] }} SelectionEntry */
/** @typedef {{ entries: SelectionEntry[] }} SelectionSpec */

/** @typedef {Object} ClashTestDefinition
 *  @property {1} schemaVersion
 *  @property {string} testId              opaque, unique, immutable across revisions
 *  @property {number} revision            integer >= 1, strictly increasing per testId
 *  @property {string} name                display only
 *  @property {string} [description]       display only
 *  @property {SelectionSpec} selectionA
 *  @property {SelectionSpec} selectionB
 *  @property {'volume-overlap'|'surface-intersection'|'containment'|'clearance'} mode
 *  @property {number} [clearance]         world units; REQUIRED iff mode === 'clearance', forbidden otherwise
 */
```

### 5.2 Operand semantics

- A selection is a **union over its entries, per model**. `kind: 'model'` = every fragment-owning element of that model (dynamic: enumerated at run start, §6.2). `kind: 'elements'` = exactly those dbIds (static). If both appear for one `modelKey`, `model` wins. Duplicate entries for one model merge.
- **Snapshot boundary.** Bindings, model versions and generations are captured **atomically at the `queued → planning` transition** (§16.1), not at `startRun` and not at unit start. Whole-model *source* selections and every explicit list are enumerated once, at planning, and fixed for the run; models registered after that transition are out of scope (the same snapshot rule M2 §9.2.3 gives `findClashes`). Whole-model **target** scope is the exception the library imposes: `findClashes` re-extracts a whole-model target on every call (F1), and explicit root lists are re-walked on every call too, so the executed fragment sets can differ from the planned ones if the Viewer's fragment population changes mid-run (e.g. a still-streaming model). The engine therefore does **not** promise a snapshot of executed inputs; it promises a **proof or a gap**: the planning-time scope digests (§6.2.1) are the baseline, and a unit is `evaluated` only if the live scope is shown equal to it immediately before and immediately after the call (§16.3). If equality is not demonstrable the unit is a gap or the run is invalidated — a completed/full run therefore *implies* demonstrated scope equality (invariant I-scope, §16.3). The resolved model list, plan-time digests and the proof method are recorded in provenance (§13.2).
- **Hierarchy is subtree-granular** and is specified in §5.6. The library walks a requested dbId's whole subtree and reports results at the fragment-owning `ownerDbId` (F3, F16); the engine reports results at that owner dbId and defines **no roll-up**.
- **Selection shapes supported** (the roadmap §6 list): model-vs-model (`A={model X}`, `B={model Y}`), model-vs-many (`A={model X}`, `B={elements/models…}`), many-vs-many, full-model enumeration, and same-set self tests (`A = B`), all through the one schema — no special-case shapes. Same-model overlap between `A` and `B` is fully supported **when it is root-identical** (§5.6, §6.3) and is where the design is most careful; nested overlap is rejected at planning.

### 5.3 Validation

One pure function, `validateTest(def) → Issue[]`, is used identically by `validateTest`, `saveTest` and `startRun`. It **collects every issue** (it never stops at the first) as `{path, code, message}`, performs **no coercion**, and only if the issue list is empty does normalization run (de-duplicate and ascending-sort dbId lists; merge same-model entries with `model` winning over `elements`; **order each selection's entries ascending by `modelKey` code-unit order, one entry per model**; compute `semanticDigest`). Failure throws `InvalidTestDefinitionError{issues}`; a `schemaVersion` greater than the engine understands throws the distinct `UnsupportedSchemaVersionError` and is never partially interpreted.

| Rule | Field(s) | Check |
|---|---|---|
| V1 | definition | A plain object with exactly the keys of §5.1: required `schemaVersion, testId, revision, name, selectionA, selectionB, mode`; optional `description, clearance`. **Unknown properties are rejected at every nesting level** (this also rejects `pairSemantics` and any run/execution option, which are not definition fields). |
| V2 | `schemaVersion` | Exactly `1`. |
| V3 | `testId`, `revision`, `name`, `description` | `testId`: string, 1–256 code units. `revision`: integer, 1 ≤ n ≤ 2^53−1. `name`: string, 1–256. `description`: string ≤ 4,096 when present. |
| V4 | `selectionA/B` | `{entries: SelectionEntry[]}` with 1 ≤ length ≤ `maxEntriesPerSelection` (provisional 1,024). Each entry is exactly `{kind:'model', modelKey}` or `{kind:'elements', modelKey, dbIds}`; `kind` is one of the two discriminators. |
| V5 | `modelKey`, `dbIds` | `modelKey`: string, 1–1,024 code units. `dbIds`: non-empty array of non-negative safe integers, total explicit elements per selection ≤ `maxExplicitElementsPerSelection` (provisional 100,000, §17.1); duplicates are permitted on input and removed on normalization. |
| V6 | `mode`, `clearance` | `mode` ∈ the four library modes. `clearance` present ⇔ `mode === 'clearance'`, and then a finite number > 0 — the same two-directional rule `findClashes` enforces (F10). **The engine supplies no default clearance**; the Panel/host chooses one. |

Emptiness that can only be known at run time (a `kind:'model'` entry enumerating to zero elements) is **not** a validation error; it is a run-time outcome (§6.6). Hierarchy conflicts between the two selections likewise need the instance tree and are detected at planning (§5.6), not here.

### 5.4 Revisioning, identity, digest

- Editing produces a **new revision**; revisions are immutable. `testId` + `revision` identify a definition.
- `semanticDigest` = digest of the canonical (sorted-key JSON, normalized selections) form of `{mode, clearance, selectionA, selectionB}` — **excluding** `name`, `description`, `revision`. Two revisions with equal `semanticDigest` ask the same question. The digest format is fixed here: `"sha256:" + lowercase hex` of SHA-256 over the UTF-8 bytes of a **canonical JSON** encoding — object keys sorted by UTF-16 code-unit order, no insignificant whitespace, strings serialized by the ECMAScript well-formed `JSON.stringify` algorithm (ES2019: lone surrogates are escaped as `\uXXXX`, control characters as their short or `\u00XX` forms, nothing else escaped, so each string has exactly one encoding), numbers rendered as the shortest round-trip `Number#toString` (finite only; `-0` normalized to `0`), arrays in their normalized order. Every durable digest in this spec (§13.1) uses this format and records `digestVersion: 1` beside it; digests of different versions are never compared (the comparison reports `unverifiable`). Golden byte-level vectors (AC-1) cover entry permutations, Unicode, control characters, lone surrogates, `-0`, and exponent-form numbers. The *implementation* (Web Crypto `SubtleCrypto`, or a sliceable pure-JS SHA-256 for the ≤ `frameBudgetMs` span rule, §17.3) is a plan-level choice; the output bytes are not.
- Results reference `(testId, revision, semanticDigest)` and **embed a full copy of the definition** (§13.1), so a Result Set stays self-describing after its definition is edited, archived, or deleted.

### 5.5 Definition lifecycle

`active → archived` (soft) and hard `delete`. **Archive and delete apply to a test as a whole (`testId`, all its revisions)**; neither touches Result Sets. An archived test remains readable (`get`, `list`) but cannot start *stored-reference* runs or accept new revisions (`TestArchivedError`). **Direct definitions are ad hoc and are not governed by stored archive/delete state** (choice made explicit): `startRun(definition)` never consults the `ClashTestStore`, so a caller who retains a copy of an archived definition can still run it (the result records `testRef`; hosts that need enforcement start runs by reference). `rerun` uses the embedded definition and is likewise ad hoc unless a reference is given. Persistence goes through a `ClashTestStore` port (`put/get/list/archive/delete`; the plan supplies an in-memory reference implementation; storage backends are a non-goal, §23).

**Store consistency contract.** `ClashTestStore` operations (`put`, `get`, `list`, `archive`, `delete`) are **linearizable per `testId`**: each takes effect at a single point between its invocation and response (for a server or IndexedDB backend, its committed transaction), and every `get` observes a consistent state — revision *and* archived flag from the same point — so `startRun({testId})` racing `archive(testId)` sees either the world before it or after it, never a mix. The in-memory reference implementation must satisfy this and be tested with interleavings (AC-1).

**Revision model (chosen): the caller assigns the revision; the store enforces strict monotonicity atomically.** `put(def)` accepts a definition iff `(testId` is new ∧ `revision === 1)` or `revision === latest(testId) + 1`; anything else — a duplicate `(testId, revision)`, a gap, or an out-of-order save — rejects with `RevisionConflictError{testId, latest, offered}` and **never overwrites**, so a saved revision is immutable and histories are gap-free. `get(testId)` without a revision returns the **latest** revision (archived or not); `get(testId, n)` returns exactly revision `n` or `null`. `saveTest(def)` = `validateTest` + `put` (it neither assigns nor rewrites revisions); `startRun` has two overloads with explicit semantics (a stored reference is subject to the store's archive state, a direct definition is not, §5.5). **`startRun(definition)`** validates and admits *synchronously*: `InvalidTestDefinitionError`, `InvalidOptionsError`, `EngineDisposedError` and `ResultCapacityError` all throw before a handle exists. **`startRun({testId, revision?})`** (a stored reference) validates the reference shape and applies **exactly the same synchronous capacity admission as the direct overload** (§13.5.2: reserve a slot, else evict an `evictable` set, else throw `ResultCapacityError`); once admission has succeeded it **always returns a handle**, and only the *asynchronous* lookup can fail after that. The store lookup is the first step of `queued`, and a missing or archived test is a terminal planning failure — the run seals `failed` with planning gap `test-unavailable` (`test-not-found` / `test-archived`), and the slot it was **already admitted with** becomes an ordinary resident set (never leaked, never exceeding the cap). Once the definition is resolved and embedded, a later `archiveTest`/`deleteTest` does not affect the run. Lookup consistency is the store's linearizability contract (§5.5): a run sees either the state before or after an archive, never a mix. Two hosts racing on the same next revision are resolved by the store's atomic `put`: exactly one wins, the other gets `RevisionConflictError`.

### 5.6 Subtree granularity and the roots contract

The library cannot evaluate "this node's own fragments only" (F16): a source dbId contributes its **entire subtree**, and any target fragment inside a source subtree is dropped by self-exclusion (F2). A planner that reasoned over dbId sets alone would prove disjointness it does not have. This spec therefore makes **subtree roots** the unit of selection and states the consequences explicitly.

1. **Selecting a dbId selects its entire subtree.**
2. **Root normalization** (per model, per selection) via `ElementEnumerator.resolveRoots` (§6.2): a *whole-model* scope resolves to the **topmost fragment-owning nodes** (every fragment then lies in exactly one root's subtree); an *explicit* list resolves to the listed dbIds that have **no listed ancestor**. Each root carries its subtree `fragmentCount` and the **complete ascending list of fragment-owning dbIds in its subtree** (`ownerDbIds`), recorded in the ledger as the `rootOwners` table (§6.6). Its size is bounded by the number of fragments in scope (≤ the library's per-epoch fragment ceiling for a whole model, F9; ≤ `maxFragmentsPerDbId` per explicit root) and it is covered by the root's `subtreeDigest` (§6.2.1).
3. **The required pair space is defined over roots** (§6.1): a pair is a pair of *distinct* roots. Fragment pairs *inside* one root's subtree (e.g. a fragment-owning parent versus its own fragment-owning descendants) are **hierarchy-internal**: the library cannot evaluate them from the parent and, as a product-semantics choice this spec makes explicit (OQ-15), they are not required pairs. They are a **declared exclusion** (§6.6), not a gap.
4. **Results remain at owner level.** A result's `ElementRef`s are fragment owners (`ownerDbId`), which may be descendants of a root. `PairId` is owner-level (§4.4); pair-space accounting is root-level; the ledger's `rootOwners` table maps **every** fragment owner in a root's subtree — listed or not — to its root, so an owner such as a non-listed descendant `105` of explicit root `100` is always mappable (§12.5 `getPairStatus`), and a base result at `105↔220` can be proven `resolved` by a clean `100↔200` evaluation.
5. **Cross-role nesting is unsupported in v1.** For each model let `RA`, `RB`, `RU` be the root sets of `A_m`, `B_m` and `A_m ∪ B_m`. The selections are *supported* iff `RU = RA ∪ RB` as dbId sets (roots identical in both roles are fine; no root in one role may be an ancestor of a root in the other). Otherwise planning fails: run `failed`, reason `hierarchy-overlap`, with the first 20 offending (ancestor, descendant) pairs recorded, **before any unit runs**. This is deterministic and cheap, and it is the honest alternative to a plan that silently mis-covers.
6. **Remedies are outside this milestone.** Supporting "whole model vs. one nested element", or a parent tested against its own descendants, needs an exact-owner extraction scope in collision core (a collision-core change under roadmap §8, OQ-15). How common fragment-owning nodes with fragment-owning descendants are in the target Revit content is **unmeasured**; the plan should count them on the acceptance fixture.

---

## 6. Planning: coverage, Work Units, decomposition

### 6.1 The required pair set

Let `A_m`, `B_m` be the **root sets** (§5.6) of model `m` in `selectionA`, `selectionB`, after enumeration. The **required pair space** `P` is over distinct roots:

- *Unordered modes:* `P = { {x,y} : x ≠ y, ((x ∈ A) ∧ (y ∈ B)) ∨ ((y ∈ A) ∧ (x ∈ B)) }` — each unordered pair of roots once.
- *Ordered mode (`containment`):* `P = { (x,y) : x ∈ A, y ∈ B, x ≠ y }`.

Pairs of fragments within one root's subtree are hierarchy-internal and are **not** in `P` (§5.6.3). The planner's job is to cover `P` **exactly once** with Work Units, every unit legal under the library's rules, and to account for anything it could not cover.

### 6.2 Enumeration and the `ElementEnumerator` port

`findClashes` requires an explicit source `dbIds` array; only *target* scope has a whole-model sentinel (F1, F15). The engine therefore resolves roots itself:

```text
ElementEnumerator.resolveRoots(binding, scope: 'whole' | { dbIds: number[] }, ctx: EnumerationContext) → Promise<{
  roots:    Array<{ dbId, fragmentCount, ownerDbIds, subtreeDigest }>,   // ascending by dbId; fragmentCount = fragments in the root's SUBTREE; ownerDbIds = ascending distinct fragment-owning dbIds in that subtree (the owner→root map, §5.6.4); subtreeDigest = identity of that subtree's extracted fragments (§6.2.1)
  population: { count: number, digest: string } | null,       // scope 'whole' only: identity of the whole-model TARGET population (§6.2.1); null for explicit lists
  ownerMismatch: { count: number, first20: Array<{ fragId, treeOwner, fragListOwner }> } | null,   // scope 'whole' only (§6.2)
  unreachable: { count: number, ownerDbIds: number[] } | null,   // scope 'whole' only: loaded, owner-resolvable population fragments that lie in NO root subtree (tree under-enumeration); ownerDbIds = their ascending distinct owners
  unresolved: Array<{ dbId: number, reason: 'not-found' | 'no-fragments' }>   // explicit lists only: requested dbIds that yielded no root. 'not-found' = not a node of the instance tree; 'no-fragments' = exists but its subtree owns no collision-eligible fragment
}>

ElementEnumerator.digestScope(binding, scope: 'whole' | { dbIds: number[] }, ctx: EnumerationContext) → Promise<
  { kind: 'population', count: number, digest: string }                            // scope 'whole'
  | { kind: 'roots', roots: Array<{ dbId, fragmentCount, subtreeDigest }> }        // scope { dbIds } (root dbIds)
>   // re-reads the LIVE model now, with exactly the same function resolveRoots used at planning; never cached
```

- `'whole'` resolves to the **topmost fragment-owning nodes**; `{dbIds}` to the listed dbIds with no listed ancestor (§5.6.2). **Ownership is role-specific and must match the library exactly** (F3, F17): for **source roots and explicit target roots** the owner of a fragment is the instance-tree node whose `enumNodeFragments` callback first produced it (the `extractFragments` rule — first-discovery-wins); for a **whole-model target** it is `fragList.getDbIds(fragId)` (the `extractAllFragments` rule). For a whole-model scope the enumerator computes *both* for every fragment reachable from the tree and returns any disagreement as `ownerMismatch: {count, first20: [{fragId, treeOwner, fragListOwner}]}`; a non-zero count **fails planning** with planning gap `owner-mapping-mismatch` (fail closed — otherwise the same physical pair could receive different `PairId`s depending on which role the planner assigned it, and `validateUnitOutcome` would reject valid pairs). Verifying that the two mechanisms agree on the real Viewer is a **gate on accepting the Viewer adapter implementation** (AC-15 (g), OQ-4), not a property this spec assumes.
- **Must wait for the model's object tree to be ready** and must fail, not return a partial list, when the Viewer reports the tree unavailable (`ObjectTreeUnavailableError`-class). The library's own "Mode 2" (F15) means a *complete-looking* under-enumerated tree is undetectable; the engine records the plan-time `population` and per-root `subtreeDigest`s in provenance so a rerun can at least detect that the model's enumerated content changed (§15.4) and so execution can prove it saw the same content (§6.2.1, §16.3). This is a declared, inherited limitation, not a solved one (OQ-4).
- **`EnumerationContext = { checkpoint(): void | Promise<void> }`** is supplied by the engine to both methods. The enumerator must call `checkpoint()` at least once per slice (§17.3) and `await` its result; `checkpoint()` yields to the scheduler and **throws `EnumerationCancelledError`** when the run has been cancelled, its lease has died, or the world/engine is disposed. The enumerator must propagate that error (the engine maps it to planning gap `cancelled` or `world-disposed`; a dead lease during planning is planning gap `model-not-bound`). An enumerator that ignores the context weakens the guarantee to "cancellation takes effect when the current `resolveRoots`/`digestScope` invocation settles"; the engine still never *starts* another invocation after cancellation, and AC-7 tests both a cooperating and a non-cooperating enumerator.
- Enumeration is `await`ed **before** planning, checks the lease between models, and is chunked so no engine-owned synchronous span exceeds `frameBudgetMs` (§17.3).
- The engine calls `resolveRoots` for `A_m`, `B_m` and `A_m ∪ B_m` to apply the cross-role rule (§5.6.5). Because these calls `await`, the three answers for one model must agree — equal `subtreeDigest`/`ownerDbIds` for every shared root and equal `population` — otherwise the model changed *during planning* and planning fails with planning gap `enumeration-failed`; the run never plans over mutually inconsistent enumerations.

**Tree-unreachable population is never a silent clean negative either.** The two enumerations the library uses differ (`extractFragments` walks the instance tree; `extractAllFragments` scans every `fragId`), so a *loaded, owner-resolvable* fragment can be in the whole-model target population yet in no root subtree. For a `'whole'` scope the enumerator reconciles the two: every population fragment with a numeric owner must appear in exactly one root's subtree records with the same owner and geometry identity; those that appear in none are returned as `unreachable`. They are a **declared, claim-blocking exclusion**, not a silent omission: recorded in the ledger as `unreachablePopulation` per model (`{modelKey, count, ownerDbIds}`, bounded by the fragments in scope), listed in `libraryExclusions` as `tree-unreachable-population`, and `canClaimNoClashes` is false whenever any exists (§8.3). Consequences are explicit: such fragments are **not evaluated when their model is a whole-model source** (sources are tree roots — a known hole the exclusion flags), and when their model is a whole-model target a clash against one is still reported but is **outside the required pair space `P`**: the result is retained with `flags.unreachableOwner: true`, and `getPairStatus` reports it `not-required` (⇒ unverified in comparison). Duplicated or inconsistent records (a fragment under two roots, or the same fragment with different owner/geometry) are an enumerator defect and fail planning (`enumeration-failed`).

**Unresolved explicit elements are never a silent clean negative.** A requested dbId that yields no root contributes **no pair space** but is never dropped: `not-found` is an invalid reference (a stale or mistyped dbId) and **fails planning** (`failed`, planning gap `element-unresolvable`, first 20 offenders recorded, no unit runs); `no-fragments` is a real node with no geometry and is recorded in the ledger as a declared, **claim-blocking** entry in `unresolvedSelections` (`{modelKey, dbId, role}`) — the run still evaluates the rest, but `canClaimNoClashes` is false whenever `unresolvedSelections` is non-empty (§8.3), because the selection was never fully resolved to geometry. (A `kind:'model'` entry cannot produce either case: it enumerates existing owners.)

#### 6.2.1 Scope digests (the evidence for target-scope equality)

The library gives no per-call evidence of what population a call extracted (F18), and `placementCount` cannot supply it. The engine therefore takes its own evidence, **from the same accessors the library reads**, in a form that is comparable across time:

- **Population digest (scope `'whole'`).** For every `fragId` in `0..fragList.getCount()-1`, in ascending order, one record: `[fragId, 'N']` if `fragList.isNotLoaded(fragId)`; else `[fragId, 'U']` if `fragList.getDbIds(fragId)` is `undefined` or an array; else `[fragId, 'L', ownerDbId, geometryId]` (`getGeometryId(fragId)`, the identity the library itself records). The digest (format §5.4, `digestVersion` recorded) covers `count` and the record list. It is exactly the population `extractAllFragments` enumerates **including its two dropped classes** (F17): a fragment that becomes loaded, becomes unloaded, changes owner, or is *replaced by a different geometry under the same `fragId`* changes the digest — none of which a cumulative count can see (F18). Fragments unreachable from the instance tree are *in* the population (they are eligible whole-model targets), so they cannot cause false drift.
- **Subtree digest (explicit root scope, and every source root).** For each root, the digest of the sorted `[fragId, ownerDbId, geometryId]` records of the fragments `extractFragments` would take from that root's subtree (first-discovery-wins owner). A unit's source roots and explicit target roots are checked root-by-root against the plan's `subtreeDigest`s.
- **Not covered, by design:** world matrices/bounds (placement is its own axis: `placementGeneration`, §16.2, and `placementVerified: false`, §13.2).
- **Conformance.** The enumerator's records must equal what `extractAllFragments`/`extractFragments` produce for the same model. AC-2 (T1/T2) runs a differential over mock models (count-preserving replacement, status flips, growth, shrink, owner change, hierarchy) against the library's own exported extraction functions (test-only import; the engine core imports neither).
- **Cost.** One pass over the scope's fragments per digest, sliced (§17.3); a whole-model digest is bounded by the library's own `maxCollisionInstancesPerEpoch` ceiling on `getCount()` (above it enumeration fails, matching `whole-model-enumeration`). Because §16.3 takes two digests per unit, the added cost per unit is of the same order as the library's own per-call whole-model extraction; it is measured (AC-12) and not asserted.

### 6.3 Three-cell decomposition (exact cover, same-model-safe)

For each model `m`: `A'_m = A_m \ B_m`, `C_m = A_m ∩ B_m`, `B'_m = B_m \ A_m`. Cells (unordered modes):

| Cell | Sources | Targets | Notes |
|---|---|---|---|
| **1** | `A'_m` (per source model `m`) | `B_n` for **all** models `n` in one call (`targets:[…]`) | A source root in `A\B` cannot be inside a target root, so same-model targets are safe. |
| **2** | `C_m` | `B'_n` for all `n` | `B'_n` is the whole-model sentinel iff `A_n = ∅` (call-time scope proven equal to the planning population by §16.3, or the unit is a gap); otherwise an explicit root list. |
| **3a** | `C_m` | `C_n` for each model pair `m < n` (by `modelKey` order) | Cross-model overlap region, once per unordered model pair. |
| **3b** | intra-`C_m` (same model) | — | **Recursive bisection**, below. |

**Exactness (unordered).** For a required `{x,y}` with `x ∈ A_m`, `y ∈ B_n`: if `x ∈ A'_m`, cell 1 covers it and no other cell can (`y` is either not in `A`, or in `A` with `x ∉ B_m`, so `x` is never a target of `y`'s cell-1/2 sources). If `x ∈ C_m` and `y ∈ B'_n`, cell 2 covers it once. If both are in `C`, cell 3a (cross-model, `m<n`) or 3b (same model) covers it once. Each cell's source and target **root** sets are disjoint by construction, and roots are subtree-disjoint (§5.6, enforced by the `hierarchy-overlap` rule), so a source subtree walk never contains a target fragment and the library's fragment-membership self-exclusion (F2) never suppresses a required pair.

**Ordered mode (`containment`).** Cells 1 and 2 are unchanged (already ordered `A → B`). Cell 3a runs **both** orientations for every ordered model pair, and 3b bisection runs both `L→R` and `R→L` at each node.

**Cell 3b — recursive bisection.** For `C_m` sorted ascending, split into halves `L`, `R`; emit a unit set `L → R` (and `R → L` for ordered mode); recurse on `L` and on `R` until a set has ≤ 1 element. Each unordered same-model pair is evaluated exactly once, at the unique node where its members are split apart. This is required because the whole-set-vs-itself alternative is *silently empty* (F2). It is the reference strategy; the plan may substitute a block-triangular scheme **provided the coverage invariants and AC-2 (§22) still hold** (OQ-5 records the unmeasured unit-count cost).

**Common cases collapse cleanly:** cross-model `A={model X}`, `B={model Y}` (disjoint) ⇒ only cell 1; `A = B = {model X}` ⇒ only cell 3b; single source element vs the whole federation (the shipped "Find Clashes") ⇒ one cell-1 unit — exactly today's `findClashes`.

### 6.4 Unit sizing and deterministic splitting

- Each cell's source set is packed into units in ascending dbId order, greedily, bounded by `maxSourceFragmentsPerUnit` and `maxSourceDbIdsPerUnit` (provisional, §17), using `fragmentCount` from the enumerator (or 1 when unknown).
- **Plan determinism (invariant P1):** the initial plan is a pure function of *(definition semantics, sorted enumerations, run sizing options)*; capacity splits (below) are deterministic consequences of the library's deterministic budget errors, so the final ledger is a pure function of the same inputs plus the library's budget constants. **Wall-clock and load never influence planning or any verdict.** Sizing options are recorded in provenance and folded into `ledgerDigest`.
- **Capacity-driven splitting.** If a unit fails with `CapacityExceededError` of kind `tlas-candidate-budget` or `clearance-narrow-phase-budget` (per-call budgets that scale with source count) the engine splits it into two halves (child ids `${unitId}.0` and `${unitId}.1`) by the **deterministic split order**: (1) if the source set has > 1 root, bisect the sources (ascending dbId); (2) else if the unit has > 1 target *entry* (i.e. more than one target model), partition the target entries into two halves in ascending `modelKey` order, both children keeping the single source root — never separating fragments of the same target root, so every root pair still lands in exactly one unit and library aggregation is unaffected; (3) else, if the single target entry is an **explicit root list with more than one root**, bisect that ascending root list (never splitting a root, so each root pair still lands in exactly one unit); (4) else the unit is fundamentally unsplittable — one source root against one explicit target root, or against a whole-model sentinel (which cannot be partitioned without changing extraction semantics) — and is a gap. At every step the children's weights partition the parent's exactly. The engine, re-queues both, and records the split in the ledger. **Ledger lifecycle of a split:** the failed attempt's record ends with the normative outcome **`split`** ("superseded"): it is retained for audit with `children: [unitId, unitId]` and its `pairSpaceWeight` is **transferred exactly once to its leaf descendants** (the children's weights sum to the parent's). Only **leaf** units count toward `pairSpaceTotal`, `unitsTotal`, progress and coverage; `split` records are excluded from every coverage-gap calculation, so full evaluation of all leaves is `coverage: full` (a nested split is just a deeper leaf). `unitsTotal` = current leaf units (grows by 1 per split); `unitRecords` = leaves + `split` records (grows by 2 per split) and is what `maxUnitsPerRun` bounds. On cancel, queued children become `not-run:cancelled` leaves and the parent stays `split`. The split tree is part of `ledgerDigest`. Because those budgets are deterministic functions of the geometry (F11 deterministic-budget posture), the same inputs split the same way. A unit with one source root and one target root (or a whole-model sentinel) that still fails is a `failed:capacity-exceeded` gap. **`maxUnitsPerRun` bounds the total number of unit records — live and terminal — including those created by splits.** A split that would push `unitRecords` above the cap is not performed: the unit becomes a `failed:unit-cap` leaf gap (its pair-space weight recorded as a gap, `pairSpaceTotal` unchanged), so the ledger, `unitsTotal` and the resident-set bound (§13.5.2) can never exceed the cap.
- **Not splittable by the engine (become gaps):** `bucket-capacity` / `call-wide-unique-fragment-precheck` / `whole-model-enumeration` (the per-epoch bucket is cumulative and released only by evicting the model — F9), and `ExtractionLimitExceededError` (a single requested dbId over `maxFragmentsPerDbId`/`maxChildrenPerNode`). A model with more than `maxCollisionInstancesPerEpoch` (20,000) fragments cannot be fully covered by any run under today's library; this is reported as a gap, and raising the ceiling is a collision-core decision requiring the roadmap §8 process (OQ-6).

### 6.5 Unit description (plain data)

```js
/** @typedef {Object} WorkUnit
 *  @property {string} unitId               deterministic: `${cell}.${seq}` in canonical plan order
 *  @property {'1'|'2'|'3a'|'3b'} cell
 *  @property {string} sourceModelKey
 *  @property {Array<{table: string, start: number, end: number}>} sourceRanges   index ranges into run-scoped ROOT TABLES (§6.5.1); NOT copied dbId arrays
 *  @property {Array<{modelKey: string, scope: 'whole'|{ranges: Array<{table: string, start: number, end: number}>}}>} targets   whole-model sentinel, or ranges into the root tables
 *  @property {'A->B'|'B->A'|'canonical'} orientationRole  which selection role the source stands for
 *  @property {number} pairSpaceWeight      |source roots| × |target roots|, for progress (a whole-model target contributes its run-start root count)
 */
```

Units carry only `modelKey`s and table ranges — never `Model` objects or copied dbId arrays. The self-contained, postable form is the **`ExecutionRequest`** (§7.1), which materializes the ids; the `UnitExecutor` resolves keys to live models, which is what keeps requests postable to a worker later and structured-clone safe now.

#### 6.5.1 Run-scoped plan tables (bounded plan memory)

The plan is **normalized, not copied**. Per model and per class (`A'`, `C`, `B'`) the planner builds one immutable, ascending **root table** (`dbId`, `fragmentCount`, `subtreeDigest`, and the `ownerDbIds` range) once; every unit, split child and ledger record refers to it by `{table, start, end}` ranges (cell 1's `B_n = C_n ∪ B'_n` is two ranges). A split produces sub-ranges, never copies. The transient `ExecutionRequest` **materializes** the unit's explicit `sourceDbIds`, target lists and planning-time `scopeExpect` digests (`{modelKey, role, scope: 'whole'|'roots', population?, roots?}`) only when the unit is issued, and they are released when the attempt settles. Plan memory is therefore O(roots + owners + unit records), **not** O(units × targets), and the earlier "ledger is O(elements)" claim holds only in that sense. A hard guard `maxPlanReferences` (provisional 2,000,000; counts table entries + unit range records) is applied **incrementally while planning, before allocation**; exceeding it fails planning `plan-too-large` (same as `maxUnitsPerRun`). AC-12/AC-16 include a cap-sized many-vs-many planning case.

### 6.6 Coverage ledger and declared exclusions

The plan and the run maintain a **ledger**: every unit, its outcome, `scopeProof` (§16.3), attempts, splits, gap reason, diagnostic counts, its exact `taints` table (§12.2.1) and required pair-space weight; the `rootOwners` table (§5.6.4); the claim-blocking `unresolvedSelections` list and `unreachablePopulation` table (§6.2); and **planning-level gaps**. Nothing is silently dropped:

1. **Unit gaps** — unit failed/skipped/discarded/not-run (§8.3). Pair-space inside a gap is *unknown*.
2. **Planning-level gaps** — a run that fails or is cancelled **before a plan exists** has no units. It records a planning gap `{phase, cause}` (**the exhaustive planning-cause enum**, referenced by the ledger, §8.2, `RunOutcome.reasons` and the tests: cause ∈ `test-unavailable | model-not-bound | enumeration-failed | element-unresolvable | owner-mapping-mismatch | hierarchy-overlap | plan-too-large | cancelled | world-disposed`; `RunOutcome.reasons` carries `planning:<cause>`) and is `coverage: 'partial'` (never vacuously `full`), with `unitsTotal = 0`, `pairSpaceTotal = 0`, and `ledgerDigest` computed over the planning gaps alone.
3. **Declared exclusions** — `hierarchy-internal`: fragment pairs inside one root's subtree are never evaluated (§5.6.3). Correct by definition, not a gap; stated in provenance as `libraryExclusions: ['hierarchy-internal']`.
4. **Empty operands** — a selection whose roots are empty in every model yields `pairSpaceTotal = 0`, zero units, `coverage: 'full'` with `emptyOperand: true` and a `warnings[]` entry. It is **never claimable** as "no clashes" (§8.3 claim rule requires a non-empty required pair space). A `modelKey` with no live binding at the `queued → planning` snapshot fails the run at planning (`failed`, planning gap `model-not-bound`).

Plan-size guard: an *initial* plan of more than `maxUnitsPerRun` (provisional 10,000; the same cap also bounds runtime splits, §6.4) fails at planning with reason `plan-too-large` and **no units run** — deterministic, inexpensive, and tells the caller to narrow the selections.

---

## 7. Execution: orchestration over `findClashes`

### 7.1 `UnitExecutor` port

```js
/** @typedef {Object} ExecutionRequest        self-contained, plain data
 *  @property {WorkUnit} unit                   ranges only (§6.5, §6.5.1)
 *  @property {{sourceDbIds: number[], targets: Array<{modelKey: string, scope: 'whole'|'roots', dbIds?: number[]}>, scopeExpect: Array<{modelKey: string, role: 'source'|'target', scope: 'whole'|'roots', population?: {count: number, digest: string}, roots?: Array<{dbId: number, subtreeDigest: string}>}>}} materialized   transient expansion of the unit's ranges, planning-time digests included (§16.3); released when the attempt settles
 *  @property {string} runId
 *  @property {number} attempt
 *  @property {'volume-overlap'|'surface-intersection'|'containment'|'clearance'} mode
 *  @property {number} [clearance]              present iff mode === 'clearance'
 *  @property {'tlas'|'linear'} broadPhase
 *  @property {Array<{modelKey: string, modelVersion: string, bindingGeneration: number, placementGeneration: number}>} snapshot   the run snapshot for every model the unit touches (§16.3)
 */
/** @typedef {(request: ExecutionRequest) => Promise<UnitOutcome>} UnitExecutor */
```

`UnitOutcome` is **plain, structured-clone-safe data** (§11.2, §12). **Division of responsibility.** The *executor* owns everything that touches live models: it resolves bindings (from the registry it is constructed with), checks leases (§7.4), runs the pre/post **scope-digest checks** (§16.3.2) via the `ElementEnumerator`, reads the generations at start and end of the attempt, builds and awaits the library call (§7.2), maps the thrown/resolved result to a structured outcome, and **projects to plain data before returning** (live `Model` references never escape). The *engine* owns planning, split and retry **decisions** (from the structured `failure` data), merging, the ledger, and every status/coverage/integrity derivation. Because the request carries mode, clearance, broad phase and the run snapshot, and the outcome carries the structured `failure`, `scopeProof` and generations, any conforming executor yields the same plan and coverage. **Boundary validation.** The engine never trusts an executor: every returned outcome passes the pure function `validateUnitOutcome(request, outcome)` before anything is merged. It rejects — treating the outcome as `failed:internal-error`, which fails the run (§7.5) — any of: `unitId`/`attempt` not equal to the request's; `outcome`/`failure`/`scopeProof` inconsistent (`evaluated` requires `failure: null` **and** `scopeProof: 'equal'`); any non-plain value or non-finite number anywhere (`-0` is normalized to `0`); a pair or diagnostic naming a `modelKey` that is not a participant of the unit; a pair whose source owner is not in the `rootOwners` of the unit's source roots, or whose target owner (for an explicit-list target) is not in that root's `rootOwners` (a whole-model target owner must be in that model's `rootOwners` **or** its `unreachablePopulation.ownerDbIds` — anything else is out of scope and rejected); evidence not matching the mode's shape (§11.1); and **size limits on every executor-controlled field** — `pairs.length ≤ maxPairsPerOutcome` (checked *before* any deep processing; over-cap is a whole-unit `failed:result-cap` under the §17.1 result-cap rule, not a partial merge), diagnostic `reason` ≤ 128 code units and `failure.message` ≤ 512; statistics restricted to the known numeric schema (unknown keys rejected); at most `maxDiagnosticsPerOutcome` (provisional 200,000) diagnostics and `maxDistinctReasons` (provisional 64) distinct reasons per outcome. Overflow is **not** an error and not dropped: it collapses deterministically into sentinels — `diagnostic-reason-overflow` (a completeness-affecting `unit` taint) and `statistics-overflow` — so exact counts, `taints` and `countsByReason` stay bounded by a constant and integrity can only get *worse*, never better. AC-3 has a negative case for each. The default `LocalUnitExecutor` is the only implementation this spec defines: A future off-main-thread executor could implement the same port without changing the planner, aggregator, lifecycle, or result model — but extraction is main-thread-only in the Viewer (M4 §8.5), so this spec adopts no worker and makes no performance claim about one (D15, §17.4).

### 7.2 The call the executor makes

```js
world.findClashes({
  source: { model: sourceModel, dbIds: request.materialized.sourceDbIds },
  target: { targets: request.materialized.targets.map(t => t.scope === 'whole' ? { model } : { model, dbIds: t.dbIds }) },
  mode: definition.mode,
  groupBy: 'dbId',
  ...(definition.mode === 'clearance' ? { clearance: definition.clearance } : {}),
  broadPhase: runOptions.broadPhase,          // 'tlas' (default) | 'linear' (oracle; §15, §22)
})
```

- A `scope: 'whole'` target is the library's whole-model sentinel and is **re-extracted by the library on every call** (F1); its executed population is therefore *proven equal to the planning snapshot by the bracketed scope digests of §16.3, or the unit is not `evaluated`*. Explicit target lists are root dbIds fixed at planning and are proven the same way (subtree digests). The executor runs the pre/post digest checks around this call; the call itself is unchanged.
- Always the **`targets` shape** (never legacy `{model, dbIds}`), so the broad phase defaults to `'tlas'`, cross-model is legal, and `maxBroadPhaseInstancePairs` does not apply (F1, README M2). `'linear'` is an explicit oracle/verification option, subject to its own ceiling (a plain `Error` above 1,000,000 pairs per target epoch group — recognized by a **pinned matcher**, `error.message` starting with `findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs`, plus a T2 compatibility test that fails if the library stops throwing a matching error for an oversized linear call; a typed capacity error is listed as optional additive change §21.2 (g)); it is recorded in provenance.
- One mode per call (F1); composite Hard+Soft tests are two tests (§19.1).
- The engine passes fresh arrays (the library defensively copies, but the engine does not mutate plan data after issue).

### 7.3 Sequential execution and serialization

- **Strictly one `findClashes` in flight per world** from the engine layer, and **one running run per world**; further runs queue (`queued`, FIFO, bounded by slot accounting, §13.5.2, and `maxQueuedRuns`, default `maxResidentResultSets − 1`; slot accounting and `maxQueuedRuns` are **per engine**, while the FIFO queue and the single in-flight slot are **per world**). The queue **and the model registry (§4.3)** are owned by a **world-scoped coordinator** (a `WeakMap<CollisionWorld, Coordinator>` **stored on `globalThis` under `Symbol.for('clashtest.coordinators')`** so duplicate bundles or module copies in one page join the same coordinator rather than each creating their own; a coordinator carries a `protocolVersion`, and an engine copy with an incompatible version throws `ModelBindingError('coordinator-version-mismatch')` instead of running beside it) that every `createClashTestEngine({world})` joins, so two engines over one world share one queue and one in-flight slot rather than each believing it is alone. The guarantee is scoped honestly: the coordinator serializes *engine* runs; it cannot serialize direct `findClashes` callers (§19.1, OQ-11).
- Rationale (F13, F6): the library does not serialize callers' queries against each other (it single-flights only shared builds); a foreign growth/invalidation revision bump aborts an in-flight TLAS query; batch progress, cancellation and ledger accounting are all defined at unit boundaries. The engine cannot control *other* callers (e.g. the Clash Finder extension's single queries) — a `ModelPlacementChangedError` from foreign activity is handled by bounded retry (§7.5), and running the two concurrently is documented as unsupported for reliable batch throughput, not forbidden.
- Between units the engine yields to the scheduler (`interUnitYield`: animation-frame-aligned when available, else a macrotask). The library already yields *inside* a call at `frameBudgetMs`; the between-unit yield exists because M4 showed frames starve for 100–283 ms per query even when every task stays under ~25 ms (F14). Whether this yield is *sufficient* is a characterization item (AC-12), not a claim.

### 7.4 Lease handling

At run start the engine `admitModel`s every bound model it will touch and keeps the leases. Before every unit it checks `world.isLeaseValid(lease)` for each model the unit touches; an invalid lease turns the unit into `skipped:model-evicted` **without calling `findClashes`** (avoiding a `ModelEvictedError` from `admitModel`, F5, and wasted work). After any thrown `ModelEvictedError`, the engine identifies *which* binding died by re-checking leases — never by trusting the error's `modelId` (F12: not unique).

### 7.5 Error taxonomy → unit outcome

| Library signal | Unit outcome | Retry | Run effect |
|---|---|---|---|
| resolved, any diagnostics | `evaluated` (diagnostics normalized, §12) | — | continues |
| `ModelPlacementChangedError`, `placementGeneration` **unchanged** | retry same unit | ≤ `maxPlacementRetries` (provisional 2) | after limit: `failed:stale-placement` gap |
| `ModelPlacementChangedError`, `placementGeneration` **changed** (host called `notifyPlacementChanged`) | `discarded:input-changed` | none | run → `invalidated` after this unit (§16) |
| pre-check digest ≠ planning digest (§16.3.2) | `skipped:scope-drift` (no call issued) | none | run → `invalidated` at the next boundary |
| post-check digest ≠ planning digest (§16.3.2) | `discarded:scope-drift` (pairs/diagnostics not merged) | none | run → `invalidated` at the next boundary |
| digest could not be computed, pre or post (§16.3.2) | `skipped:` / `discarded:scope-unverifiable` (fail closed) | none | continues; unit is a gap |
| `ModelEvictedError` / invalid lease | `failed:model-evicted` (or `skipped:` if pre-checked) | none — an evicted Model can never be re-admitted (F5) | continues; units not touching that model still run |
| `WorldDisposedError` | `failed:world-disposed` | none | run → `failed`; all pending units `not-run` |
| `CapacityExceededError` `tlas-candidate-budget` / `clearance-narrow-phase-budget` | split (§6.4) or `failed:capacity-exceeded` | via split | continues |
| `CapacityExceededError` other kinds; plain `Error` from linear ceiling | `failed:capacity-exceeded` | none | continues |
| `ExtractionLimitExceededError` | `failed:extraction-limit` | none | continues |
| `ObjectTreeUnavailableError` | `failed:object-tree-unavailable` | none | continues |
| any other error (validation `Error`, `TypeError`, …) | `failed:internal-error` | none | **run → `failed`** (fail-fast: it means the engine built an illegal call; continuing would hide a defect) |

`continueOnUnitFailure` is fixed **true** for the non-fatal rows above; a run never stops on a single unit gap, but never reports a gap as covered (§12).

---

## 8. Run lifecycle

### 8.1 States

```text
                        ┌────────────── cancel ──────────────┐
queued ──► planning ──► running ──► (all units terminal) ──► completed
   │           │           │
   │           │           ├──► cancelling ──► cancelled
   │           │           ├──► invalidated        (input changed under the run)
   └── cancel ─┴───────────┴──► failed             (fatal: world-disposed, internal-error, plan/bind failure, result-cap)
```

Non-terminal: `queued`, `planning`, `running`, `cancelling`. Terminal: `completed`, `cancelled`, `failed`, `invalidated`. Terminal states are absorbing; a Result Set is sealed **exactly once**, at the transition into a terminal state (§13).

### 8.2 Transition rules

| From → To | Trigger |
|---|---|
| `queued → planning` | run reaches the head of the world's queue |
| `planning → running` | bindings resolved, leases held, enumerations done, plan within `maxUnitsPerRun` |
| `queued|planning → failed` | any planning gap of the **exhaustive planning-cause enum** (§6.6.2) other than `cancelled` (which goes to `cancelled`, below) — e.g. `test-unavailable` (stored-reference lookup, first step of `queued`), `model-not-bound`, `enumeration-failed`, `element-unresolvable`, `owner-mapping-mismatch`, `hierarchy-overlap`, `plan-too-large`, `world-disposed`. Sealed with zero units and `coverage: partial`. |
| `running → completed` | every unit reached a terminal unit outcome, no fatal condition occurred, and the end-of-plan input check (§16.3.3) found no input change |
| `running → cancelling` | `cancel()`; effective at the next unit boundary (§10) |
| `cancelling → cancelled` | the in-flight unit (if any) has settled |
| `queued|planning → cancelled` | `cancel()` before a plan exists: **planning is abandoned** (the current slice finishes, no further enumeration) and the run seals with **planning gap `cancelled`**, zero units, zero results, `coverage: partial`. No partial plan is retained (a half-enumerated plan would differ by timing). Once planning has completed and the state is `running`, the ordinary unit-boundary rules of §10.2 apply. |
| `running → invalidated` | input-changed condition (generation change or `scope-drift`) detected at a unit boundary (§16.3) |
| `running → failed` | `WorldDisposedError`, `failed:internal-error`, or `maxResultsPerRun` exceeded (§17.1) |

`completed` means **the engine finished its plan** — it says nothing about clash-freeness. Read `coverage`, `integrity` and `freshness` (§8.3) before drawing any conclusion.

### 8.3 Run outcome record

```js
/** @typedef {Object} RunOutcome
 *  @property {'completed'|'cancelled'|'failed'|'invalidated'} status
 *  @property {'full'|'partial'} coverage        'full' iff a plan exists, it has no planning-level gap, and every **leaf** unit was `evaluated` (`split` parents are superseded by their leaves; declared exclusions are not gaps, §6.6)
 *  @property {'clean'|'caveated'} integrity     'caveated' iff any completeness-affecting diagnostic — **attributable or not** (§12.2.1) — was recorded in evaluated pair-space (§12)
 *  @property {'current'|'stale'|'unverifiable'} freshness    (§16.4)
 *  @property {string[]} reasons                 machine-readable, e.g. 'unit:failed:capacity-exceeded', 'cancelled', 'model-evicted:<modelKey>'
 */
```

Unit outcomes: `evaluated`, `split` (superseded by two children, §6.4), `failed:<cause>`, `skipped:<cause>`, `discarded:<cause>`, `not-run:<cause>` where `<cause>` ∈ `model-evicted | world-disposed | stale-placement | capacity-exceeded | extraction-limit | object-tree-unavailable | internal-error | cancelled | result-cap | run-failed | input-changed | scope-drift | scope-unverifiable | unit-cap`. Every unit also carries `scopeProof ∈ {equal, drift, unverifiable, not-checked}` in the ledger (§16.3), and by invariant I-scope only `scopeProof: equal` units can be `evaluated`. `coverage = 'full'` iff a plan was built, there is **no planning-level gap** (§6.6.2), and no leaf unit is anything other than `evaluated` (hence full coverage *implies* demonstrated scope equality). A run that fails or is cancelled before a plan exists is therefore always `partial` — coverage is never vacuously `full`. A completed run over an empty required pair space is `full` with `emptyOperand: true` (§6.6.4).

**The claim rule (D7).** An engine consumer may present "no clashes found" for a test **only if** `status = 'completed' ∧ coverage = 'full' ∧ integrity = 'clean' ∧ freshness = 'current' ∧ pairSpaceTotal > 0 ∧ ¬emptyOperand ∧ unresolvedSelections = ∅ ∧ unreachablePopulation = ∅` (§6.2). Anything else is "no clashes found *in the evaluated, uncaveated region*", and the gap/caveat detail must be reachable. This is the library's "empty `pairs` is not a clean negative" rule (F7, F12) lifted to batch scale, and the engine exposes it as a single helper (`canClaimNoClashes(resultSet, currentFreshness)` — the second argument is **required**; it returns `false` when it is absent or not `'current'`, so a caller can never claim from the stale seal-time `outcome.freshness` alone) that additionally requires `results` to be empty when the claim is "no clashes found". An engine-bound form, `engine.canClaimNoClashes(runId) → Promise<boolean>` is **asynchronous** because it recomputes `getFreshness` (including the scope re-digest, §16.4) and is the recommended entry point; the standalone synchronous form only accepts an already-verified `Freshness` value. Terminal statuses other than `completed` are never claimable, whatever their axes say.


---

## 9. Progress reporting

### 9.1 Snapshot

```js
/** @typedef {Object} RunProgress
 *  @property {string} runId
 *  @property {'queued'|'planning'|'running'|'cancelling'|'completed'|'cancelled'|'failed'|'invalidated'} status
 *  @property {'queued'|'binding'|'enumerating'|'planning'|'executing'|'finalizing'|'terminal'} phase
 *  @property {number} seq                       monotone per run; every emitted event and snapshot carries it
 *  @property {number} unitsTotal                current LEAF units; may GROW (+1 per deterministic capacity split, §6.4); never shrinks; `split` records are not counted
 *  @property {number} unitsEvaluated
 *  @property {number} unitsFailedOrSkipped      failed + skipped + discarded + not-run
 *  @property {number} pairSpaceTotal            Σ pairSpaceWeight over the plan; CONSERVED by splits
 *  @property {number} pairSpaceEvaluated        Σ weight over `evaluated` units
 *  @property {number} pairSpaceProcessed        evaluated + failed/skipped/discarded (weight the run is done with)
 *  @property {number|null} fractionEvaluated   pairSpaceEvaluated / pairSpaceTotal        (0..1, monotone; null while pairSpaceTotal is 0)
 *  @property {number|null} fractionProcessed   pairSpaceProcessed / pairSpaceTotal        (0..1, monotone; reaches 1 on `completed` with a non-empty plan; null while pairSpaceTotal is 0)
 *  @property {number} resultsFound              distinct PairIds retained so far
 *  @property {number} caveatCount               completeness-affecting diagnostics recorded so far (exact count)
 *  @property {string|null} currentUnitId
 *  @property {number} elapsedMs                 wall-clock since run start; NOT part of any digest
 */
```

### 9.2 Rules

1. **Monotone.** `seq`, `unitsEvaluated`, `pairSpaceProcessed`, `pairSpaceEvaluated`, `fractionEvaluated`, `fractionProcessed`, `resultsFound` and `caveatCount` never decrease. `unitsTotal` may increase only through a split; because a split *conserves* `pairSpaceTotal`, the fractions never regress when it happens.
2. **Two fractions on purpose.** A progress bar wants `fractionProcessed` (reaches 1 whenever the run finishes its plan, even with gaps); a completeness readout wants `fractionEvaluated` (< 1 whenever any gap exists). The engine does not collapse them.
3. **Weights are estimates of *work*, not of *time*.** `pairSpaceWeight = |sources| × |targets|` in enumerated elements. The engine provides **no ETA**: unit cost is dominated by candidate density (F14) which is unknown until a unit runs, and M4 recorded no multi-process makespan. Consumers must not derive an ETA from these fractions and present it as one.
4. **Delivery.** `getSnapshot()` is always available and never torn (built at unit boundaries and state changes from committed state only). Events are emitted on every state change, on every unit completion (throttled to at most one `progress` event per `progressMinIntervalMs`, provisional 100 ms — state changes and the terminal event are never throttled), and **the terminal event is emitted exactly once**, after the Result Set is sealed and the first persistence attempt has settled **or the `persistTimeoutMs` wait has elapsed** (§13.5.1); a later `'persistence'` event reports the eventual outcome of a timed-out write.
5. **Listener isolation.** A listener exception is caught, counted (`listenerErrors`), and never propagates into the run. A slow listener lengthens main-thread time it consumes; that cost is the subscriber's, and the engine does not bound it.
6. During `queued`/`planning` the snapshot reports `phase` and the counters that exist (e.g. models enumerated of models total); unit counters are 0 until planning completes.

---

## 10. Cancellation

### 10.1 The constraint (F6)

There is no way to stop an in-flight `findClashes`. No `AbortSignal`, token, or deadline exists; checkpoints only poll lifecycle state. `evictModel`/`dispose()` do stop a call (at its next checkpoint) but **destructively**: `evictModel` permanently tombstones that `Model` object (a reload is required to use the model again) and `dispose()` kills the world. Neither may ever be used as a cancel mechanism. The roadmap §4 deliberately leaves cancellation policy to this layer.

### 10.2 Semantics

`cancel(reason?) → Promise<RunSummary>` — **cooperative, at Work-Unit boundaries**:

| Run state when `cancel()` is called | Effect |
|---|---|
| `queued`, `planning` | Immediately (planning is chunked; the current slice finishes) → `cancelled`. **Planning is abandoned**; sealed with planning gap `cancelled`, **no unit ledger**, zero results, `unitsTotal = pairSpaceTotal = 0`, `coverage: partial` (§6.6.2, §8.2). |
| `running`, unit in flight | → `cancelling`. **The in-flight unit is drained, not aborted or discarded**: it is a complete, valid, atomic evaluation (F7), so its result is merged. No further unit starts. Then → `cancelled`. |
| `running`, between units | → `cancelled` at once (no unit in flight). |
| `cancelling` | Idempotent; the first reason wins. |
| terminal | No-op; resolves with the existing summary. |

- **Cancel latency ≤ one unit's duration** (+ one slice) *to the `cancelled` state and seal*; the `cancel()` promise additionally follows §13.5.1 and may resolve up to `persistTimeoutMs` later. The library bounds neither a single call's duration (F14: one `clearanceQuery` non-preemptible span alone reached ~20 ms; a whole call is far longer) nor makespan, so the *only* lever is `maxSourceFragmentsPerUnit` (§6.4). The engine records `cancelRequestedAt`/`cancelSettledAt` in run telemetry so the latency can be characterized (AC-12) instead of promised.
- **Partial results are retained** (policy decision, roadmap "reject vs partial vs discard"): a cancelled run seals its evaluated results with `status: 'cancelled'`, `coverage: 'partial'`, and every unstarted unit in the (already-built) ledger as `not-run:cancelled`. Retaining is chosen because evaluated units are individually complete and the ledger makes their scope exact; **discard is a separate, explicit, host-initiated operation** (`discardRun`, §13.5.2), never a side effect of cancel; a cancelled run's sealed set is an ordinary resident set (`held` until persisted).
- **Cancel never** evicts, disposes, invalidates placement, or clears library caches.
- **Precedence.** The first terminal transition wins. A `cancel()` racing an `invalidated`/`failed` transition that already began yields that status; `freshness` is computed independently either way (§16.4).
- **`engine.dispose()`** cancels every active and queued run (each sealed as `cancelled`, reason `engine-disposed`), releases listeners and resident sets, and does not touch persisted results. `dispose()` is **asynchronous**: it synchronously marks the engine disposing (every other method now throws `EngineDisposedError`, and the world coordinator stops admitting its runs), requests cancellation of every run, and returns a `Promise<DisposeSummary>` that resolves only **after every run has drained its in-flight unit (§10.2) and sealed as `cancelled`** — so the summary is final: `{ droppedUnsaved: runId[], persistenceInFlight: runId[] }`. It does not wait for pending persistence writes (they continue detached); it never throws and never drops unsaved sets silently (§13.5.2). Repeated calls return the same promise.

### 10.3 Optional future library seam (not required)

An additive `signal` option on `findClashes` (checked at existing checkpoints) would reduce cancel latency from "one unit" to "one atomic span". It is **not** needed for correctness and is **not** part of this milestone; if ever proposed, it is a collision-core change subject to roadmap §8 (§21). This spec's design is correct with or without it.

---

## 11. Results

### 11.1 `ClashResult` (plain data)

```js
/** @typedef {Object} ClashResult
 *  @property {string} resultId                      canonical string of (testId, semanticDigest, PairId)  (§4.4)
 *  @property {{first: ElementRef, second: ElementRef}} pair
 *  @property {'volume-overlap'|'surface-intersection'|'containment'|'clearance'} mode
 *  @property {{source: ElementRef, target: ElementRef}} evaluatedAs   library orientation the retained evidence came from
 *  @property {Evidence} evidence
 *  @property {{witnessUnavailable?: true, duplicateEvidenceConflict?: true, unreachableOwner?: true}} flags
 *  @property {string} unitId                        the unit that produced the retained evidence
 */
/** @typedef {{witness: {kind:'surface-crossing'|'containment', point:[number,number,number]} | null}   // volume-overlap
 *          | {distance:number, clearance:number, closestPoints:{first:[number,number,number], second:[number,number,number]}} // clearance
 *          | {}                                                                                      // surface-intersection, containment
 *          } Evidence
 */
```

- **Evidence is orientation-independent in shape.** The library's `clearance` witness is `{sourcePoint, targetPoint}` where `sourcePoint` lies on the library-source operand (README M3). The engine re-keys it to `closestPoints.first/second` using `evaluatedAs`, so the same physical pair yields the same evidence *shape and meaning* whichever element the planner labeled source. Hard-Clash `witness.point` is a single world-space point and needs no re-keying. **Consumers must branch on `mode`**, never assume one witness shape (a hazard already hit once, live, in M3 acceptance).
- Coordinates are exactly the library's Viewer scene/world coordinates; the engine performs no unit or frame conversion (the same trust boundary M2/M3 already rely on).
- `witnessUnavailable: true` mirrors the library's `witness-unavailable` case: the pair verdict is complete, only the point is missing (F12).
- Live `Model` references, `modelId`, `epoch`, `fragmentId` and `geometryIndex` **never** appear in a `ClashResult`.

### 11.2 `UnitOutcome` (the executor's plain-data return)

```js
/** @typedef {Object} UnitOutcome
 *  @property {string} unitId
 *  @property {number} attempt
 *  @property {'evaluated'|'failed'|'skipped'|'discarded'} outcome
 *  @property {'equal'|'drift'|'unverifiable'|'not-checked'} scopeProof   §16.3.2; `evaluated` requires `equal` (invariant I-scope)
 *  @property {null | {code: string,                    // a §8.3 cause
 *                     errorName?: string, message?: string,
 *                     capacityKind?: string,           // CapacityExceededError.kind, so the engine can decide split vs gap (§6.4)
 *                     modelKeys?: string[],            // affected models (drift/eviction/freshness reasons)
 *                     retryable?: boolean}} failure    null iff outcome === 'evaluated'
 *  @property {{start: Array<{modelKey: string, bindingGeneration: number, placementGeneration: number}>, end: Array<{modelKey: string, bindingGeneration: number, placementGeneration: number}>}} generations   read at attempt start/end (§16.3.1)
 *  @property {Array<{source: ElementRef, target: ElementRef, type: string, witness?: object, distance?: number, clearance?: number}>} pairs   // library orientation, projected
 *  @property {NormalizedDiagnostic[]} diagnostics
 *  @property {Record<string, number>} statistics       numeric library statistics, unit-local
 *  @property {number} durationMs
 */
```

The executor performs the `modelId → modelKey` mapping for diagnostics from the unit's own binding table (F12: `modelId` is not unique). Within one unit all participating models are simultaneously live and distinct; if two participating models nevertheless report the same `modelId`, the diagnostic's `modelKey` is `null` and it carries `ambiguousModelId: true` — never a guess — and its `attribution` is `unit` (§12.2.1). The executor preserves the library's `dbId: null` verbatim and returns each unit's diagnostics **before** any de-duplication so the engine can build the per-unit `taints` table.

### 11.3 Canonical ordering and determinism of the set

Results are stored **sorted ascending by `(pair.first.modelKey, pair.first.dbId, pair.second.modelKey, pair.second.dbId)`**, a total order independent of library insertion order, broad-phase choice (TLAS/linear order differs — F3), unit boundaries and execution order. Sorting/merging is done in bounded slices (§17.3).

### 11.4 Reconciliation rules

1. **Unit-local aggregation is the library's.** A source *root* lives in exactly one unit of its cell, and targets are never split by the engine; every fragment of a source root and of a target root is therefore inside one unit. Every **owner-level** pair (whose owners lie inside a source root and a target root) is thus evaluated entirely within that one unit, so the library's deterministic `dbId`-level winner selection (witness/`distance` tie-break by `fragmentId`, F3) is unaffected by unit sizing or splitting.
2. **Cross-unit duplicates.** By cell construction over subtree-disjoint roots (§5.6) each required pair is scheduled exactly once, so duplicates are not expected; the rule below is a defensive backstop that also covers a future planner substitution (OQ-5). Rule: keep the record whose `evaluatedAs.source` equals `pair.first` (canonical orientation), else the lowest `unitId` in plan order. If the duplicate records **disagree on hit/miss** (impossible for the deterministic modes, possible for the time-sensitive ones), keep the positive, set `flags.duplicateEvidenceConflict`, and count it as an integrity caveat.
3. **Rank-6 residue (F11).** For `volume-overlap`, a pair that ties through geometry rank 5 (including byte-identical geometry) resolves by the caller's source label. The engine's source/target role assignment for each pair is a **deterministic function of the definition and the sorted enumerations only** (cell rules, §6.3) and never of sizing options, so verdicts remain repeatable; they may differ from the verdict a *different* role assignment would give, and the engine does not attempt to detect or arbitrate that. Invariant **P2** (§15): *verdicts are independent of unit sizing, chunking, capacity splitting, execution order, and broad-phase choice; at the rank-6 residue they additionally depend on the definition-derived role assignment.*
4. A pair present in no unit's `pairs` is **absent**, not "negative" — its status is read from coverage and caveats (§12).

---

## 12. Diagnostics and completeness at batch scale

### 12.1 What must not change

`findClashes` distinguishes *thrown* (whole call fails, no partial result) from *diagnosed* (call resolves; the answer may be incomplete). An empty `pairs` is not "no clash". The batch layer preserves both distinctions and adds the third the library cannot: **a unit that never produced an answer at all** (a gap).

### 12.2 `NormalizedDiagnostic`

```js
/** @typedef {Object} NormalizedDiagnostic
 *  @property {'fragment'|'pair'} scope
 *  @property {string} reason
 *  @property {boolean} completenessAffecting       from isCompletenessAffecting(reason)
 *  @property {'element'|'target-model'|'unit'} attribution   how far the diagnostic can be pinned down (§12.2.1) — derived structurally, never defaulted upward
 *  @property {{modelKey: string|null, dbId: number|null, fragId: number, role?: 'source'|'target'}} [fragment]   // scope 'fragment'; dbId is NULL for unattributable diagnostics
 *  @property {{first: object, second: object}} [fragments]                                                    // scope 'pair': each {modelKey|null, dbId|null, fragId}
 *  @property {boolean} [ambiguousModelId]
 *  @property {number} occurrences                  across all units, after de-duplication
 *  @property {string[]} unitIds                    first `maxUnitIdsPerDiagnostic` (provisional 8) units it appeared in
 */
```

`fragId` is retained as **diagnostic detail only** (session-local; empirically stable on identical-model reloads, not contractual). Durable element attribution uses `(modelKey, dbId)` — for an attributed diagnostic the `dbId` is the fragment's `ownerDbId`.

#### 12.2.1 Attribution classes (unattributable diagnostics are first-class)

The library emits two reasons whose `fragment.dbId` is **always `null`**, both only from whole-model *target* extraction (`extractAllFragments`, F17): `fragment-not-loaded` (checked before any owner lookup) and `fragment-owner-unresolvable` (`fragList.getDbIds` returned `undefined`, or an array for a 2D-style model). In both cases the fragment is **dropped** — no record is created, so it never becomes a candidate, and any clash it would have been part of is silently not found; the diagnostic is the only signal. The model of §12 therefore must not assume a numeric `dbId`. Every diagnostic is classified by a pure function `attributionOf(diagnostic, unitBindingTable)`:

| `attribution` | When (structural test; a diagnostic is `element` only if it passes the `element` test, else `target-model` if it passes that, else `unit`) | Taint scope (§12.5) |
|---|---|---|
| `element` | every fragment operand the diagnostic names has a numeric `dbId` **and** a resolved `modelKey` | the named owner element(s) and, for `scope:'pair'`, that fragment pair |
| `target-model` | `scope:'fragment'`, `role:'target'`, `dbId` is `null`, `modelKey` resolved (i.e. today's two whole-model reasons) | **every required pair whose covering unit's target side includes that `modelKey` as a whole-model scope** — the dropped fragment could belong to any root of that model and pair with any of the unit's sources |
| `unit` | anything else that lacks a numeric `dbId` or a resolved `modelKey` (ambiguous `modelId`, an unrecognized shape, a non-null-but-non-numeric `dbId`) | **every required pair of the unit that reported it** |

The test is on *shape*, not on a reason whitelist, so a future library diagnostic that lacks attribution degrades to `unit` (fail-safe), never to "harmless". Unattributable diagnostics are never dropped or de-numbered into `dbId: 0`/`-1` sentinels: `dbId` stays `null`.

**Taint records are exact and separate from the retained-diagnostic cap.** For every unit the engine records, from that unit's own diagnostics *before* any cross-unit de-duplication or cap, a `taints` table in the ledger with **three** entry kinds, all exact and independent of the global de-duplicated list: `{kind: 'target-model'|'unit', modelKey: string|null, reason, occurrences}` (keyed by `(kind, modelKey, reason)`; tiny) and `{kind: 'element', modelKey, dbId, reason, occurrences}` — one entry per *implicated owner element* per reason (a `scope:'pair'` diagnostic implicates **both** of its owner elements; the engine deliberately taints at owner-element granularity rather than fragment-pair granularity so the record stays small and conservative). Element entries are bounded per unit by `maxElementTaintsPerUnit` (provisional 2,000); when a unit would exceed it, the surplus is **not dropped** but collapsed into one `{kind: 'unit', reason: 'taint-overflow'}` entry (fail-safe: the whole unit becomes tainted). Retained-diagnostic truncation (§12.4) and the `maxUnitIdsPerDiagnostic` unit-id cap can therefore never lose a taint. `ledgerDigest` covers the `taints` tables.

### 12.3 The completeness predicate — one place, fail-safe

```text
isCompletenessAffecting(reason) = (reason !== 'witness-unavailable')
```

That single carve-out is the library's documented one (README M2.1): a `volume-overlap` verdict is fully determined before witness capture, so a missing marker point leaves the pair complete. **Every other reason counts**, including all four `clearance-*` reasons (for clearance "the distance is the verdict", so the M2.1 precedent deliberately does not transfer), and **any reason the engine does not recognize** (a future library diagnostic must default to "may be incomplete", never "harmless"). Known reasons today (informative, verified as literals in `collision/`): `fragment-not-loaded` (**unattributable**, `dbId: null`), `fragment-owner-unresolvable` (**unattributable**, `dbId: null`), `geometry-not-yet-available`, `unsupported-geometry-layout`, `rejected-primitive-range`, `geometry-too-large-for-sync-build`, `geometry-aspect-ratio-exceeds-tolerance-model`, `index-references-invalid-vertex`, `crossing-budget-exhausted`, `inconclusive-crossing`, `inconclusive-containment`, `incomplete-component-coverage`, `non-manifold-component`, `unverified-open-component`, `unverified-parity-operand`, `clearance-invalid-transform`, `clearance-anisotropic-scale-unsupported`, `clearance-hard-clash-precheck-inconclusive`, `clearance-distance-unavailable`, and `witness-unavailable` (the one non-affecting reason). The predicate, not this list, is normative; the plan adds a test that fails when `collision/` gains a `reason:` literal the engine's known-reason table lacks (so a new reason is *consciously* classified rather than silently defaulted).

### 12.4 De-duplication, caps, and what stays exact

At batch scale one run can emit orders of magnitude more diagnostics than one query (R1 alone: ~1,709 per single-source query — F12). Therefore:

- **De-duplicate across units**: fragment scope by `(reason, modelKey, fragId)` (a `null`-`dbId` diagnostic is keyed the same way, `fragId` being its only handle); pair scope by `(reason, canonical pair of (modelKey, fragId))`; a diagnostic with a `null` `modelKey` is never merged with one from another unit (its `unit`-attribution is per unit). `occurrences` and the first `maxUnitIdsPerDiagnostic` unit ids are kept. De-duplication is a *presentation* reduction only: taint is computed per unit beforehand (§12.2.1).
- **Cap retained detail** at `maxRetainedDiagnostics` (provisional 10,000). Beyond it, detail is dropped in **canonical order** (so *which* are kept is deterministic) and `diagnostics.truncated = true`.
- **Counts are never capped**: `countsByReason[(scope, reason)]` and `completenessAffectingCount` are exact, and **`integrity` is computed from the exact counts**, never from the retained list.
- **Diagnostics are per-call facts, not per-pair facts.** Counting them is not counting affected pairs (README "Diagnostics"): a fragment-scoped diagnostic (e.g. `clearance-invalid-transform`) fires before any pair exists. The engine reports diagnostic counts and, separately, the set of *elements* implicated **plus the unit-level taint tables for diagnostics that implicate no element** (§12.2.1) — an empty implicated-element set with a non-empty taint table is *not* "nothing affected".

### 12.5 The three axes and the element-level view

| Axis | Values | Derived from |
|---|---|---|
| `coverage` | `full` / `partial` | ledger: a plan exists, no planning-level gap, every leaf unit `evaluated` (`split` records excluded, §6.4) (declared exclusions are not gaps, §6.6) |
| `integrity` | `clean` / `caveated` | exact `completenessAffectingCount > 0` or `duplicateEvidenceConflict` |
| `freshness` | `current` / `stale` / `unverifiable` | §16.4 |

Statement matrix (what a consumer may claim):

| coverage | integrity | freshness | May claim |
|---|---|---|---|
| full, `status: completed`, non-empty required space, `¬emptyOperand`, `unresolvedSelections = ∅`, `unreachablePopulation = ∅` | clean | current | "No clashes found" (when `results` is empty) / "Exactly these clashes" |
| any, with `unresolvedSelections ≠ ∅` or `unreachablePopulation ≠ ∅` | any | any | **No** "no clashes" claim; results and absences are valid only outside the unresolved/unreachable elements |
| full | caveated | current | Results are correct as reported; **absences are not proven** for any pair `getPairStatus` reports `covered-caveated` (element-attributed caveats, or `target-model`/`unit` taints of the covering unit, §12.5) |
| partial (incl. any planning-level gap) | any | any | Results are correct for evaluated pair-space only; absences inside gaps are **unknown** |
| any status other than `completed`, or empty required space | any | any | **No** "no clashes" claim, ever |
| any | any | stale / unverifiable | Results describe a **previous** model/placement state |

**Pair level (required by comparison, §15.4):** `getPairStatus(resultSet, pairId) → { required, coveringUnitId, unitOutcome, roots: {first, second}, caveats: {reason, count, attribution}[], verdict: 'covered-clean' | 'covered-caveated' | 'gap' | 'not-required' | 'undetermined' }`. It checks that the pair's **roots** (via the ledger's `rootOwners` table) were actually paired in an evaluated unit, then applies the **taint rule**, reports `not-required` for a result whose owner is in the model's `unreachablePopulation` (§6.2, outside the required pair space), and reports `undetermined` only when an owner dbId is absent from the ledger's `rootOwners` table (a defensive case: a set produced by a foreign/older writer, or an owner outside every planned root). Element-level status alone can never establish that a *pair* was asked about.

**Taint rule (normative).** Let `u` be the pair's covering unit (unique: each required pair is scheduled exactly once, §6.3) and `T` the model of the pair's *target-side* operand in `u`'s orientation. The verdict is `covered-clean` **only if none** of these holds; if any holds it is `covered-caveated` and `caveats` lists them:
1. `u`'s `taints` table (§12.2.1) has an `element` entry for either of the pair's owner elements (this reads the exact per-unit table, **never** the capped/de-duplicated retained-diagnostic list or its `unitIds`);
2. `u`'s `taints` table (§12.2.1) has a `target-model` entry for `modelKey = T` **and** `u`'s target scope for `T` was a whole-model scope (an unattributable dropped target fragment can only matter to a whole-model target, and *always* matters to every source of that unit);
3. `u`'s `taints` table has any `unit` entry;
4. the run's `duplicateEvidenceConflict` flag is set for this pair;
5. the Result Set's `outcome.freshness` at seal was not `current` (a mixed/stale-input run never yields clean absences; §16.4).

Rules 2–3 make unattributable evidence taint *coverage-level* claims rather than disappear for lack of an element: a `fragment-not-loaded` diagnostic in a whole-model target scope makes **every** pair between that unit's sources and that model `covered-caveated`, whatever the element attribution of the rest of the diagnostics. Clashes actually reported in `results` remain valid positives — caveats only weaken *absences*.

`getElementStatus(resultSet, elementRef) → { inRequiredPairSpace, coverage: 'full'|'partial'|'none', caveats: {reason, count, attribution}[], gapCauses: string[] }` is the foundation for a per-element "clean/unknown" indication; it is derived from the ledger (element ∈ a non-evaluated unit's source set or target scope), the `element`-attributed diagnostics' `dbId`s, **and the same taint tables**: an element in the source roots of a unit with any `unit` taint, or in the target scope of a whole-model target with a `target-model` taint, reports those caveats (with their `attribution`) rather than an empty list. The Panel decides how to present it.

### 12.6 Library statistics

Per-call `statistics` are aggregated per run as *sums of count fields*, `libraryMsTotal` (sum of in-call wall-clock), and `maxUnitMs`. They are informational and **excluded from every digest** (timings are wall-clock and load-dependent). TLAS-specific fields are zero under `'linear'` and are not comparable across broad-phase choices except `broadPhasePairs`/`narrowPhasePairs` (M2 §7.5); `tlasBuildMs` counts only builds a call itself initiated, so summing across units under-attributes shared builds. `blasBuilt`/`blasCacheHits` are currently always `0` in the library (README) and are not reported as facts.

---

## 13. Durable Result Set

### 13.1 Structure

```js
/** @typedef {Object} ResultSet
 *  @property {1} schemaVersion
 *  @property {string} runId
 *  @property {{testId: string, revision: number, semanticDigest: string}} testRef
 *  @property {ClashTestDefinition} definition               full embedded copy (self-describing)
 *  @property {string|null} derivedFromRunId                 set by rerun (§15.3)
 *  @property {RunOutcome} outcome                           freshness here is the value AT SEAL time
 *  @property {Provenance} provenance
 *  @property {Ledger} ledger                                units (outcome, cause, `scopeProof`, exact per-unit `taints` table with `element`/`target-model`/`unit` entries), `rootOwners`, `unresolvedSelections`, `unreachablePopulation`, planning gaps, splits, gaps, declared exclusions, empty-operand warnings
 *  @property {ClashResult[]} results                        canonical order (§11.3)
 *  @property {{retained: NormalizedDiagnostic[], countsByReason: object, completenessAffectingCount: number, truncated: boolean}} diagnostics
 *  @property {object} statistics                            aggregated, informational (§12.6)
 *  @property {{digestVersion: 1, pairSetDigest: string, ledgerDigest: string}} digests   "sha256:<hex>" over canonical JSON (§5.4)
 *  @property {true} sealed
 */
```

- `pairSetDigest`: digest (format §5.4) over the canonical ordered list of `(resultId, flags)` — **exact discrete content only**; equal digests establish identical pair membership and flags **and nothing about float evidence** (§15.4).
- `ledgerDigest`: digest over the deterministic ledger content (unit ids, source/target sets, outcome kinds, causes, per-unit `scopeProof` and `taints` tables, planning gaps, and the sizing options) — **excluding** timings, attempt counts, and wall-clock.
- Floating-point evidence (witness points, distances) is **not** digested: cross-machine bit-equality of float evidence is not something the library promises, so the diff (§15.4) compares it by tolerance instead.

### 13.2 Provenance

```js
/** @typedef {Object} Provenance
 *  @property {string} registrySessionId                 nonce of the WORLD-SCOPED registry (§4.3) the run bound against; any engine over the same world shares it (freshness, §16.4)
 *  @property {string|null} libraryVersion             host-supplied; null ⇒ cross-build repeatability is not asserted (§1.3)
 *  @property {'tlas'|'linear'} broadPhase
 *  @property {'deterministic'|'time-sensitive'} determinismClass   from the mode (§15.1)
 *  @property {object} runOptions                      sizing options (folded into ledgerDigest)
 *  @property {Array<{modelKey: string, modelVersion: string, scopeKinds: ('model'|'elements')[],
 *                    elementCount: number,
 *                    scopeDigests: { population: {count: number, digest: string}|null,
 *                                    roots: Array<{dbId: number, subtreeDigest: string}> },   // plan-time, §6.2.1
 *                    bindingGeneration: number, placementGeneration: number}>} models
 *  @property {{method: 'bracketed-digest', digestVersion: 1}} scopeProof   how executed-scope equality with the planning snapshot was demonstrated per unit (§16.3); never 'exact'
 *  @property {string[]} libraryExclusions             e.g. ['assembly-rooted-self-exclusion']
 *  @property {false} placementVerified                the engine never reads or hashes model placement transforms
 *  @property {{viewerVersion?: string, userAgent?: string}} [environment]   host-supplied; not digested
 *  @property {string} startedAt                       ISO 8601 wall-clock; not digested
 *  @property {string} finishedAt                      ISO 8601 wall-clock; not digested
 */
```

`placementVerified: false` is deliberate and honest: model placement (federation alignment) affects every geometric verdict, the library cannot verify it (M2 §6.5), and this layer records only a session-local generation counter. A Result Set loaded in a later session therefore has `freshness: 'unverifiable'` for placement (§16.4).

### 13.3 Immutability and sealing

- A Result Set is **sealed exactly once**, at the transition into a terminal state, and is immutable afterwards — **enforced, not merely promised**: sealing includes a *deep freeze* (performed in the sliced main-thread discipline, §17.3) of the set and of every definition the engine stores or exposes, so `done`, `getResultSet`, `getTest` and every store input/output are frozen objects (a caller mutation throws in strict mode / is a no-op and can never change digests, coverage or persisted content). **Ownership at each boundary:** a `ResultStore`/`ClashTestStore` receives frozen objects and **must not mutate them and must copy on write and on read** (the in-memory reference implementation uses `structuredClone` both ways); the engine deep-freezes anything a store returns before exposing it. AC-11 has mutation-attempt tests for `saveTest`, `done`, `getResultSet` and both reference stores. Annotation layers (§14.5) live beside it, never inside it.
- **In-progress runs are volatile in v1.** Nothing is persisted mid-run; a run interrupted by a page reload or crash is lost (no half-written durable state). Resumption is a non-goal (§23); a rerun is the recovery path.

### 13.4 Serialization rules (structured-clone / JSON safety)

A sealed Result Set must round-trip through `structuredClone` and `JSON.stringify/parse` with **semantic equality** (every number is finite and `-0` is normalized to `0` at projection so JSON's `-0 → 0` cannot cause a difference; no bit-level float claim is made). Therefore it contains only plain objects, arrays, strings, finite numbers, booleans and `null`. Forbidden anywhere inside it: `Model` or any Viewer object, functions, `THREE` objects, `Map`/`Set`, `undefined` values, and non-finite numbers (a non-finite evidence value would be treated as unavailable with a diagnostic; the library already guarantees finite witness points or omits the pair). This is the direct, permanent answer to the M1-gate crash (F4): the engine's projection boundary is the `UnitExecutor`, so a live `Model` cannot reach a Result Set, a store, or a worker message. AC-11 asserts it.

### 13.5 `ResultStore` port

```text
put(resultSet, { signal? }) → Promise<void>          atomic: a set is fully visible or not at all; rejects with IdentityConflictError on a modelKey→modelVersion conflict (§4.2)
get(runId) → Promise<ResultSet|null>
list({ testId?, limit?, cursor? }) → Promise<{ summaries: ResultSetSummary[], next?: cursor }>   // header only: outcome, counts, digests, testRef, models[{modelKey, modelVersion}], times
delete(runId) → Promise<void>
```

**`runId` and create-only persistence.** `runId` is engine-generated as a random, globally collision-resistant identifier (UUIDv4 via `crypto.randomUUID`, or ≥ 122 bits of CSPRNG output) — never a counter — so two sessions cannot mint the same id. `put` is **create-only and atomic**: if `runId` is absent the set is inserted; if present with **identical** canonical content the call succeeds idempotently; if present with **different** content it rejects with `RunIdConflictError` and changes nothing (the conflict check and the insert are one atomic step). The `modelKey → modelVersion` identity index of §4.2 is **independent of result lifetime**: `delete` never removes its entries, so deleting results cannot re-open a key to a different version.

- The plan provides an in-memory reference implementation; **storage backends (IndexedDB, server, file) and retention/quota policy are host/Panel decisions** (§23).
- Persistence failure **never alters the run's outcome**. The Result Set is sealed *before* the persistence attempt.

#### 13.5.1 Persistence state and the `RunHandle` promise contract

A Promise settles once, so the lifecycle is specified as **three distinct observables**, each with exactly one meaning:

**Persistence state** (per Result Set; a value, not a promise): `skipped` (no store configured, or `runOptions.persist === false`) · `pending` (a `put` is in flight) · `saved` (`put` resolved) · `failed` (`put` rejected, incl. `identity-conflict`; carries `{name, message}`). `saved`, `failed`, `skipped` are the only *final* states of an attempt; **`timeout` is not a persistence state** — it describes only the *waiting window* below.

1. **`done: Promise<RunSummary>`** — resolves **exactly once** and **never rejects** for any run or persistence outcome (`cancelled`, `failed`, `invalidated` and a failing/hanging store all still *resolve*). It resolves at the first of: (a) the sealed set's first persistence attempt has settled, or (b) `persistTimeoutMs` (provisional 5,000) has elapsed since seal — and in both cases only after the terminal `state` event has been emitted. `RunSummary = { runId, status, resultSet, persistence: PersistenceSnapshot }` with `PersistenceSnapshot = { state: 'skipped'|'pending'|'saved'|'failed', timedOut: boolean, attempt: number, error?: {name, message} }`. **Timeout is represented as `{state: 'pending', timedOut: true}`** — the wait window expired with the write still in flight; it is a statement about the observer's wait, not a persistence outcome. The sealed `resultSet` carries no persistence information (it is immutable and sealed *before* persistence).
2. **`persisted: Promise<PersistenceOutcome>`** — settles **exactly once**, always by *resolving* (never rejecting), when the **first** persistence attempt settles: `{state: 'saved'} | {state: 'failed', error} | {state: 'skipped', reason: 'no-store'|'persist-false'}` (`skipped` resolves at seal). It has **no timer** and **never reports `timeout`**: if `done` timed out, `persisted` simply remains pending until the detached write settles, and then reports the eventual `saved`/`failed`. If the backend never settles, `persisted` never settles (deliberately not on the lifecycle critical path) and the set stays `held` (§13.5.2) so it is never silently dropped.
3. **Persistence continues after `done`.** The timed-out write is not cancelled or abandoned; it runs detached. The eventual outcome is observable three ways, all consistent: the `persisted` promise; `getPersistenceState(runId)` (a synchronous `PersistenceSnapshot` for late observers); and a `'persistence'` event delivered to subscribers (subscriptions stay valid after the terminal event **for this event only**).
4. **Later attempts.** `retryPersist(runId) → Promise<PersistenceOutcome>` starts a new attempt for a set whose state is `failed`; each attempt has its **own** promise and `attempt` number; `handle.persisted` remains the first attempt's outcome, never rewritten. No timer applies to a retry.
5. **`cancel(reason?)`** returns the same `Promise<RunSummary>` (same waiting rule) as `done` would; calling it on a terminal run resolves with the existing summary.
6. **Phase during the wait.** From seal until `done` resolves, `getSnapshot()` reports the terminal `status` with `phase: 'finalizing'`; it becomes `'terminal'` when `done` resolves. The terminal `state` event is emitted **once**, at the same point `done` resolves, carrying the `PersistenceSnapshot`.

#### 13.5.2 Resident result sets: a hard memory bound

`sealed` means immutable and complete; `saved` means a store confirmed a durable copy. A sealed set that is not `saved` is **unsaved durable state**.

`maxResidentResultSets` (provisional 4) is a **hard cap that also counts runs in flight**. Each run holds one *slot* from admission (`startRun`/`rerun` accepted, including `queued`) until its resident set is released; `slots = active runs (queued, planning, running, cancelling) + resident sets ≤ maxResidentResultSets`, always. Each resident set is itself bounded by the per-run caps (`maxResultsPerRun`, `maxRetainedDiagnostics`, `maxUnitsPerRun`, the exact taint tables) and annotation snapshots (bounded by count, string length and `maxAnnotationBytes`, §14.5, and released with their set); host-supplied strings recorded in a set are length-capped (`modelKey`/`modelVersion` ≤ 1,024 code units, `libraryVersion` ≤ 256, each `environment` field ≤ 512; over-length ⇒ `ModelBindingError`/`InvalidOptionsError`), so resident engine memory ≤ `maxResidentResultSets` × a constant (the engine drops its own references to a `RunSummary`/handle on release; a `RunSummary` the *caller* still holds is caller-owned memory outside this bound); the actual bytes-per-set figure is **not measured** (AC-12 measures it; `retentionReport()` exposes `slotsInUse` and per-set class).

Every resident set has exactly one **class**:

| Class | Condition | Auto-evictable? |
|---|---|---|
| `evictable` | persistence `saved`, no outstanding retain lease | **yes**, least-recently-used first (LRU by seal time, refreshed by `getResultSet`) |
| `retained` | `saved`, with ≥ 1 outstanding lease from `retainResultSet` | no, until every lease is `release()`d |
| `held` | persistence `skipped`, `pending` or `failed` (unsaved durable state — possibly the only copy) | **never** — not by the engine, ever |

**Cap-reached behavior (admission).** At `startRun`/`rerun`, after validation succeeds, synchronously: (1) if a slot is free, admit; (2) else evict the LRU `evictable` set — safe, because a confirmed durable copy exists and `getResultSet` re-reads it — and admit; (3) else **refuse**: throw `ResultCapacityError{cap, active: runId[], retained: runId[], held: {runId, persistence}[]}`. Refusal is the backpressure: the engine never queues waiting for a slot, never drops a `held` set, and never exceeds the cap. Because queued runs occupy slots, the effective queue depth is bounded by slot accounting; `maxQueuedRuns` (default `maxResidentResultSets − 1`) may only lower it. Sealing converts the run's own slot into the resident set, so **sealing can never fail for lack of a slot**.

**No-store and failed-store mode.** With no store (or `persist: false`) every sealed set is `held`; the engine is a *`maxResidentResultSets`-run engine until the caller intervenes*. That is the intended, visible consequence of "never silently drop unsaved state", not a leak.

**How a caller retains or discards intentionally** (all explicit; none is a side effect of cancel, dispose-by-GC, or another run):
- `retainResultSet(runId) → { release() }` — keeps a `saved` set resident (a retained set still occupies a slot; a caller that retains every slot starves admissions and gets `ResultCapacityError`, by design).
- `releaseResultSet(runId, { acknowledgeUnsaved? })` — drops the **resident copy only** (durable copy, if any, untouched). Refused with `ResultSetRetainedError` while leases are outstanding, and with `UnsavedResultSetError` for a `held` set unless `acknowledgeUnsaved: true` (the caller asserts they took the set via `getResultSet` and persisted it elsewhere).
- `discardRun(runId)` — release-with-acknowledgement **plus** `resultStore.delete(runId)` (chained after any in-flight `put` settles, so a late write cannot resurrect it; for a hung write the returned promise does not resolve until the write settles). **A set whose `put` is still in flight keeps its slot until that write settles** — `releaseResultSet` and `discardRun` free the slot only at settlement (after `dispose()` the accounting is moot, see below) — so detached writes are *inside* the hard bound: repeated hung writes exhaust slots and yield `ResultCapacityError` (whose `held` list marks them `pending`), never unbounded retained sets. `ResultStore.put(resultSet, { signal })` receives an `AbortSignal` that `discardRun` aborts (a cooperating backend may then settle promptly); a backend that ignores it simply keeps the slot occupied. It is valid **only for a terminal run** (`cancel` first; otherwise it throws `RunNotTerminalError`) and with no configured store it simply releases the resident copy (nothing to delete). It is the only operation that intentionally destroys unsaved state, and it is explicit and host-initiated.
- `retryPersist(runId)` — converts a `failed` `held` set into an `evictable` one once a write succeeds.
- `getResultSet(runId)` — returns the resident set if resident; otherwise reads the store **without making it resident** (read-through, not cached: the caller owns that copy and the engine's bound is unaffected).
- `engine.dispose() → Promise<DisposeSummary>` — after every run has drained and sealed (§10.2), releases all resident sets, but **never silently**: `droppedUnsaved` names every `held` set with no write in flight (`skipped`/`failed`) that it released, and `persistenceInFlight` names the `pending` ones whose detached write continues. After `dispose()` the engine is dead and its slot accounting moot, so a still-pending write's reference is **backend-owned memory outside the engine's bound** (an explicit weakening; the signal is aborted to let a cooperating backend release it). It never throws and does not wait for writes.

### 13.6 Schema evolution

`schemaVersion` is an integer. A reader rejects a version greater than it understands with a distinct error; additive fields within a version are tolerated and preserved; lower versions go through a registered migration. Panel-specific state never enters the sealed core — it goes in annotation layers keyed by `ResultId`.

---

## 14. Aggregation and grouping foundations

### 14.1 Principle

Roadmap §4: keep result semantics rich enough for downstream grouping/filtering, keep Group By **out of collision core**, keep presentation out of this layer. This section therefore defines only **pure, deterministic derivations over a sealed Result Set** plus an optional attribute snapshot — the data-side foundation, no UI, no state.

### 14.2 Built-in facets (derived from the Result Set alone)

| Facet | Value | Valued |
|---|---|---|
| `mode` | the test's mode | single |
| `pairModels` | `[pair.first.modelKey, pair.second.modelKey]` (already canonically ordered) | single |
| `crossModel` | `first.modelKey !== second.modelKey` | single |
| `elementFirst` / `elementSecond` | the canonical `ElementRef` on that side | single |
| `element` | each member `ElementRef` of the pair | **multi** (a result belongs to two groups) |
| `locationCell(size)` (`size` a required finite number > 0; `NaN`/`Infinity`/≤ 0 ⇒ `InvalidOptionsError`) | `[⌊x/size⌋, ⌊y/size⌋, ⌊z/size⌋]` of the result's location point; `null` if none | single |
| `distanceBucket(width)` (`width` a required finite number > 0, same validation) | `⌊distance/width⌋` (clearance only) | single |
| `caveated` | `getPairStatus(pair).verdict === 'covered-caveated'` — i.e. an `element`-attributed diagnostic on either element **or** any `target-model`/`unit` taint on the pair's covering unit (§12.5) | single |

*Location point*: `volume-overlap` → `witness.point` when non-null; `clearance` → midpoint of `closestPoints.first/second`; otherwise none. `locationCell` is the deterministic **spatial-grouping foundation** (a fixed-grid partition, a pure function of a recorded coordinate and a caller-chosen `size`); clustering algorithms are out of scope.

### 14.3 Group identity and determinism

- `GroupId` = canonical JSON of `[facetId, params, value]`. It is stable across reruns and sessions, so a later workflow layer can attach state to a `GroupId` or `ResultId`.
- Groups are ordered by `value` (numbers numerically, strings by code unit, arrays lexicographically, `null` last); members appear in canonical result order. Nested grouping is an ordered facet list; a group's identity is its path.
- **Partition vs cover.** A single-valued facet *partitions* the results (each result in exactly one group; group counts sum to the result count). A multi-valued facet *covers* them (a result may appear in several groups; counts do **not** sum to the result count). The API marks facets `multiValued` so no consumer sums counts blindly.

### 14.4 Filters

A filter is a **conjunction** of `{facet, op, value}` clauses with `op ∈ {eq, in, lt, lte, gt, gte, isNull, notNull}`, evaluated purely over results and annotations. No disjunction, no text search, no saved filters (§23).

### 14.5 Element attributes (optional annotation layer)

Grouping by level/category/system needs Viewer property data. Grouping by attribute is served from a *snapshot* taken while the model is live, so that grouping does not re-query the Viewer for every operation. **Snapshots are deliberately ephemeral**: they live only as long as their resident Result Set, are **not** persisted by `ResultStore`, and are regenerable only while the model is loaded — offline reproducibility of attribute groups is a non-goal (an `AttributeSnapshotStore` would be a separate port, §23):

```text
ElementAttributeSource.getAttributes(binding, dbIds, names) → Promise<Map<dbId, Record<string, string|number|boolean|null>>>
engine.annotate(runId, names) → Promise<AttributeSnapshot>   // ONE snapshot per run; each call REPLACES it atomically; last-request-wins via a per-run monotone token (an older call that finishes after a newer one started discards its result and rejects with `AnnotationSupersededError`); never accumulates, so the `maxAnnotationBytes` bound is per run, total
         AttributeSnapshot { schemaVersion, names, capturedAt, modelVersions, values: { [elementRefKey]: Record<name, scalar> } }   // elementRefKey = JSON.stringify([modelKey, dbId]) — delimiter-safe, like ResultId (§4.4)
```

The snapshot is held **beside** the sealed core (keyed by `runId`, released with it, §13.5.2), is not digested, may be regenerated while the model is live, is **hard-bounded** (`maxAnnotatedNames`; attribute name ≤ 128 code units; string value ≤ 1,024 code units — longer values are truncated with a `…` marker and counted; ≤ `maxAnnotationBytes`, provisional 8 MiB, estimated serialized size — exceeding it makes `annotate` reject with `AnnotationTooLargeError` and keep nothing), and enables `attrFirst:<name>`, `attrSecond:<name>` (single-valued) and `attrEither:<name>` (multi-valued) facets. Absent a snapshot, attribute facets are simply unavailable (not an error). Attribute *values* are plain scalars only.

### 14.6 Summary

`summarize(resultSet)` returns exact totals: results by `mode`/`pairModels`/`crossModel`, unit outcomes by cause, gap weight, caveat counts by reason, and the three axes — the data a Panel header needs, without the Panel re-deriving it.

---

## 15. Repeatability, rerun, comparison

### 15.1 Determinism contract per mode (F11)

| Mode | Class | What is promised |
|---|---|---|
| `volume-overlap` | **deterministic** | Same inputs ⇒ same pair set, flags and diagnostics, on any machine/load/reload (deterministic operation-count budgets; canonical operand orientation). Residual: rank-6 ties resolve by the definition-derived role assignment (§11.4). |
| `clearance` | **deterministic** | As above (its Hard-Clash precheck reuses `volumeOverlapQuery`; the ~24% inconclusive volume on the M3 fixture is a deterministic property of geometry). |
| `surface-intersection` | **time-sensitive** | The library still lets elapsed time set `aborted`; a verdict near the budget boundary can depend on machine speed. Differences appear as `crossing-budget-exhausted` caveats, not silent flips. |
| `containment` | **time-sensitive** | Same, via the witness term (`SurfaceCrossingWitness`). |

`determinismClass` is recorded in provenance. For `time-sensitive` runs the engine **promises no repeatability** whenever a `crossing-budget-exhausted` caveat is present, and a differing rerun is not by itself a defect. This spec does not promote either mode to deterministic — that is a tracked library follow-up (PC design §7.3), not this layer's to fix.

### 15.2 Comparability preconditions

A rerun is *comparable* to a base only to the extent these match; the engine reports each rather than asserting:

`semanticDigest` equal; every `modelKey` has equal `modelVersion`; `scopeDigests` (population digest and per-root subtree digests) equal; `libraryVersion` equal and non-null; same `mode`/`clearance`. **Placement equality is never verified** (`placementVerified: false`); across sessions it is reported `unverifiable`, within one session it is `same-generation` only if no `notifyPlacementChanged` intervened. Sizing options and `broadPhase` do **not** affect comparability (invariant P2), and `broadPhase: 'linear'` is the recommended cross-check arm (§22 AC-4).

### 15.3 Rerun

`engine.rerun(runIdOrResultSet, { definitionRevision?, runOptions? }) → RunHandle` is `startRun` with the embedded (or a newer) definition and `derivedFromRunId` set. Prior Result Sets are **never mutated**. There is no incremental/partial rerun in v1 (§23): a rerun re-plans and re-executes everything against a fresh input snapshot.

### 15.4 Comparison

`compareResultSets(base, next, opts?) → Comparison`. **The join key is the `PairId`, never the `ResultId`**: `ResultId` embeds `semanticDigest` (§4.4), so the same element pair under a changed mode/clearance/selection has two different `ResultId`s by design, and matching on them would report every result as added+removed. Each entry therefore carries the `pairId` plus whichever `ResultId`(s) exist (`baseResultId`, `nextResultId`; equal when the `semanticDigest`s are equal), so a workflow layer can look up its attached state under the id it used.

```js
/** @typedef {Object} Comparison
 *  @property {{ sameDefinition: boolean, sameModelVersions: boolean, sameEnumeration: boolean,
 *              sameLibraryVersion: boolean|null, determinismClass: 'deterministic'|'time-sensitive',
 *              placement: 'unverifiable'|'same-generation', notes: string[] }} comparability
 *  @property {Array<{pairId, baseResultId, nextResultId}>} unchanged
 *  @property {Array<{pairId, baseResultId, nextResultId, changedFields: string[]}>} changed   present in both; evidence beyond tolerance, flags, mode or clearance differ
 *  @property {Array<{pairId, nextResultId}>} added                       in next only, and base had covered+clean status for it
 *  @property {Array<{pairId, nextResultId}>} addedUnverifiedBase         in next only, but base did NOT cover it cleanly (may have been missed, not new)
 *  @property {Array<{pairId, baseResultId}>} resolved                    in base only, and next covered it cleanly (positive absence)
 *  @property {Array<{pairId, baseResultId}>} removedUnverifiedNext       in base only, but next did NOT cover it cleanly (absence proves nothing)
 *  @property {Array<{pairId}>} identityConflicts                         pairs involving a modelKey recorded with different modelVersions in the two sets (host contract violation, §4.2): classified nowhere else
 */
```

- "Covered cleanly" for a pair means `getPairStatus` (§12.5) returns `covered-clean` in that Result Set — i.e. the pair's roots were actually paired in an evaluated unit and **none** of the taint-rule conditions of §12.5 holds (element-attributed caveat, `target-model`/`unit` taint from an unattributable diagnostic, duplicate-evidence conflict, non-current freshness). **A pair whose covering unit reported an unattributable diagnostic (`fragment-not-loaded`, `fragment-owner-unresolvable`, …) therefore never counts as covered cleanly, and can never be reported `resolved` or `added`** — it lands in `removedUnverifiedNext` / `addedUnverifiedBase`. Element-level status is **not** sufficient (two elements can each be fully covered without their mutual pair ever having been asked about, e.g. after a definition revision adds a new pairing). `undetermined` and `not-required` both classify as unverified.
- When the two `semanticDigest`s differ, `added`/`resolved` are produced only where `getPairStatus` verifies the pair in the *other* set; when `mode` or `clearance` differs, evidence is not comparable and every pair present in both is reported under `changed` with `changedFields: ['mode']` (or `clearance`) rather than `unchanged`. The `unverified` classes exist precisely so the diff never turns a gap or caveat into a claimed resolution — the batch-scale form of "empty ≠ negative".
- `changed` uses tolerances (`distanceTolerance`, `pointTolerance`: finite numbers ≥ 0, provisional defaults `1e-6` world units, overridable via `opts`; unknown option keys, `NaN`, `±Infinity` and negatives throw `InvalidOptionsError`) because float evidence is not digested (§13.1). An equal `pairSetDigest` (§13.1) short-circuits **only pair membership and flag comparison** (no `added`/`removed`/flag `changed` can exist); it says nothing about evidence, so evidence of every common pair is still compared by tolerance (two runs with the same pairs and flags but distances `0.0417` vs `0.0470` are `changed`).  Equal `pairSetDigest` says **nothing** about whether the two runs asked the same question (two empty result lists hash identically whatever their tests): comparability is always decided from `testRef.semanticDigest` independently, never inferred from `pairSetDigest`.
- For `time-sensitive` runs, every `added`/`resolved` entry additionally carries `timeSensitive: true`.
- A `scopeDigests` mismatch (same `modelKey`, hence same `modelVersion` by §4.2) means the model's *enumerated content* changed between runs (e.g. it finished streaming); the comparison still computes but `comparability.notes` says so. A `modelVersion` mismatch for one `modelKey` is a **host identity-contract violation**, not a note: see `identityConflicts` (§4.2, §15.4).

---

## 16. Stale-model, epoch, and lifecycle interactions

### 16.1 Event matrix

| Event | `queued`/`planning` | `running` | Terminal (sealed) |
|---|---|---|---|
| **Model unloaded** (`registry.unregister` + `world.evictModel`) | binding dead ⇒ run `failed` with planning gap `model-not-bound` (or lease invalid at bind) | units touching it: `skipped/failed:model-evicted` (lease pre-check §7.4); other units run; `coverage: partial`; `freshness: stale` (`model-evicted:<modelKey>`) | read-time freshness → `stale` |
| **Model reloaded** (same `modelKey`, new `Model`) | new run binds the new object | run stays on its **snapshot** binding (now dead) ⇒ as above; the engine never re-binds mid-run; `bindingGeneration` bumped | read-time `stale` (`model-reloaded:<modelKey>`) |
| **Fragment population changed** (streaming growth, fragment replaced/unloaded — no host call) — *after seal, read-time `getFreshness` re-digests and reports `stale` (§16.4)* | plan-time digests are taken during planning; a change during planning yields a new digest for that plan, no drift concept yet | pre/post scope digests differ ⇒ `skipped/discarded:scope-drift`, run `invalidated` (§16.3.2); digest unavailable ⇒ gap `scope-unverifiable` | read-time `getFreshness` re-digests the recorded scopes ⇒ `stale` (`scope-drift:<modelKey>`), or `unverifiable` if not computable; the sealed set records `provenance.scopeProof` |
| **Placement changed** (`notifyPlacementChanged`) | new run sees new generation | §16.3 (taint + `invalidated`) | read-time `stale` (`placement-changed:<modelKey>`) |
| **World disposed** | `failed` | `failed:world-disposed`, pending `not-run` | unaffected (sealed) |
| **Foreign growth revision bump** (another caller's extraction) | — | `ModelPlacementChangedError` with unchanged generation ⇒ bounded retry (§7.5) | — |
| **Definition edited/archived/deleted** | no effect on an already-started run | no effect (embedded snapshot) | no effect |
| **New model registered** | binds only if registered **before** the `queued → planning` snapshot; a run naming a still-unbound key at that instant fails `model-not-bound` (a queued run's scope never depends on timing after the snapshot) | out of scope (snapshot) | — |

### 16.2 Placement generation

The library cannot know a model was moved unless the caller says so (`invalidateModelPlacement`, F13), and its revision counter also moves on extraction growth, so it cannot serve as the engine's staleness signal (§1.3). The engine therefore owns `placementGeneration` per binding:

- `engine.invalidateModelPlacement(modelKey)` is the **recommended single call**: it invokes `world.invalidateModelPlacement(model)` and increments `placementGeneration`, so the two halves cannot be forgotten independently.
- A host that calls `world.invalidateModelPlacement` directly **must also** call `registry.notifyPlacementChanged(modelKey)`; otherwise the engine cannot see the change. This is documented as a host obligation, not enforced (the library likewise cannot verify its own caller, M2 §6.5).
- `broadPhase: 'linear'` re-reads placement each call and needs no invalidation for *correctness of one call*, but a mid-run change still yields a **mixed-placement** run, so the same handling applies to both broad-phase choices.

### 16.3 Taint, scope proof and invalidation

At the **`queued → planning` transition** the engine atomically captures, for every model the definition names, the binding object (identity), `modelVersion`, and `(bindingGeneration, placementGeneration)`; this is the run snapshot. It re-reads the generations at each unit's start.

1. If, when a unit completes, any touched binding's generations differ from that unit's *start* values, the unit is **`discarded:input-changed`**: its pairs are **not** merged (they may mix placements). Mixed-placement results are treated as worse than absent ones.
2. **Input-scope proof (bracketed digest).** Executing a unit follows this protocol, in the executor, for **every** scope the unit reads — each whole-model target (population digest), each explicit target root list and the unit's source roots (subtree digests), all per §6.2.1:
   1. **Pre-check.** Immediately before issuing `findClashes`, call `digestScope` for each scope and compare with the *planning-time* digest recorded for it. Any mismatch ⇒ the unit is **not issued** and is `skipped:scope-drift`; a `digestScope` failure (tree unavailable, dead binding, thrown error) ⇒ `skipped:scope-unverifiable`.
   2. **Call.** `world.findClashes` (§7.2).
   3. **Post-check.** Immediately after it settles (resolved, or thrown-and-mapped), compute the digests again and compare with the planning-time digests. Any mismatch ⇒ the unit is `discarded:scope-drift` (pairs and diagnostics **not** merged); a failure to compute ⇒ `discarded:scope-unverifiable`.
   4. Only if both checks are `equal` for every scope is the unit eligible to be `evaluated`; the ledger records `scopeProof: 'equal'`. A retry (§7.5) repeats the whole protocol.

   Deterministic semantics: the comparison is exact string equality of digests, so the outcome is a pure function of the (mockable) enumerator's answers — no thresholds, no counts-only heuristics. An increase, decrease, replacement or status flip of the population is identically drift. `placementCount` is **not** used as evidence (F18).
3. **Invalidation.** `scope-drift` (either check) is an input change exactly like a generation change: at the next unit boundary the run transitions to **`invalidated`** and seals; earlier `evaluated` units are retained and flagged `freshness: stale` (reason `scope-drift:<modelKey>`), everything else is a gap. `scope-unverifiable` is **not** drift: the unit is a gap (`coverage: partial`), the run continues, and a later unit may succeed. (A generation change observed at a unit boundary is handled the same way: if any touched binding differs from the *run snapshot*, the run is `invalidated`.) **The end-of-plan check counts as a boundary:** a `scope-drift` or `input-changed` outcome on the *last* unit yields `invalidated`, never `completed` (§8.2).
4. **Invariant I-scope (normative).** *A unit is `evaluated` only if its `scopeProof` is `equal`.* Since `coverage: full` requires every unit `evaluated` (§8.3), **no `completed ∧ full ∧ current` Result Set can exist unless equality with the planning snapshot was demonstrated for every unit's target scope (and source/explicit scope).** The method is recorded as `provenance.scopeProof = { method: 'bracketed-digest', digestVersion: 1 }`.
5. **Declared residual — the proof is bracketed, not continuous.** Equality is shown at two instants around the call. A population that changes *and reverts* wholly inside one call (an A→B→A excursion during the library's own extraction yields) is undetectable by any caller-side mechanism (F18). The engine therefore records `method: 'bracketed-digest'`, never `'exact'`, so the guarantee is not overstated; making it exact needs an optional additive library change reporting the extracted target population per call (§21.2 (f)). AC-8 pins this boundary with a documented-limitation test.

### 16.4 Freshness

- At seal: `outcome.freshness = 'stale'` if any binding died, any generation moved, or any unit ended `scope-drift` (`scope-drift:<modelKey>`) during the run; else `'current'`.
- At read: `getFreshness(resultSet, {registry, enumerator?}) → Promise<Freshness>` is **asynchronous** and recomputes against the current registry **and the live model content**: it re-digests every scope recorded in the sealed `provenance.models[].scopeDigests` (whole-model population and per-root subtrees, §6.2.1) through the `ElementEnumerator` and compares them with the sealed values — a mismatch (e.g. fragments that finished streaming after the run, with no host signal) ⇒ `stale`, reason `scope-drift:<modelKey>`; no enumerator, or a digest that cannot be computed ⇒ at best `unverifiable`, **never `current`**. It then checks: same `registrySessionId` (the registry's own nonce — so a set produced by *another engine over the same world* is verifiable, while a set from a different registry lifetime/session is not), all bindings alive, all generations equal ⇒ `current`; any binding dead / generation moved ⇒ `stale` with reasons; a live binding whose `modelVersion` differs from the recorded one for the same `modelKey` ⇒ `stale` with reason `model-version-conflict:<modelKey>` (a host identity-contract violation, §4.2 — never a silent match); a Result Set from a **different session** (loaded from a store) ⇒ `unverifiable` (placement cannot be checked) unless a `modelVersion` mismatch makes it `stale`.

### 16.5 Epochs

`loadEpoch` never appears in durable data. It exists only in non-persisted run telemetry (`epochByModelKey`) for debugging. Eviction/epoch death is handled entirely through lease checks (§7.4). A model that has been evicted can never be re-admitted (F5), so "retry against the same model" is meaningless — recovery is a reload plus a new run.

### 16.6 Handler safety

`unregister` and any engine hook wired to `BEFORE_MODEL_UNLOAD_EVENT` **never throw** and never `await`: an uncaught throw aborts the Viewer's teardown of every remaining model (M1). They only mark state; runs observe it at the next boundary.

---

## 17. Memory and performance boundaries

### 17.1 Provisional caps

All values are **provisional** — chosen by reasoning, revisable by measurement, exactly the posture `collision/constants.js` documents. Recorded in provenance; folded into `ledgerDigest` where they shape the plan.

| Parameter | Default | Basis / evidence |
|---|---|---|
| `maxSourceFragmentsPerUnit` | 200 | Bounds one unit's cost and thus cancel latency (§10.2). M4: whole-Structure source (543 instances) used 26% of the 20,000 clearance cap, so capacity is not the binding reason; latency is, and unit makespan is **unmeasured**. |
| `maxSourceDbIdsPerUnit` | 500 | Bounds extraction walk per call (F9: extraction is per-call, not cached). |
| `maxUnitsPerRun` | 10,000 | Fails `plan-too-large` at planning, before any work. Same-model bisection alone is ~(owner-count − 1) units. |
| `maxResultsPerRun` | 100,000 | **Whole-unit boundary rule:** each unit's results are canonically sorted (§11.3) before merging; if merging a unit would exceed the cap, that **entire unit is discarded** (`failed:result-cap`, with its pair-space weight recorded as a gap) and the run stops (`failed`, reason `result-cap`). The retained set is therefore always a union of whole units in plan order — identical under TLAS and linear, whose library pair order differs. `coverage: partial`. |
| `maxRetainedDiagnostics` | 10,000 | §12.4; counts stay exact. |
| `maxExplicitElementsPerSelection` | 100,000 | Definition size guard (V5). |
| `maxPlacementRetries` | 2 | §7.5. |
| `persistTimeoutMs` | 5,000 | §13.5.1 — bounds only how long `done`/the terminal event wait; never the write. |
| `maxEntriesPerSelection` | 1,024 | V4 (§5.3). |
| `maxQueuedRuns` | `maxResidentResultSets − 1` | §7.3, §13.5.2; slot accounting is the real bound, this can only lower it. |
| `maxResidentResultSets` | 4 | §13.5.2 — hard cap on resident sets **plus** in-flight runs; unsaved sets never auto-evicted. |
| `maxDiagnosticsPerOutcome` / `maxDistinctReasons` | 200,000 / 64 | §7.1 — executor-controlled data bounds; overflow collapses to completeness-affecting sentinels. |
| `maxPlanReferences` | 2,000,000 | §6.5.1 — plan-table entries + unit range records, checked incrementally before allocation. |
| `maxPairsPerOutcome` | `maxResultsPerRun` | §7.1 — pairs one executor outcome may return. |
| `maxElementTaintsPerUnit` | 2,000 | §12.2.1 — per-unit exact element-taint entries; overflow collapses to a unit-wide `taint-overflow` taint. |
| `maxAnnotationBytes` | 8 MiB | §14.5 — estimated serialized size cap for one annotation snapshot. |
| `maxAnnotatedNames` | 16 | §13.5.2, §14.5 — bounds an annotation snapshot. |
| `progressMinIntervalMs` | 100 | §9.2. |
| `maxUnitIdsPerDiagnostic` | 8 | §12.2 — unit ids kept per retained diagnostic. |
| `sliceBudgetMs` | 4 | §17.3 — per-slice deadline (half of `frameBudgetMs`). |
| `aggregationSliceMaxItems` | 2,000 | §17.3; sized so a slice stays well inside `frameBudgetMs`; **unmeasured** (AC-12 verifies). |

### 17.1.1 Option validation

`RunOptions` and the engine-level limits (`maxResidentResultSets`, `maxQueuedRuns`, `persistTimeoutMs`, `maxAnnotatedNames`, `maxUnitIdsPerDiagnostic`, `sliceBudgetMs`, `aggregationSliceMaxItems`, `maxEntriesPerSelection`, `maxExplicitElementsPerSelection`, all recorded in provenance) are validated by one pure function that **collects every issue** and throws `InvalidOptionsError{issues}` synchronously — from `startRun`/`rerun` for `RunOptions`, from `createClashTestEngine` for the limits. Rules: a plain object; **unknown keys rejected**; no coercion; every number must be a **finite integer** (`NaN`, `±Infinity`, fractions, strings rejected); enums exact.

| Option | Accepted | Hard ceiling (provisional) |
|---|---|---|
| `broadPhase` | `'tlas'` \| `'linear'` | — |
| `interUnitYield` | `'animation-frame'` \| `'macrotask'` | — |
| `persist` | boolean | — |
| `maxSourceFragmentsPerUnit`, `maxSourceDbIdsPerUnit` | integer ≥ 1 | 20,000 / 5,000 (the library's per-epoch and per-dbId ceilings, F9) |
| `maxUnitsPerRun` | integer ≥ 1 | 100,000 |
| `maxPlanReferences` | integer ≥ 1 | 10,000,000 |
| `maxPairsPerOutcome` | integer ≥ 1, **≤ `maxResultsPerRun`** | (cross-field) |
| `maxDiagnosticsPerOutcome` | integer ≥ 1 | 1,000,000 |
| `maxDistinctReasons` | integer ≥ 1 | 1,024 |
| `maxEntriesPerSelection` | integer ≥ 1 | 10,000 |
| `maxExplicitElementsPerSelection` | integer ≥ 1 | 1,000,000 |
| `maxResultsPerRun` | integer ≥ 1 | 1,000,000 |
| `maxRetainedDiagnostics` | integer ≥ 0 | 100,000 |
| `maxPlacementRetries` | integer ≥ 0 | 10 |
| `progressMinIntervalMs`, `persistTimeoutMs` | integer ≥ 0 | 60,000 |
| `sliceBudgetMs` | integer ≥ 1 | `frameBudgetMs` (8) |
| `aggregationSliceMaxItems`, `maxUnitIdsPerDiagnostic`, `maxAnnotatedNames` | integer ≥ 1 | 100,000 / 64 / 256 |
| `maxResidentResultSets` | integer ≥ 1 | 64 |
| `maxAnnotationBytes` | integer ≥ 1 | 64 MiB |
| `maxElementTaintsPerUnit` | integer ≥ 1 | 100,000 |
| `maxQueuedRuns` | integer ≥ 0, **≤ `maxResidentResultSets − 1`** | (cross-field) |

Ceilings exist so a caller cannot defeat a bound by passing a huge value; they are provisional like every cap here. A run's effective options are recorded in provenance (`runOptions`) and folded into `ledgerDigest` where they shape the plan.

### 17.2 Memory ownership

- **Engine-owned:** plain data only — the ledger and plan tables (O(roots + owners + unit records) integers, §6.5.1), results (one small plain record per pair), retained diagnostics (capped), definitions, annotation snapshots. No `Model`, no `THREE`, no geometry. Per-record byte size is **not measured**; AC-12 measures it rather than this spec asserting one.
- **Library-owned (unchanged, not controlled here):** per-epoch instance bucket, geometry/BLAS/connectivity registry, TLAS, placement tables — released only by `evictModel` or `dispose()`; no LRU/TTL (F9). A whole-model run touches every candidate-gated geometry (resolution is lazy and candidate-gated), so the world's retention grows with distinct geometries touched. M4's deterministic typed-buffer metric measured 4–25 MB across real single-call workloads (a **lower bound**; TLAS adds a constant ~807 KB across 3 epochs; per-instance retention 280–388 B). **No long-running, many-query, or leak data exists.** The engine exposes a read-only `retentionReport()` composed from the public accessors (`getEpochCollisionInstanceCount`, `getEpochGeometryDiagnostics`, `getEpochTlasDiagnostics`, `getEpochPlacementDiagnostics`) so a host can observe growth; it takes no action on it.

### 17.3 Main-thread discipline

The engine adds **no synchronous span longer than `frameBudgetMs` (8 ms)** of its own: enumeration handling, outcome projection, dedup/merge, canonical sorting, digesting, and sealing all run in **deadline-aware slices**: a slice checks the injected `now` at least every 64 items and yields once `sliceBudgetMs` (provisional 4 ms, half of `frameBudgetMs`) has elapsed, with `aggregationSliceMaxItems` only a secondary ceiling; the 8 ms figure is a design target verified in AC-12's reference environment, not a guarantee on arbitrary devices. Slices yield between slices through the same kind of scheduler seam `collision/scheduler.js` uses. The library's own atomic spans (M4: tasks ~9–25 ms; a single non-preemptible span up to ~20 ms on the M3 fixture, ~680 ms for the synthetic pathological pair) are outside the engine's control and not improved by it. The engine reports its own labeled spans through an optional `spanRecorder` option (same shape as `collision/scheduler.js`'s `setSpanRecorder` callback) so AC-12 can measure them without touching the library's global recorder.

### 17.4 What is known and not known about cost (Verdict D honesty)

Known (F14, single-call, one fixture, one machine): task lengths, candidate density as the cost driver, TLAS as the only viable broad phase for multi-instance work (linear is an oracle and rejects large plans outright), memory lower bounds. **Not known:** wall-clock makespan per unit or per run on the representative runtime; frame-cadence behavior of *sustained back-to-back* queries (M4 measured single calls); input latency (the T-c aggregator defect makes it unusable); any worker message/transfer overhead (S6′ was ruled not to run); performance beyond the measured fixture (M4 §5.7 explicitly forbids extrapolation). Consequently **this spec states no throughput, latency, or responsiveness SLO**, and the responsiveness acceptance items are characterization-only (§22). Verdict D means the main-thread status quo is the sole oracle here — it does *not* mean the main thread is proven adequate for batches, nor that a worker is ruled out.

### 17.5 Worker seam (commitment, not adoption)

The one commitment: `ExecutionRequest` and `UnitOutcome` are plain, structured-clone-safe data keyed by `modelKey`/`dbId` (never `Model`, never epochs), and all lifecycle/identity authority stays on the main thread — exactly the shape M4 §9/§20 identify as the compatible seam. This spec does **not** adopt a worker, does **not** claim a worker would or would not help, and starts none of M4 Phase 4.

### 17.6 Hard boundaries of the current library that surface here

1. A model with more than `maxCollisionInstancesPerEpoch` (20,000) fragments cannot be fully covered (bucket is cumulative per epoch) — reported as a gap.
2. A single requested dbId over `maxFragmentsPerDbId` (5,000) or `maxChildrenPerNode` (10,000) fails extraction — reported as a gap; the engine does not expand it.
3. `broadPhase: 'linear'` rejects any (source-count × target-epoch-instances) over 1,000,000 — the oracle arm is only usable on small plans.
4. `clearance` units are bounded by `maxClearanceNarrowPhasePairs` (20,000) per call — handled by the deterministic split order of §6.4 (sources, then target models, then explicit target roots) down to one source root against one target root or a whole-model sentinel, which is a gap.
5. One run's diagnostics volume can be very large (F12) — capped detail, exact counts.
6. Instance-tree under-enumeration is silent (F15) — inherited, recorded via the plan-time `scopeDigests` (§6.2.1).

---

## 18. Contract sketch (semantics normative, names provisional)

This section fixes the *shape* of the engine boundary so the Panel and the implementation plan agree on semantics. Identifier names may change in the plan; the behaviors in §4–§17 may not without a revision of this spec.

```js
// proposed clashtest/index.js
createClashTestEngine({
  world,                         // CollisionWorld (required)
  enumerator,                    // ElementEnumerator (required)   — §6.2
  registry,                      // ModelRegistry (optional). The world coordinator owns ONE registry per world (§4.3); omitted ⇒ the engine joins it; a different registry ⇒ ModelBindingError('registry-mismatch')
  attributeSource,               // ElementAttributeSource (optional) — §14.5
  unitExecutor,                  // UnitExecutor (optional; default LocalUnitExecutor over `world`) — §7.1. An orchestration seam only: it lets tests inject deterministic failures without faking library-call construction, and it does NOT specify how geometry would reach a non-main-thread executor (§17.5).
  testStore, resultStore,        // ClashTestStore / ResultStore (optional; in-memory reference impls provided) — §5.5, §13.5
  limits,                        // optional { maxResidentResultSets, maxQueuedRuns, persistTimeoutMs, maxAnnotatedNames, maxUnitIdsPerDiagnostic, sliceBudgetMs, aggregationSliceMaxItems, maxEntriesPerSelection, maxExplicitElementsPerSelection, maxAnnotationBytes } — validated (§17.1.1), recorded in provenance
  libraryVersion,                // string|null, host-supplied — §13.2
  spanRecorder,                  // (label, ms) => void, optional — §17.3
  now, yieldToScheduler,         // test seams, same convention as CollisionWorld's
}) → ClashTestEngine

ClashTestEngine {
  registry
  // definitions
  validateTest(def) → Issue[]                         // pure
  saveTest(def) → Promise<ClashTestDefinition>        // validate + atomic put; caller assigns revision, store enforces latest+1 (§5.5); RevisionConflictError, never overwrites
  getTest(testId, revision?) / listTests() / archiveTest(testId) / deleteTest(testId)   // no revision ⇒ latest; archive/delete cover all revisions (§5.5)
  // runs
  startRun(defOrRef, runOptions?) → RunHandle         // throws InvalidTestDefinitionError synchronously; all runtime failure surfaces as a terminal status
  rerun(runIdOrResultSet, { definitionRevision?, runOptions? }) → RunHandle
  getRun(runId) → RunHandle | null                    // active/queued runs only
  getResultSet(runId) → Promise<ResultSet | null>     // resident or via store
  discardRun(runId) → Promise<void>                   // explicit, host-initiated release + store delete; never a side effect of cancel (§13.5.2)
  retainResultSet(runId) → { release() }              // keeps a saved set resident (§13.5.2)
  releaseResultSet(runId, { acknowledgeUnsaved? }) → void   // drop the resident copy only; refuses retained/unsaved sets unless acknowledged
  retryPersist(runId) → Promise<PersistenceOutcome>   // new attempt for a failed set (§13.5.1)
  getPersistenceState(runId) → PersistenceSnapshot    // synchronous, for late observers
  getFreshness(runIdOrResultSet) → Promise<Freshness> // async; re-digests live scopes (§16.4)
  canClaimNoClashes(runId) → Promise<boolean>         // async; recomputes freshness (§8.3, §16.4)
  invalidateModelPlacement(modelKey)                  // §16.2 (recommended single call)
  annotate(runId, names) → Promise<AttributeSnapshot> // §14.5
  retentionReport() → object                          // §17.2
  dispose() → Promise<DisposeSummary>                 // sync: marks disposing; resolves after all runs drained+sealed as cancelled; {droppedUnsaved, persistenceInFlight}; never throws; idempotent (same promise)
}

RunHandle {
  runId
  getSnapshot() → RunProgress                         // §9
  subscribe(listener) → unsubscribe                   // events: 'state' | 'progress' | 'unit' | 'persistence' (the last stays valid after the terminal event)
  cancel(reason?) → Promise<RunSummary>               // §10; same value/timing as `done`
  done: Promise<RunSummary>                           // {runId, status, resultSet, persistence: {state, timedOut, attempt, error?}}; resolves ONCE for EVERY terminal status; never rejects; at seal + (first persistence settle OR persistTimeoutMs), timeout = {state:'pending', timedOut:true} (§13.5.1)
  persisted: Promise<PersistenceOutcome>              // resolves ONCE, never rejects, never reports timeout: first attempt's eventual {saved|failed|skipped}; no timer; NOT on the lifecycle critical path
}

// pure derivations (no engine state), also exported standalone:
canClaimNoClashes(resultSet, currentFreshness) → boolean           // §8.3 claim rule; currentFreshness REQUIRED, false if absent/not 'current'; also engine.canClaimNoClashes(runId) → Promise<boolean>, which recomputes freshness incl. scope digests
summarize(resultSet) · groupBy(resultSet, facets, {annotations?}) · filter(resultSet, clauses, {annotations?})
compareResultSets(base, next, opts?) · getPairStatus(resultSet, pairId) · getElementStatus(resultSet, elementRef) · getFreshness(resultSet, {registry, enumerator?}) → Promise   // async; re-digests live scopes (§16.4); session identity from registry.registrySessionId; engine.getFreshness(runIdOrResultSet) is the bound form
```

`RunOptions` (all optional; all provisional defaults in §17.1; **validated per §17.1.1**): `broadPhase: 'tlas'|'linear'`, `maxSourceFragmentsPerUnit`, `maxSourceDbIdsPerUnit`, `maxUnitsPerRun`, `maxResultsPerRun`, `maxRetainedDiagnostics`, `maxPlacementRetries`, `progressMinIntervalMs`, `interUnitYield: 'animation-frame'|'macrotask'`, `persist: boolean`, `maxPlanReferences`, `maxPairsPerOutcome`, `maxDiagnosticsPerOutcome`, `maxDistinctReasons`, `maxElementTaintsPerUnit`.

Errors the engine's own API throws (`RunIdConflictError` comes from a `ResultStore`, like `IdentityConflictError`) (never the library's, which are always mapped to unit outcomes): `InvalidTestDefinitionError{issues}`, `ModelBindingError` (register conflicts, missing `modelVersion`), `RunQueueFullError` (thrown only when a configured `maxQueuedRuns` lower than slot capacity is reached; otherwise refusal is always `ResultCapacityError`), `ResultCapacityError{cap, active, retained, held}`, `ResultSetRetainedError`, `UnsavedResultSetError`, `ModelKeyVersionConflictError`, `IdentityConflictError` (from a `ResultStore`), `AnnotationTooLargeError`, `EnumerationCancelledError`, `AnnotationSupersededError`, `UnsupportedSchemaVersionError`, `EngineDisposedError` (any method after `dispose()` is called, except `dispose()` itself which is idempotent and non-throwing here — unlike `CollisionWorld.dispose()`), `RevisionConflictError`, `TestArchivedError`, `RunNotTerminalError`, `InvalidOptionsError{issues}`.

Ports summary (all injectable): `ElementEnumerator` (§6.2), `ModelRegistry` (§4.3), `UnitExecutor` (§7.1, constructor option `unitExecutor`), `ElementAttributeSource` (§14.5), `ClashTestStore` (§5.5), `ResultStore` (§13.5). Every port is injected; the core never imports the Viewer.

---

## 19. Relationship to the current single-query APIs

### 19.1 The single-query surface is unchanged

- `CollisionWorld.findClashes` and every public library contract (query shape, result shape, identity model, diagnostics semantics, the permanent `'linear'` oracle, lifecycle) stay exactly as they are (roadmap §1/§8). The engine calls them; it does not wrap, patch, or subclass them, and reaches no `_`-prefixed member or module-internal.
- The existing `groupBy: 'dbId'` query parameter stays; the roadmap's UI-facing Group-By is this layer's §14, not a `findClashes` parameter.
- `ClashFinderExtension` ("Find Clashes" / "Find Soft Clashes") keeps calling `world.findClashes` directly. It is precisely the degenerate one-element case of this layer (`|A| = 1`, `B` = every loaded model, one unit) and is **not required to migrate**; whether the Panel later reroutes it through the engine is a Panel decision.
- **Concurrency caveat.** The extension's single queries and an engine run share one `CollisionWorld`. The world-scoped coordinator serializes only *engine* runs (§7.3); a concurrent extension query that grows a captured epoch can force a `ModelPlacementChangedError` retry inside the run. This is handled (§7.5) but is a throughput hazard, listed as OQ-11.

### 19.2 Mapping

| This layer | Library call |
|---|---|
| Definition `mode` | `query.mode` (one per unit) |
| Definition `clearance` | `query.clearance` (only for `clearance`; the library has no default) |
| Cell 1/2/3 unit | one `findClashes` with `source` = one model + explicit dbIds, `target = {targets:[…]}` |
| Selection `kind:'model'` as a **target** | `targets` entry with `dbIds` omitted (whole-model sentinel) |
| Selection `kind:'model'` as a **source** | enumerated to explicit `dbIds` by `ElementEnumerator` (no library primitive, F15) |
| `PairId` | derived from `ClashPair.source/target` `(dbId + model→modelKey)`, canonicalized (§4.4); the library's epoch-qualified ordered key is never exposed |
| Result `evidence` | `ClashPair.witness` / `distance` / `clearance`, re-keyed (§11.1) |
| Diagnostics | `statistics.diagnostics`, normalized (§12.2) |

### 19.3 Hard and Soft Clash

One mode per test. A Hard test (`volume-overlap`, or the diagnostic modes `containment`/`surface-intersection`) and a Soft test (`clearance`) are two definitions; the layer never composes them and performs no cross-test de-duplication. Within a `clearance` test the library already excludes any pair that is a Hard Clash under the same scope, semantically (never merely distance-filtered — README M3), and reports `clearance-hard-clash-precheck-inconclusive` when it cannot decide; those diagnostics count toward `integrity` (§12.3). The diagnostic modes are exposed because the library exposes them; whether the Panel offers them, given their time-sensitivity (§15.1), is a Panel decision (OQ-12).

---

## 20. Relationship to the future Viewer Clash Panel

Roadmap §7: the Panel is designed after, or together with, a stable result contract — never by binding UI state to `findClashes` internals. This spec provides that contract and assumes **no UI requirement**.

**The Panel may rely on:** stable `ResultId`/`GroupId` across reruns and sessions; the `RunOutcome` axes and the `canClaimNoClashes` rule (and must not present a bare "0 clashes" without them); `RunProgress` snapshots/events and cooperative `cancel`; sealed immutable Result Sets and their plain-data serializability; canonical result order and the deterministic facet/group/filter derivations; the attribute-annotation layer for level/category grouping; the `ModelRegistry` as the `modelKey → Model` resolver for navigation.

**The Panel owns (this layer defines none of it):** creating definitions from the user's selection (e.g. from `viewer.getAggregateSelection()`, mapped to `modelKey`s through the registry — which is how the shipped extension's "exactly one element" restriction is *not* baked into the engine, per roadmap §4); model→`modelKey` derivation policy; rendering, isolation, `fitToView`, markers and their lifecycle (the existing `ClashFinderExtension` visualization is the reusable reference); result status/approval/assignment/issue workflow and its persistence; saved views, expand/collapse state, sorting UI; the choice of `ResultStore` backend and retention; the default `clearance` value and UX; how partial/caveated/stale outcomes are worded.

**Hand-off rules.** The Panel resolves a `ResultId` → `ElementRef`s → `registry.bindingFor(modelKey).model` on the main thread at display time; the Result Set itself never holds a `Model`. A workflow layer that attaches state to `ResultId`/`GroupId` inherits the identity guarantees of §4.4 and, because a `modelKey` is one immutable model version (§4.2), needs no version reasoning of its own: a version change arrives as a **new `modelKey`** (new `ResultId`s, no aliasing), and a same-key version mismatch is a loud `identityConflicts`/`ModelKeyVersionConflictError`, never a note.

---

## 21. Compatibility, migration, and roadmap traceability

### 21.1 Roadmap §4 constraints → where satisfied

| Roadmap §4 constraint | How this spec satisfies it |
|---|---|
| Stable source/target identity across federated models; don't persist `Model`/`modelId` | §4: durable `modelKey`+`ElementRef`; runtime identities confined to live bindings (D3) |
| Don't rely on diagnostic-only `modelId` | §11.2/§12.2: mapped via unit binding table; ambiguous ⇒ `null`, never guessed |
| Avoid breaking identity redesign for persistent/grouped results | Runtime identity stays swappable under `modelKey`; core unchanged (D1) |
| Don't hard-code single-selected-element UX | §5: many-element, many-model selections; §20 |
| Many-source, many-target, model-vs-model, model-vs-many, many-vs-many, full-model enumeration | §5.2, §6.3 (three-cell decomposition; whole-model source via §6.2) |
| Preserve cancellation/abort path; policy is result layer's | §10 (cooperative at unit boundary; partial retained; no library change) |
| Preserve progress, yielding, batch checkpoints, later worker | §9, §7.3, §17.3, §17.5 (seam only) |
| Rich result semantics for grouping/filtering | §11, §14 |
| No Group By in collision core; existing `groupBy:'dbId'` stays | §14 lives here; §19.1 |
| Panel state, grouping/filter UI, persistent lifecycle, workflow, approval outside collision core | §2.1, §20, §23 |

### 21.2 Architecture-change discipline (roadmap §8)

This spec **changes no roadmap §4 constraint and reopens no settled public contract** in §1 of the roadmap (query shapes, result shapes, identity model, diagnostics semantics, `'linear'` oracle, lifecycle). It therefore needs no §8 five-point justification. The following are **optional, additive** collision-core changes this design would *benefit from* but does not require; each, if ever pursued, is its own reviewed change under §8 and is explicitly out of scope here: (a) a `signal` option on `findClashes` (would cut cancel latency, §10.3); (b) a read-only exported limits object (would let the planner pre-check budgets instead of splitting reactively); (c) an exported library version constant (§1.3); (d) an exported diagnostic-reason registry with a completeness flag (would replace the engine's known-reason table, §12.3); (e) a whole-model *source* enumeration primitive (only if the Viewer adapter's accessor proves inadequate, OQ-4); (g) a typed `CapacityExceededError` kind for the `'linear'` broad-phase ceiling, replacing the message-matched plain `Error` (§7.2); (f) a per-call report of the extracted target/source population identity (fragment ids + owners, or a digest) in `findClashes` `statistics`, which would upgrade the bracketed scope proof (§16.3.5) to an exact one.

### 21.3 Migration

None. There is no existing consumer, stored data, or schema to migrate; the layer is additive and new (`clashtest/`, `test/clashtest/`). Existing acceptance/performance harnesses and `npm test` are untouched, and `npm test` must stay free of any live server or APS credentials (live coverage is script-based, like the existing acceptance and regression scripts). At implementation time: a CHANGELOG entry, a README pointer, and a handoff update. Forward compatibility for this layer's own data is defined in §13.6 (`schemaVersion` = 1).

### 21.4 M4 status

M4 stays closed with Verdict D; no gate is re-run, no Phase 4 spike is authorized or implied, and none of the three tracked follow-ups is a prerequisite. Two are relevant *inputs*: the structured-clone crash (§13.4 excludes its class by construction) and the T-c aggregator defect (why no input-latency claim is made, §17.4).

---

## 22. Acceptance and verification criteria

Tiers: **T1** = `node:test`, fakes/mocks, no Viewer; **T2** = `node:test` differential against a real `CollisionWorld` using the existing fixtures (`test/fixtures/geometry.mjs`, `test/fixtures/mockInstanceTree.mjs`); **T3** = live Viewer, Playwright script run against a running dev server (like `test/acceptance/*.acceptance.mjs`; **never** part of `npm test`). Because responsiveness targets remain unconfirmed (Verdict D), AC-12's live measurements are **characterization, not gates**.

| ID | Tier | Criterion (pass condition) |
|---|---|---|
| AC-1 | T1 | Each V-rule (§5.3) has accept and reject cases **at every field and nesting level** (`revision: 1.5`, `name: null`, `{kind:'model', dbIds:[1]}`, unknown nested properties, oversized strings/lists), the validator reports **all** issues in one pass, `validateTest`/`saveTest`/`startRun` accept and reject identically, and digests match a fixed set of golden `sha256:` vectors for the canonical-JSON format (§5.4); `semanticDigest` is invariant under key order, whitespace, `name`, `description`, `revision`, and changes with any semantic field; a newer `schemaVersion` is rejected distinctly; **option validation (§17.1.1)** rejects `NaN`/`±Infinity`/fractional/zero/over-ceiling values and unknown keys with `InvalidOptionsError` listing every issue (e.g. `maxSourceDbIdsPerUnit: 0`, `maxUnitsPerRun: Infinity`, `progressMinIntervalMs: NaN`, `maxQueuedRuns > maxResidentResultSets − 1`); **definition store (§5.5):** `put` accepts only revision 1 for a new test or `latest + 1`, rejecting duplicates, gaps and out-of-order saves with `RevisionConflictError` without overwriting, `get(testId)` returns the latest (also when archived), `archive`/`delete` cover all revisions, and an archived test rejects **stored-reference** runs and new revisions (`TestArchivedError`) while `startRun(definition)` of the same content is still permitted (ad hoc, §5.5); `ClashTestStore` operations are linearizable per `testId` — the reference implementation is tested under interleaved `put`/`archive`/`delete`/`get` so a reader never observes a revision from one point and an archived flag from another. |
| AC-2 | T1 | **Exact cover.** Property test (seeded RNG) over 1–4 models with whole/explicit/mixed selections, including same-model and partial `A∩B` overlap: the union of unit pair-spaces equals the required `P`; each required pair (unordered) / ordered pair appears **exactly once**; every same-model unit has disjoint source/target dbId sets; the plan is byte-identical across input reorderings; changing sizing options changes only chunking, never coverage; `maxUnitsPerRun` is enforced at planning. **Hierarchy cases (mock instance tree with fragment-owning parents that have fragment-owning descendants):** whole-model roots absorb nested owners; explicit lists drop listed descendants; `A = B` with nested owners is root-identical and plans; every cross-role nesting fails planning with `hierarchy-overlap` and runs **no** unit; and a differential check proves a naive dbId-disjoint `P → C` query drops the parent-vs-descendant fragment pair (documenting F16) while no *required* root pair is lost. **Scope-digest conformance (§6.2.1):** over mock models the enumerator's population/subtree records equal what the library's own `extractAllFragments`/`extractFragments` return (including both dropped classes), and the digest changes under every mutation class listed in AC-8. **Tree-unreachable population (§6.2):** a mock model with a loaded, numeric-owner fragment (`fragId 42`, owner `900`) in no root subtree is reported in `unreachablePopulation` for both orientations — as a whole-model *source* it is flagged unevaluated, as a whole-model *target* a clash against it is retained with `flags.unreachableOwner`, `getPairStatus` is `not-required`, and `canClaimNoClashes` is false in both; duplicated/inconsistent records fail planning. **Unresolved selections (§6.2):** an explicit stale dbId (`not-found`) fails planning with `element-unresolvable` and runs no unit; a real node with zero fragments (`no-fragments`) plans, contributes no pair space, appears in `unresolvedSelections`, and makes `canClaimNoClashes` false even when the run is `completed ∧ full ∧ clean ∧ current`; the with/without-such-element cases are both tested. |
| AC-3 | T1 | **Executor-port conformance:** a stub executor built only from an `ExecutionRequest` (§7.1) can reproduce the default executor's plan and coverage — the engine's split-vs-gap decision uses only `failure.capacityKind`, affected models only `failure.modelKeys`, and `evaluated` is only accepted with `scopeProof: 'equal'`. **Outcome validation (§7.1):** a stub executor returning each of — 100,000 diagnostics with unique 10 KB reasons (collapses to `diagnostic-reason-overflow`, `integrity: caveated`, bounded counts/taints), `pairs.length > maxPairsPerOutcome` (whole-unit `failed:result-cap`, validated before deep processing), an oversized `failure.message`, a T2 compatibility test that the library's linear-ceiling error still matches the pinned matcher, unknown statistics keys, a whole-target pair whose owner is in neither `rootOwners` nor `unreachablePopulation`, mismatched `unitId`/`attempt`, `evaluated` with `scopeProof ≠ equal` or non-null `failure`, a pair naming a model outside the unit, a source owner outside the unit's `rootOwners`, a non-finite evidence value, a `Map`/function, evidence of the wrong mode shape — is rejected as `failed:internal-error` (run `failed`) and nothing from it is merged. **Library-call conformance** (fake world recording calls): every call uses the `targets` shape, `groupBy:'dbId'`, one mode, `clearance` iff clearance; max concurrent in-flight `findClashes` = 1; no call after cancel/terminal; no call for a dead lease; the engine never calls `evictModel`/`dispose` (its own `invalidateModelPlacement` passthrough excepted). |
| AC-4 | T2 | **Partition and broad-phase independence (P2).** The same test under sizing {1 source/unit, default, all-in-one} × `broadPhase` {`tlas`,`linear`} yields identical `pairSetDigest` and evidence within tolerance, on fixtures with known clashes, including `A = B` (same-model), and partial-overlap cases. Includes a **negative control** proving a naive single whole-set-vs-itself `findClashes` returns zero same-model pairs (documenting F2) while the engine finds them. |
| AC-5 | T2 | **Single-query equivalence.** For `|A| = 1` and `B` = all models, the Result Set's pairs equal direct `findClashes` output mapped to `PairId`, for `volume-overlap` and `clearance`; time-sensitive modes are compared only when the library run carries no `crossing-budget-exhausted` diagnostic. |
| AC-6 | T2 + T3 | **Determinism (deterministic modes only).** T2: ≥ 10 repeated runs on one world and on fresh worlds ⇒ identical `pairSetDigest`/`ledgerDigest`. T3: across ≥ 10 genuine page reloads (same protocol as `test/performance/m4/hard-clash-precheck-blocker-reload.mjs`) ⇒ identical `pairSetDigest` for `volume-overlap` and `clearance`. For `surface-intersection`/`containment`: only that any difference is accompanied by a completeness-affecting diagnostic; no equality claim. |
| AC-7 | T1 + T2 | **Cancellation** (both a cooperating enumerator, which honors `EnumerationContext.checkpoint` and stops mid-scan with `EnumerationCancelledError`, and a non-cooperating one, where cancellation takes effect when the current invocation settles and no further invocation starts) in every §10.2 row (a cancel during enumeration seals with planning gap `cancelled` and no unit ledger, deterministically): no unit starts after cancel; the in-flight unit is merged; sealed `cancelled`, `coverage:'partial'`, unstarted units `not-run:cancelled`; idempotent, first reason wins; never calls evict/dispose/invalidate; `done` resolves; `engine.dispose()` cancels all; a real-world run cancelled mid-plan has an evaluated subset identical to the same units in an uncancelled run. |
| AC-8 | T1 + T2 | **Lifecycle** (§16): bindings are captured at the `queued → planning` transition (a register between `startRun` and that transition binds; one after does not); a late `unregister(oldModel)` never kills a newer binding for the same `modelKey`; **shared registry (§4.3):** two engines over one world share one registry object; `registry: otherRegistry` throws `ModelBindingError('registry-mismatch')`; engine A calling `invalidateModelPlacement` between engine B's units discards/invalidates B's run (never `completed/current` over mixed placements). **scope proof (§6.2.1, §16.3):** with a mock enumerator whose live population is mutated between planning and execution, each of — growth, shrink, a **count-preserving replacement** (same `fragId`, new `geometryId` or owner), a `not-loaded ↔ loaded` flip, a subtree change under an explicit root — is detected by the pre-check (`skipped:scope-drift`, no call issued) or the post-check (`discarded:scope-drift`, pairs not merged), and invalidates the run with earlier units retained/`stale`; an unchanged population yields `scopeProof: equal` and `evaluated`; a throwing/unavailable `digestScope` yields `scope-unverifiable` (gap, `coverage: partial`, run continues); **no `completed ∧ full` Result Set exists in any scenario in which a unit lacked `scopeProof: equal`** (property test over randomized mutation schedules); **post-seal streaming (§16.4):** a clean `completed ∧ full ∧ current` set whose model then gains fragments *with no host signal* is reported `stale` (`scope-drift:<modelKey>`) by `getFreshness`, `engine.canClaimNoClashes` resolves `false`, and with no enumerator/uncomputable digest freshness is `unverifiable`, never `current`; a documented-limitation test pins that an A→B→A excursion wholly inside one call is *not* detected and that provenance says `method: 'bracketed-digest'`; `placementCount` is never consulted; two engines over one world share one queue (never two runs in flight); evicting a model mid-run (real `world.evictModel` between units) ⇒ touching units are gaps, others evaluated, no library error escapes, `coverage:'partial'`, `freshness:'stale'`; `unregister` never throws (including on a disposed world); world dispose ⇒ `failed`, pending `not-run`; `notifyPlacementChanged` mid-run ⇒ tainted unit discarded and run `invalidated` with earlier units retained; an injected foreign `ModelPlacementChangedError` retries ≤ `maxPlacementRetries` then a gap; same-`modelKey` reload leaves the old run `stale`; freshness matrix incl. cross-session `unverifiable`. |
| AC-9 | T1 | **Progress**: fractions are `null` while `pairSpaceTotal` is 0 (never `NaN`); counters monotone across randomized capacity-split scenarios; `pairSpaceTotal` conserved by every split; `fractionProcessed` reaches 1 on `completed`; terminal `state` event exactly once, after seal and the first persistence attempt settles or `persistTimeoutMs` elapses (§13.5.1), with a late `'persistence'` event for a timed-out write; **split order (§6.4):** a unit that fits only after target-*root* bisection (one source root, one target model, many explicit roots) completes with `coverage: full`, children's weights partition the parent exactly, a whole-model-sentinel or single-root-pair unit stays a gap; **split lifecycle (§6.4):** nested splits followed by successful evaluation of every leaf yield `coverage: full` with the `split` parents excluded, `pairSpaceTotal`/progress conserved (children sum to the parent), `unitsTotal` = leaves, and cancel while children are queued yields `not-run:cancelled` leaves with the parent still `split`; `maxUnitsPerRun` bounds unit records including runtime splits (a would-exceed split becomes a `failed:unit-cap` gap, `pairSpaceTotal` conserved); listener exceptions isolated and counted; throttle honored; no ETA field exists. |
| AC-10 | T1 + T2 | **Diagnostics/completeness**: table-driven over every known reason — only `witness-unavailable` leaves `integrity:'clean'`; every other and any unknown reason ⇒ `caveated`; a **drift test fails** if `collision/` gains a `reason:` literal missing from the engine's known-reason table; cross-unit de-duplication; retained-cap ⇒ counts exact and `integrity` computed from counts; `canClaimNoClashes` matches §12.5 for every axis combination **and** every terminal status, and returns `false` whenever `unresolvedSelections` or `unreachablePopulation` is non-empty, returns `false` when `currentFreshness` is omitted or not `'current'` (and a clean run sealed `current` whose model then moved is not claimable via the engine-bound form) (a `failed` planning run with zero units, a `cancelled` pre-plan run, an empty-operand run and a zero-required-pair run are all **not** claimable); empty `pairs` + diagnostics is never a clean negative; a gap is never classified `resolved` by `compareResultSets`; and a definition revision that adds a new pairing (`a↔b`, with `a↔c` and `b↔c` fully covered in the base) yields `addedUnverifiedBase`, never `added` (pair-level status, §12.5). **Unattributable diagnostics (F17, §12.2.1):** a fake library result carrying `fragment-not-loaded` and `fragment-owner-unresolvable` with `dbId: null` (and one with a `null` `modelKey`) is normalized without loss (`dbId` stays `null`, `attribution` = `target-model`/`unit`), sets `integrity: caveated`, survives de-duplication and the retained-diagnostic cap in the per-unit `taints` table, makes `getPairStatus` return `covered-caveated` for **every** pair between that unit's sources and the affected whole-model target (and for every pair of a `unit`-tainted unit) but not for pairs against an explicit-list target of another model, makes `getElementStatus` report the taint, **survives loss of the global list**: with `maxRetainedDiagnostics` overflow and a diagnostic occurring in more than `maxUnitIdsPerDiagnostic` units, an `element`-attributed diagnostic in the ninth unit still makes `getPairStatus` return `covered-caveated` for that unit's affected pairs (per-unit `taints`, never the capped list); more than `maxElementTaintsPerUnit` element entries in one unit collapse to a unit-wide `taint-overflow` taint (all pairs of that unit `covered-caveated`); defeats `canClaimNoClashes`, and — in a base/next comparison where the base held a clash and the next unit reported such a diagnostic with no reported pair — yields `removedUnverifiedNext`, **never `resolved`**; a diagnostic of an unknown shape lacking numeric `dbId` degrades to `unit` attribution. |
| AC-11 | T1 + T2 | **Serialization and persistence.** **Promise contract (§13.5.1):** with a `ResultStore` whose `put` never settles, the terminal event and `done` occur at ≈`persistTimeoutMs` and `done` **resolves** (never rejects) with `persistence: {state:'pending', timedOut:true}`; `persisted` is **still pending** at that point and never reports `timeout`; when the test then settles the write, `persisted` resolves **once** with `{state:'saved'}` (or `{state:'failed', error}` when it rejects), `getPersistenceState` and the `'persistence'` event agree, and the sealed set was never evicted while unsaved. Also: a store that settles within the window makes `done` resolve with the final state and `timedOut:false`; `persist:false`/no store ⇒ `persisted` resolves `skipped` at seal; `retryPersist` returns a new promise and never rewrites `persisted`; `done`, `persisted` and `cancel()` each settle exactly once; **runId (§13.5):** ids are random (two engines never collide in a 10⁵-id sample); `put` of the same `runId` with identical content succeeds idempotently, with different content rejects `RunIdConflictError` and leaves the original untouched (atomically, under concurrent puts); the `modelKey→modelVersion` index survives `delete`; a sealed set containing `-0` evidence round-trips through JSON with semantic equality (`-0` normalized to `0`); **immutability (§13.3):** attempted mutation of a definition from `saveTest`/`getTest`, of `done`'s `resultSet`, of `getResultSet`'s result, and of objects passed to or returned from both reference stores throws/no-ops and leaves digests, resident content and stored content unchanged; the reference stores copy on write and read; freezing runs in slices; a `put` rejecting with `IdentityConflictError` yields `failed` (`error.name = 'IdentityConflictError'`) without changing the run outcome. `structuredClone(resultSet)` and JSON round-trip are lossless for a set built from a **real** `CollisionWorld` (the object class that crashes the M1 gate); a deep scan finds no `Model`/function/`THREE`/`Map`/`Set`/`undefined`/non-finite value; `ResultStore` contract holds (atomic `put`, header-only `list`, `delete`) on the in-memory reference implementation; a failing store does not alter the run outcome. |
| AC-12 | T1/T2 (gating, synthetic) + T3 (characterization) | **Engine-owned main-thread spans ≤ `frameBudgetMs`** at cap-sized synthetic inputs (gating; measured via the engine's `spanRecorder`); `maxResultsPerRun` discards the whole overflowing unit and stops the run, leaving a union of whole units that is **identical under TLAS and linear**; per-record bytes measured. **T3, informational only:** on the 3-discipline Audubon fixture, record unit count, per-unit ms, run makespan, cancel latency, frame-gap distribution during a run (a T-b1/T-b2 analogue), and `retentionReport()` growth across repeated runs; archive under `test/performance/results/` (git-ignored, like the existing gates). No pass/fail against an unconfirmed target. |
| AC-13 | T1 | **Grouping/filter**: single-valued facets partition and multi-valued facets cover (counts asserted accordingly); facet results are invariant under input shuffling; `GroupId` stable across runs; `locationCell` handles negative and boundary coordinates; `elementRefKey` collision vectors (`{modelKey:'a:1',dbId:2}` vs `{modelKey:'a',dbId:1}`, keys containing quotes/commas/brackets/Unicode/numeric-looking text) never alias; each filter op has a truth table; attribute facets are unavailable, not erroring, without a snapshot. |
| AC-14 | T1 | **Compare**: every `Comparison` class, including both `unverified` classes; digest short-circuit for identical sets; `timeSensitive` marking; `scopeDigests` mismatch note and `identityConflicts` for a same-`modelKey` `modelVersion` mismatch; tolerance boundaries; **join key:** a clearance `0.05 → 0.10` rerun (different `semanticDigest`, hence different `ResultId`s for the same element pair) reports the shared pair as `changed` with `changedFields: ['clearance']` carrying `pairId`, `baseResultId` and `nextResultId` — never as added+removed; **digest short-circuit:** two sets with equal `pairSetDigest` but distances `0.0417` vs `0.0470` still report `changed`. |
| AC-15 | T3 | **Live acceptance** (`test/acceptance/clash-test.acceptance.mjs`, Audubon 3-discipline fixture per `test/acceptance/README.md`), ground truth from `collision/README.md`: (a) `A={Structure 2734}`, `B`=all three models, `volume-overlap` ⇒ exactly the two known pairs (Structure 2734↔Architecture 3686, Structure 2734↔Structure 3663) and `integrity:'caveated'`; (b) `A={Structure 3965}` ⇒ 0 pairs, 0 completeness-affecting diagnostics ⇒ `canClaimNoClashes` true; (c) `clearance` 0.05 for 3965 ⇒ Structure 3976 and 4135 at distance ≈ 0.0417, and 0 pairs at 0.02; (d) whole-Structure vs whole-Architecture completes with non-empty results, and a mid-run cancel yields `cancelled`/`partial` whose evaluated subset is valid; (e) `broadPhase:'linear'` equals `'tlas'` on (a)–(c); (f) unloading a model mid-run produces gaps, not a thrown error; (g) **owner-mapping gate (§6.2, OQ-4):** for every fragment of the fixture the tree-node owner (source rule) equals the `fragList.getDbIds` owner (whole-target rule), i.e. `ownerMismatch.count === 0`, and a pair is reported with the same `PairId` whichever role the planner assigned it (compare a `{A=X, B=Y}` run with `{A=Y, B=X}`). |
| AC-16 | T1 | **Resident bound and identity enforcement** (§13.5.2, §4.2). With `maxResidentResultSets = N`: slots (active + resident) never exceed `N` under randomized start/cancel/seal/persist/release schedules; admission at a full engine evicts the LRU `evictable` (saved, unleased) set and admits, else throws `ResultCapacityError` **synchronously** naming the blockers (active, retained, held) — never queues, never exceeds `N`, never evicts a `held` (`skipped`/`pending`/`failed`) or `retained` set; a no-store engine refuses run `N+1` until `releaseResultSet(…, {acknowledgeUnsaved:true})` or `discardRun`; `releaseResultSet` on a held set without acknowledgement throws `UnsavedResultSetError`, on a leased set `ResultSetRetainedError`; `discardRun` chains the store `delete` after an in-flight `put` (a late write does not resurrect it); a `failed` set becomes evictable only after a successful `retryPersist`; `getResultSet` of an evicted set reads the store without making it resident; sealing never fails for lack of a slot; `dispose()` returns a `Promise<DisposeSummary>` that never rejects and resolves only after every in-flight unit has drained and every run sealed `cancelled` (so a dispose during a long unit reports the resulting held set in `droppedUnsaved`, or in `persistenceInFlight` if a write is pending), later calls throw `EngineDisposedError`, and repeated calls return the same promise; a capacity split that would exceed `maxUnitsPerRun` becomes `failed:unit-cap` (unit records never exceed the cap); `discardRun` on a non-terminal run throws `RunNotTerminalError` and with no store only releases; **both `startRun` overloads** throw `ResultCapacityError` synchronously when admission fails (never a waiting queue); after successful admission `startRun({testId})` always returns a handle, and an archived/missing test then fails asynchronously — sealing `failed` with planning gap `test-unavailable`, its admitted slot becoming a normal resident set; **hung writes (§13.5.2):** with a store whose `put` never settles, repeatedly starting a run and calling `discardRun` exhausts the slots (a discarded set with a pending write keeps its slot) and then throws `ResultCapacityError` listing them as `pending` — resident sets never exceed the cap; aborting the `signal` lets a cooperating store settle and free the slot; a cap-sized many-vs-many planning case (100,000 target roots × many source units) stays within `maxPlanReferences`, and one over it fails `plan-too-large` before allocating; two module copies joining the `globalThis` coordinator share one queue and registry, an incompatible `protocolVersion` throws; `annotate` beyond `maxAnnotationBytes`/name/value limits rejects with `AnnotationTooLargeError` and retains nothing, and over-length host strings are rejected. **Identity:** `register` without `modelVersion` throws `ModelBindingError`; re-registering a known `modelKey` with a different `modelVersion` (also after `unregister`) throws `ModelKeyVersionConflictError`; a reload of unchanged content bumps `bindingGeneration`; a `ResultStore.put` whose `models[]` maps a `modelKey` to a different `modelVersion` than one already accepted rejects `IdentityConflictError`; `compareResultSets` puts every pair involving such a `modelKey` in `identityConflicts` and in no other class; distinct `modelKey`s over identical dbIds produce distinct `ResultId`s. |

**Required verification at implementation time** (mirrors the repo convention): `npm test` green with the new T1/T2 suites; the live T3 scripts run once against the dev server; the `docs/handoffs/latest.md` update follows `CLAUDE.md`'s Agent Handoff Convention.

---

## 23. Explicit non-goals

1. Any UI: the Viewer Clash Panel, and any Viewer rendering, isolation, `fitToView`, marker or overlay work.
2. Result status, approval, assignment, comments, issue-management integration, or any workflow state.
3. Persistence **backend** implementations, synchronization, multi-user sharing, quotas/retention policy (only the `ResultStore`/`ClashTestStore` ports and in-memory reference implementations).
4. Worker/off-main-thread execution, transferables, `SharedArrayBuffer`, worker-boundary topology, or **any** M4 Phase 4 work (S5′–S8′). Only the plain-data seam of §17.5.
5. Any change to collision-core contracts, modes, tolerances, budgets or constants (§21.2 lists optional additive changes that are *not* pursued here).
6. User-tunable geometric tolerances or penetration thresholds (the library has declared detection limits; they are not knobs).
7. Resumption, pause, incremental or partial rerun, continuing a cancelled run; persisting in-progress runs (§13.3).
8. Assembly roll-up of results, or a durable per-element identity beyond `(modelKey, dbId)` (a reserved optional `externalId` is never read).
9. Composite multi-mode tests, suites/batches of tests, scheduling, recurring runs.
10. Group-By/filter **UI**, saved views, text search, disjunctive filters, clustering beyond the fixed-grid `locationCell`.
11. ETA, throughput, latency or responsiveness SLOs (§17.4).
12. Cross-session placement verification, automatic re-binding of a reloaded model into a running run, dynamic federation-wide operands (a Panel expands "all models" into explicit entries), property/predicate-based selections.
13. Fixing the library's time-sensitive modes, the tracked M4 follow-ups, or `blasBuilt`/`blasCacheHits` reporting.
14. **Nested (ancestor/descendant) selection across the two roles**, parent-vs-own-descendant testing, and partial-subtree selection — all need an exact-owner extraction scope in collision core (OQ-15); v1 fails planning with `hierarchy-overlap` instead.
15. Many-vs-many geometry acceleration (TLAS-vs-TLAS `bvhcast`, incremental TLAS): correctness-first decomposition only.
16. Reconciling results across **model versions** (a changed model gets a new `modelKey`, §4.2): carrying `ResultId`-attached workflow state from an old key to a new one needs a host-supplied element mapping and is a host/Panel concern; the engine only guarantees the ids cannot alias.
17. Persisting attribute annotation snapshots or making attribute grouping reproducible offline (§14.5); an `AttributeSnapshotStore` port would be a separate design.

---

## 24. Open questions and risks

| ID | Question / risk | Owner | Blocks spec? |
|---|---|---|---|
| OQ-1 | **Must be settled before integration acceptance (not before the spec):** how is `modelKey`/`modelVersion` derived in the Viewer host (e.g. document URN + derivative version for the key; a translation revision or content hash for `modelVersion`)? The engine treats both as opaque, but the §4.2 contract (one key ⇔ one immutable version) is only as strong as the witness; a constant or label as `modelVersion` defeats detection. | host/Panel | No |
| OQ-2 | Is a durable per-element identity (e.g. a Revit unique id) needed for continuity *across* `modelKey`s (i.e. across model versions)? `(modelKey, dbId)` is sound only within one immutable version (§4.2); a re-translation gets a new key and therefore no carried-over `ResultId`s until a host-supplied element mapping exists. | product | No |
| OQ-3 | Default `clearance` and its UX (the library has none; the extension's `0.05` is provisional). | Panel/product | No |
| OQ-4 | **Gate on accepting the Viewer adapter (not on this spec):** verify on the real Viewer that the tree-node owner (source rule) and `fragList.getDbIds` owner (whole-target rule) agree for every fragment of the acceptance fixture (`ownerMismatch.count === 0`, AC-15 (g)); and verify, against a real Viewer session, the *source-side* use of the already-resolved `fragList.getDbIds` owner mapping (distinct-owner enumeration, `fragmentCount`) and the tree-readiness signal; the library's "Mode 2" under-enumeration is inherited and silent. | plan | No |
| OQ-5 | Unit-count and per-unit-overhead cost of same-model bisection (cell 3b) is **unmeasured**; a block-triangular scheme may be cheaper. AC-2 constrains any substitute. | plan | No |
| OQ-6 | Models over 20,000 fragments are uncoverable under `maxCollisionInstancesPerEpoch`; raising it is a collision-core decision (roadmap §8). | product/core | No |
| OQ-7 | Whether to pursue the optional additive library changes in §21.2. | milestone owner | No |
| OQ-8 | Sizing defaults (§17.1) are reasoned, not measured; no multi-process makespan exists. Calibrate via AC-12 T3. | plan | No |
| OQ-9 | Is an animation-frame-aligned inter-unit yield sufficient to avoid the frame starvation M4 measured per query? Characterize; M4 never measured batches. | plan | No |
| OQ-10 | `ResultStore` backend, quota and retention policy. | host/Panel | No |
| OQ-11 | The world-scoped coordinator serializes engine runs only; direct `findClashes` callers (e.g. the Clash Finder extension) bypass it. Decide between a shared lock/lease the extension also honors and documented "unsupported for reliable batch throughput" (interim behavior: bounded retry, §7.5). | plan/Panel | No |
| OQ-12 | Whether the Panel exposes `containment`/`surface-intersection` given their time-sensitivity. | Panel | No |
| OQ-13 | After `invalidateModelPlacement`, the first run pays the placement refresh + TLAS rebuild (M4 R6/refresh: 57–69 ms main-only task, product confirmation of that workload still pending under Verdict D). A rerun-after-move flow will hit it once per rebuilt epoch. | product | No |
| OQ-14 | Digest *implementation* (async `SubtleCrypto`, which needs a secure context, vs a sliceable pure-JS SHA-256) given the ≤ `frameBudgetMs` span rule (§17.3); the format itself is fixed (§5.4). | plan | No |
| OQ-15 | Exact-owner (non-recursive) extraction scope in collision core, to support nested selections and parent-vs-descendant tests; and how common fragment-owning nodes with fragment-owning descendants are in the target Revit content (unmeasured). | product/core | No |
| OQ-16 | Product acceptance of the **hierarchy-internal exclusion** (§5.6.3): a whole-model self-test omits clashes between fragment-owning nodes inside the same topmost root (F16 makes them unevaluable). Has the product owner accepted this result-semantic limitation, and is a count of affected nodes on the target content required first? | product | No |
| OQ-17 | **Must be settled before integration acceptance:** which host component owns *all* model-transform changes and is obliged to call `engine.invalidateModelPlacement` (§16.2)? A direct `world.invalidateModelPlacement` without `notifyPlacementChanged` leaves a result wrongly `current` — a documented host obligation, unenforceable by the engine. | host/Panel | No |

None of these blocks the specification: each has a defined interim behavior in the sections cited, and none changes a decision in §0.

---

## 25. Review disposition

Independent review: `codex-review spec`, medium effort, request `20260920-034058-96286-27495`, verdict "Requires major revision". Every finding was verified against the repository before a disposition was chosen; none was accepted on Codex's authority alone.

| # | Finding | Verified against | Disposition |
|---|---|---|---|
| C1 | Hierarchical dbIds invalidate the exact-cover proof | `extractFragments` in `ViewerModelAdapter.js` (explicit-stack subtree walk); `isSourceOwnFragment` | **Accepted — real defect.** Added F16, §5.6 (roots contract), root-level pair space (§6.1), `resolveRoots` port (§6.2), plan-time `hierarchy-overlap` rule, declared `hierarchy-internal` exclusion. Codex offered three options; chose its third (treat subtrees as indivisible) because the first two are collision-core changes this milestone must not require; the extraction-scope change is recorded as OQ-15. **D1 ("no core change required") stands, at the cost of a narrower supported selection shape** (nested cross-role selection is a stated non-goal). Property + differential tests added to AC-2. |
| C2 | Whole-model targets violate the run-start snapshot | `findClashes` re-extracts whole-model targets per call (`extractAllFragments`) | **Accepted.** Chose "call-time scope with drift detection" over "explicit immutable target lists" (which would trade the cheaper whole-model walk for thousands of per-root walks): §5.2, §16.3 drift guard using the public `getEpochPlacementDiagnostics().placementCount` against the run-start `fragmentTotal`. **Superseded in round 2:** the `placementCount` guard was replaced by per-unit bracketed scope digests (§6.2.1, §16.3, F18). |
| C3 | `canClaimNoClashes` can approve failed / non-claimable runs | §8.3 vs §6.6 as drafted (coverage vacuously `full`) | **Accepted.** Claim rule now requires `status: completed`, non-empty required pair space, no `emptyOperand`; pre-plan failure/cancel is always `coverage: partial` via planning-level gaps (§6.6.2). AC-10 extended to every terminal status. |
| C4 | `ResultId` aliases semantically different tests | §4.4/§5.4 as drafted | **Accepted.** `ResultId` now includes `semanticDigest`; cross-question carry-over must be an explicit reconciliation. (This reverses a deliberate draft choice that favored implicit carry-over; safety of attached workflow state outweighs it.) |
| C5 | Rerun comparison uses element coverage where pair coverage is required | §12.5/§15.4 as drafted | **Accepted.** Added `getPairStatus`; comparison uses it exclusively; `undetermined` maps to unverified; AC-10 has the `a↔b` counterexample. |
| I1 | Snapshot boundary contradiction; `unregister` identity | §5.2 vs §16.1 as drafted | **Accepted.** Boundary fixed at `queued → planning`; `unregister` checks object identity (§4.3). |
| I2 | "One run per world" not enforceable | §7.3 as drafted (engine-local queue) | **Accepted in part.** Added a world-scoped coordinator so multiple engines share one queue; the guarantee is explicitly scoped to engine runs because direct `findClashes` callers cannot be serialized (OQ-11). |
| I3 | Cancellation before a plan exists | §8.2/§10.2 as drafted | **Accepted.** Chose "abandon planning, seal with planning gap `cancelled`, no unit ledger" (deterministic, timing-independent). |
| I4 | Persistence settlement unbounded; eviction unprotected | §13.5 as drafted | **Accepted.** `persistTimeoutMs`, detached write, `RunHandle.persisted`, evict only after confirmed `saved`. |
| I5 | Validation contract incomplete | §5.3 as drafted | **Accepted.** Full field/nesting matrix, collect-all, normalization-after-validation, one shared function. |
| Q1 | Durable digest format deferred | §5.4/§13.1 as drafted | **Accepted.** Format fixed (`sha256:` over canonical JSON, `digestVersion: 1`); only the implementation stays a plan choice. |
| Q2 | Result-cap boundary undefined | §17.1 as drafted | **Accepted.** Whole-unit discard rule; canonical per-unit sort. |
| Q3 | `UnitExecutor` not injectable; worker seam overclaimed | §7.1/§18 as drafted | **Accepted.** `unitExecutor` constructor option; §17.5/§18 state it is an orchestration seam and does not specify geometry delivery to another thread. |

### Round 2 — independent Work review (five findings)

Each was verified against the repository (`collision/viewer/ViewerModelAdapter.js`, `collision/CollisionWorld.js`) before acceptance; verification of the library facts was done by a read-only subagent and is recorded as F17/F18.

| # | Finding | Verified against | Resolution |
|---|---|---|---|
| W1 | Whole-model target drift detection (`placementCount`) cannot prove target-scope equality | `getEpochPlacementDiagnostics`/`_recordPlacement`: cumulative, write-once per fragmentId, never shrinks; `emptyStatistics()` exposes no per-call population | **Accepted; contract replaced (F18, §6.2.1, §16.3).** Per-unit *bracketed scope digests*: the executor digests the live scope (whole-model population incl. both dropped classes; per-root subtrees; `[fragId, status/owner, geometryId]` records) immediately before and after the call and compares by exact equality with the planning-time digests carried in `ExecutionRequest.materialized.scopeExpect`. Pre mismatch ⇒ `skipped:scope-drift`; post mismatch ⇒ `discarded:scope-drift`; uncomputable ⇒ `scope-unverifiable` (fail closed, gap). Drift invalidates the run. **Invariant I-scope:** only `scopeProof: equal` units can be `evaluated`, so `completed ∧ full` implies demonstrated equality. Declared residual (A→B→A within one call) recorded as `method: 'bracketed-digest'`; exactness needs optional library change §21.2 (f). `placementCount` is no longer evidence. Tests: AC-2 (digest conformance vs the library's own extraction), AC-8 (replacement/flip/growth/shrink/unavailable, property test, residual pinned). |
| W2 | `dbId: null` diagnostics (`fragment-not-loaded`, `fragment-owner-unresolvable`) must taint pair status | `extractAllFragments` hard-codes `dbId: null` and drops the fragment (F17); no other reason lacks a numeric dbId | **Accepted (F17, §12.2.1, §12.5).** `NormalizedDiagnostic.dbId` is `number|null`; structural `attribution` ∈ `element | target-model | unit` (unknown shapes degrade to `unit`, fail-safe); exact per-unit `taints` tables independent of the retained-detail cap; **taint rule** in `getPairStatus` (a `target-model` taint on a whole-model target, or any `unit` taint, makes every pair of that unit `covered-caveated`); `getElementStatus` and the `caveated` facet use it; `compareResultSets` therefore can never report `resolved`/`added` on tainted pairs. AC-10 extended. |
| W3 | Durable IDs must be model-version safe | `dbId` stability is per model version (§4.4) | **Accepted; option A chosen (§4.2).** A `modelKey` names one immutable model version forever; `modelVersion` is now mandatory (content witness); enforcement at `ModelRegistry.register` (`ModelKeyVersionConflictError`), `ResultStore.put` (`IdentityConflictError`, durable/cross-session) and compare/rerun/freshness (`identityConflicts`). A changed model gets a new key, hence new `ElementRef`/`PairId`/`ResultId`. Option B (version inside every id) rejected: same host-honesty dependency, longer ids, version-pinned definitions. Residual: a host reusing key **and** version for different content is undetectable (OQ-1). AC-16. |
| W4 | Resident-result limit must bound memory | §13.5 as drafted: "never evict unsaved" + "no-store retains all" = unbounded | **Accepted (§13.5.2).** Hard slot cap counting in-flight runs; classes `evictable`/`retained`/`held`; admission evicts LRU evictable else refuses with `ResultCapacityError` (never queues, never drops unsaved); explicit `retainResultSet`/`releaseResultSet`/`discardRun`/`retryPersist`; read-through `getResultSet`; sealing cannot fail for lack of a slot; `dispose()` reports dropped/in-flight. AC-16. |
| W5 | `RunHandle.persisted` semantics contradictory | AC-11 vs §13.5 as drafted | **Accepted (§13.5.1).** `done: Promise<RunSummary>` resolves once, never rejects, at seal + (first persistence settle or `persistTimeoutMs`); timeout = `{state:'pending', timedOut:true}`; `persisted` resolves once with the eventual `saved|failed|skipped`, never reports `timeout`; persistence continues detached; `getPersistenceState`, `'persistence'` event, `retryPersist`. `timeout` is not a persistence state. AC-9/AC-11 rewritten. |

### Round 2 — `codex-review spec` (medium), request `20260920-140117-6555-20172`

Verdict "Requires major revision"; 4 critical + 5 further findings, each checked against the spec text and the repository before acceptance.

| # | Finding | Disposition |
|---|---|---|
| X1 | Comparison has no valid join key (`ResultId` embeds `semanticDigest`) | **Accepted.** §15.4: join by `PairId`; entries carry `pairId` + `baseResultId`/`nextResultId`. AC-14. |
| X2 | `pairSetDigest` short-circuit hides evidence changes | **Accepted.** §13.1/§15.4: equal digest short-circuits membership and flags only; evidence still compared. AC-14. |
| X3 | `UnitExecutor` not implementable from its port | **Accepted.** §7.1/§11.2: `ExecutionRequest` (mode, clearance, broad phase, run snapshot, `scopeExpect`); structured `failure{code, capacityKind, modelKeys, …}`, `scopeProof`, `generations`; responsibility split stated. AC-3. |
| X4 | Synchronous `dispose()` contradicts cooperative cancellation | **Accepted.** `dispose(): Promise<DisposeSummary>` resolves after all runs drained and sealed; does not wait for writes; idempotent. §10.2, §13.5.2, §18, AC-16. |
| X5 | `maxUnitsPerRun` does not bound runtime splits | **Accepted.** §6.4: cap counts all unit records; a would-exceed split becomes `failed:unit-cap`. AC-9. |
| X6 | Owner→root mapping incomplete (explicit roots) | **Accepted.** §5.6/§6.2: complete `ownerDbIds` per root, ledger `rootOwners` (bounded by fragments in scope); `undetermined` only defensively. |
| X7 | `RunOptions` unvalidated | **Accepted.** §17.1.1 validation table, ceilings, cross-field rule, `InvalidOptionsError`. AC-1. |
| X8 | Item-count slicing does not guarantee 8 ms | **Accepted (softened claim).** §17.3: deadline-aware slices via injected clock (`sliceBudgetMs`), item cap secondary, 8 ms a reference-environment design target. |
| X9 | Definition-revision persistence underspecified | **Accepted.** §5.5: caller-assigned, store-enforced `latest + 1`; `RevisionConflictError`; archive/delete per test; `TestArchivedError`. AC-1. |

### Round 3 — `codex-review spec` (medium), request `20260920-140833-13494-11910`

Second pass on the round-2 revision. Verdict "Requires major revision"; 4 critical + 5 further findings, all checked and accepted (the shared-registry and unresolved-dbId findings were checked against `ViewerModelAdapter.js` `extractFragments`, which returns an empty map without a diagnostic for a dbId with no fragments).

| # | Finding | Disposition |
|---|---|---|
| Y1 | Per-world coordinator shared but registry/placement generations engine-local | **Accepted.** §4.3/§7.3/§18: the coordinator owns the sole per-world `ModelRegistry`; a different registry ⇒ `ModelBindingError('registry-mismatch')`. AC-8 two-engine test. |
| Y2 | Capacity-split parents have no terminal state | **Accepted.** §6.4/§8.3/§9: normative `split` outcome, weight transferred once to leaves, coverage/progress over leaves, `unitsTotal` = leaves vs `unitRecords`, cancel/cap behavior. AC-9. |
| Y3 | `runId` uniqueness/create-only persistence unspecified | **Accepted.** §13.5: random UUIDv4 `runId`, create-only atomic `put` (idempotent on identical content, `RunIdConflictError` otherwise); identity index survives `delete`. AC-11. |
| Y4 | Empty/invalid explicit dbIds could yield a clean negative | **Accepted.** §6.2: `resolveRoots` returns `unresolved` (`not-found` fails planning `element-unresolvable`; `no-fragments` is a claim-blocking `unresolvedSelections` entry); claim rule extended. AC-2. |
| Y5 | Injected `UnitOutcome` unvalidated | **Accepted.** §7.1 `validateUnitOutcome`; violations ⇒ `failed:internal-error`. AC-3. |
| Y6 | `canClaimNoClashes` may rely on stale seal-time freshness | **Accepted.** Required `currentFreshness` argument (false if absent) and engine-bound `engine.canClaimNoClashes(runId)`. AC-10. |
| Y7 | Memory bound excludes unbounded strings | **Accepted.** §14.5/§13.5.2/§17.1.1: name/value/total-bytes limits (`maxAnnotationBytes`, `AnnotationTooLargeError`) and length caps on host-supplied strings. AC-16. |
| Y8 | `startRun(defOrRef)` sync vs async | **Accepted.** §5.5/§18: two overloads; a stored reference always returns a handle and lookup failure is a terminal planning gap `test-unavailable`. AC-16. |
| Y9 | Annotation snapshots claimed offline-reproducible but not persisted | **Accepted (claim removed).** §14.5: snapshots are deliberately ephemeral; `AttributeSnapshotStore` is a non-goal. |
| Q4 | JSON round-trip and `-0` | **Accepted.** §13.4: semantic equality, `-0` normalized at projection. AC-11. |

### Round 4 — `codex-review spec` (medium), request `20260920-141447-19350-4183`

Third pass on the round-3 revision (5 critical, 3 high/medium, plus 4 questions). Each checked and accepted:

| # | Finding | Disposition |
|---|---|---|
| Z1 | Element-attributed diagnostics lost by global cap / `unitIds` cap | **Accepted.** §12.2.1: exact per-unit `element` taint entries (owner-element granularity; `maxElementTaintsPerUnit`, overflow ⇒ unit-wide `taint-overflow`); §12.5 rule 1 reads only the per-unit table. AC-10. |
| Z2 | Stored-reference admission contradicts the slot cap | **Accepted.** §5.5: both overloads use the identical synchronous admission; "always returns a handle" applies only after admission; lookup failure seals the already-admitted run. AC-16. |
| Z3 | Archive bypass through direct definitions | **Accepted (option 1).** §5.5: direct definitions are ad hoc, never governed by store archive state; enforcement is by reference. AC-1. |
| Z4 | Enumerator vs library owner derivation | **Accepted.** §6.2: role-specific ownership stated exactly; `ownerMismatch` from the enumerator fails planning (`owner-mapping-mismatch`); live agreement is a gate on accepting the Viewer adapter (OQ-4, AC-15 (g)) — deliberately not assumed by the spec. |
| Z5 | Planning cancellation not expressible via the enumerator port | **Accepted.** §6.2: `EnumerationContext.checkpoint` + `EnumerationCancelledError`; weakened contract for non-cooperating enumerators. AC-7. |
| Z6 | Planning-failure vocabulary inconsistent | **Accepted.** §6.6.2 exhaustive planning-cause enum referenced by §8.2. |
| Z7 | Capacity splits only bisect sources | **Accepted.** §6.4 deterministic split order: sources, then target models, else unsplittable (extended by R2 to explicit target roots). |
| Z8 | Annotation replace/concurrency undefined | **Accepted.** §14.5: one snapshot per run, atomic replace, last-request-wins token, `AnnotationSupersededError`. |
| Z9 | `pairSetDigest` ⇏ `semanticDigest` (empty sets) | **Accepted.** §15.4: comparability decided from `testRef.semanticDigest`; the false implication removed. |
| Z10 | Store atomicity needs linearizability | **Accepted.** §5.5 linearizable-per-`testId` contract; AC-1 interleaving tests. |
| Q1/Q3 | Product acceptance of hierarchy exclusion; who owns placement changes | Recorded as **OQ-16 / OQ-17** (decisions for product/host, not spec defects). Q2 is OQ-1; Q4 answered by Z3. |

### Round 5 — `codex-review spec` (medium), request `20260920-142002-23915-29476`

Fourth pass on the round-4 revision: 2 critical, 4 high/medium, 3 questions. All accepted.

| # | Finding | Disposition |
|---|---|---|
| R1 | Whole-model population not proven representable by the root ledger (tree-unreachable fragments) | **Accepted.** §6.2: enumerator reconciles population vs root subtrees and returns `unreachable`; declared claim-blocking exclusion `tree-unreachable-population` / `unreachablePopulation` table; results against such owners retained with `flags.unreachableOwner` and `not-required` status; whole-target owners must be in `rootOwners` ∪ `unreachablePopulation`. The alternative (fail planning) was rejected because it would make whole-model runs impossible on any model with under-enumerated trees, whose prevalence is unmeasured. AC-2. |
| R2 | Capacity recovery cannot split explicit targets within one model | **Accepted.** §6.4 split order extended to bisect an explicit target root list; §17.6.4 corrected. AC-9. |
| R3 | `getFreshness` lacks the session identity | **Accepted.** `engineSessionId` replaced by `registrySessionId` (the world-scoped registry's nonce, so any engine over the world can verify); `getFreshness(resultSet, {registry})` and `engine.getFreshness`. |
| R4 | AC-16 contradicts §5.5 admission | **Accepted.** AC-16 rewritten: both overloads throw synchronously at capacity. |
| R5 | Executor-controlled data unbounded | **Accepted.** §7.1 size limits + deterministic overflow sentinels; `maxDiagnosticsPerOutcome`, `maxDistinctReasons`. AC-3. |
| R6 | `elementRefKey` undefined | **Accepted.** `JSON.stringify([modelKey, dbId])`. AC-13 vectors. |
| Q | Fail-closed vs weakened `full` for unreachable population; target-root splitting; OQ-1/OQ-17 blocking | Answered by R1 (claim-blocking exclusion), R2, and OQ-1/OQ-17 relabelled "must be settled before integration acceptance". |

### Round 6 — `codex-review spec` (medium), request `20260920-142428-28112-14456` (fifth pass)

4 critical, 4 high/medium, 4 questions. All accepted and applied:

| # | Finding | Disposition |
|---|---|---|
| S1 | Read-time freshness misses unsignalled post-seal fragment changes | **Accepted.** §16.4: `getFreshness` is async and re-digests live scopes against sealed `scopeDigests` (`stale` on mismatch, `unverifiable` when uncomputable, never `current`); `engine.canClaimNoClashes` async. AC-10. |
| S2 | Plan representation has no memory bound | **Accepted.** §6.5.1: normalized run-scoped root tables, units carry ranges, requests materialize transiently; `maxPlanReferences` incremental guard; complexity claim corrected. AC-16. |
| S3 | "Immutable" objects externally mutable | **Accepted.** §13.3: deep freeze at seal/exposure (sliced), stores copy on write/read; AC-11 mutation tests. |
| S4 | Detached writes defeat the memory bound | **Accepted.** §13.5.2: a set with an in-flight write keeps its slot until settlement; `AbortSignal` to `put`; post-`dispose` backend-owned memory stated as an explicit weakening. AC-16. |
| S5 | `UnitOutcome.pairs` unbounded | **Accepted.** `maxPairsPerOutcome`, whole-unit `failed:result-cap`. AC-3. |
| S6 | Semantic digest canonicalization incomplete | **Accepted.** §5.3/§5.4: entry order by `modelKey`, well-formed `JSON.stringify` string encoding, golden vectors. AC-1. |
| S7 | Linear-capacity failure recognized by untyped error | **Accepted (pinned matcher + compat test).** §7.2; typed error listed as optional §21.2 (g). AC-3. |
| S8 | Comparison/grouping parameters unvalidated | **Accepted.** §14.2/§15.4 validation and defaults. AC-13/AC-14. |
| Q | canClaim sync? / hierarchy acceptance / host values / coordinator uniqueness | Async (S1); OQ-16, OQ-1/OQ-17 recorded as integration prerequisites; coordinator now on a `globalThis` `Symbol.for` registry with `protocolVersion` (§7.3), direct `findClashes` callers still bypass it (OQ-11). |

Also applied from a read-only consistency audit (subagent): stale AC-9/statement-matrix/`ledgerDigest`/freshness/§ references corrected; end-of-plan input check made a boundary; three-call `resolveRoots` consistency; per-engine vs per-world accounting; `RunQueueFullError` scope; `discardRun` edge cases; caller-held summaries outside the memory bound.

**Rejected / not applied:** none. **Residual, deliberate limitations** carried forward as explicit non-goals/open questions rather than hidden: nested cross-role selection (OQ-15), models over 20,000 fragments (OQ-6), unmeasured unit-count cost of same-model bisection (OQ-5), and all unmeasured performance figures (OQ-8/9).

**Mechanical validation performed on this document:** every backticked repo-relative path exists (excepting a glob and the *planned* `test/acceptance/clash-test.acceptance.mjs`); every in-document `§` reference resolves to a heading or list item (references to other specs, e.g. M2 §6.7.5 / M4 §8.5, are external); ID families (D, F, V, AC, OQ) are gap-free and each reference resolves; every cited diagnostic `reason` literal exists in `collision/`; a scan confirms `placementCount`/`fragmentTotal`/`enumerationDigest` now occur only as retired-term explanations or historical dispositions.
