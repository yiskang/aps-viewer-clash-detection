# Federated Clash Test & Results convergence and abstraction-boundary review

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256:** `eca085bf1d415ec3ccbeb36af4ddc024be5f876d3bd331066e1e246334876a5a`
- **Primary review evidence:** internal Codex reviews Round 10 through Round 19 in `docs/reviews/`
- **Current-state cross-check:** `docs/handoffs/latest.md`, the current draft through its Round 21 dispositions, and the presently listed unremediated follow-up findings
- **Review date:** 2026-09-20
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `62aa07054a0ff957021e9f43862d0595fca07f82`
- **Purpose:** Decide whether the design is converging, not discover another round of defects.

## Adjudication

The normal defect-finding loop should stop.

The core Federated Clash Test & Results architecture has converged. Round 10–19 repeatedly confirmed the three-cell planner, fail-closed coverage model, durable identity, and `CollisionWorld.findClashes` orchestration. The genuine architectural findings in those rounds were concentrated in a small set of safety invariants—stable input snapshots, source-population completeness, coherent freshness, truthful no-clash claims, and self-consistent persisted results. Those invariants are now present in the current draft.

From approximately Round 14 onward, most new findings arose in machinery added to remediate earlier reviews: descriptor-safe Result Set capture, read-slot queues, listing pagination, ambiguous remote-write reconciliation, detached disposal state, annotation cancellation, derivation schedulers, configurable caps, and byte/node accounting. Those are valid implementation concerns, but continuing to encode every algorithm and backend behavior in the design spec is creating new internal contracts faster than it is reducing architectural risk.

The correct boundary is now:

- freeze the core design and its externally observable safety invariants;
- carry mechanical contract errata into a short controlled correction list, without another open-ended design review cycle;
- resolve implementation machinery in implementation planning or focused follow-up specifications; and
- keep live evidence, calibration, and product choices as named gates.

## Core design stability

| Core area | Assessment | Reason |
| --- | --- | --- |
| Federated test semantics | **Stable** | One test definition, durable model/test identities, explicit model/element selections, and one collision mode per test are coherent and roadmap-aligned. |
| Three-cell pair-space decomposition | **Stable** | The decomposition handles same-model overlap, cross-model work, recursive subtree extraction, self-exclusion, deterministic splitting, and exact-cover accounting. No Round 10–19 review found a replacement architecture. |
| Coverage / gap / caveat semantics | **Stable** | Missing work becomes a gap; incomplete evidence becomes a caveat; hierarchy/unreachable populations block or qualify claims; empty results alone never prove absence. Later findings refined proof collection rather than changing these semantics. |
| Deterministic identity | **Stable** | `modelKey`/`modelVersion`, `ElementRef`, `PairId`, `semanticDigest`, `ResultId`, test tombstones, and atomic durable identity claims form a consistent identity model. Host truthfulness remains an explicit integration boundary. |
| Orchestration over `CollisionWorld.findClashes` | **Stable** | The engine plans bounded units, calls the existing public API, validates outcomes, preserves library diagnostics, and does not require M4 Phase 4 or a silent collision-core change. |
| Lifecycle and cancellation architecture | **Stable** | Queueing, one in-flight call per world, lease/generation checks, unit-boundary cancellation, fail-closed drift, and terminal precedence are architecturally settled. Exact scheduler and detached-job mechanics belong in the plan. |
| Durable Result Set semantics | **Stable at the architectural level** | A sealed immutable set embeds its definition, provenance, results, ledger, diagnostics, outcome, and digests; corrupt/untrusted reads must not become trusted claims. Backend transaction, pagination, and remote-ack machinery are separable. |

## 1. Design correctness blockers

These are the concerns that legitimately belonged in the design specification because getting them wrong could produce false-clean results, identity aliasing, or externally contradictory terminal data. The current draft contains the required architectural rules.

| Concern family | Review recurrence | Required design invariant | Current adjudication |
| --- | --- | --- | --- |
| Stable inputs across asynchronous work | R10 definition mutation; R11 validation/capture; R14–R19 external Result Set TOCTOU | Every definition or Result Set used across yields is a stable captured value; validation, digesting, planning, and claim evaluation must observe the same value. | **Core invariant resolved.** Exact descriptor-walk/copy algorithm, queue admission, and node ceilings move to implementation planning. |
| Whole-model/source completeness | R11 false-clean source omissions; R13 unreachable persistence; R19 source population bracket | A clean absence is impossible unless every required source/target scope is proven equal or is represented by a gap/caveat/exclusion. Whole-model source population must be bracketed as well as roots. | **Resolved in current design.** Live feasibility remains OQ-4 research. |
| Coherent live freshness | R14 and R16 freshness races | Claim-time freshness must bracket the full multi-model operation and fail closed on binding, placement, version, or scope change. | **Resolved architecturally.** The exact snapshot/digest loop is implementation detail once the invariant and tests are retained. |
| Truthful no-clash claims | R12 bracketed-proof challenge; R15 qualifier loss; R16 missing engine method; R18 empty-results omission; R19 OQ-19 contradiction | A claim requires empty results, completed/full/clean/current evidence, no unaccepted blocker, and an explicit proof/qualification model. A boolean may authorize only an unqualified statement. | **Resolved at the design level.** Acceptance of bracketed proof is a product decision, classified below. |
| Durable identity and deletion | Earlier NH1/NH3 plus recurrence in persistence reviews | New durable results cannot reuse a deleted `testId`; model versions cannot alias; atomic insertion cannot partially claim identity. | **Resolved.** Store implementation mechanics belong to the persistence plan/spec. |
| Terminal schema before/without resolution | R10 immediate cancellation; R12 archive-state lookup | Pre-resolution cancellation/failure must have a valid Result Set representation, and stored-reference admission must observe definition plus lifecycle state coherently. | **Resolved architecturally.** Exact DTO/API shapes are plan work. |
| Persisted writer/reader consistency | R13 unreachable-owner validation; R19 completed-partial readback | A Result Set the engine can validly produce must pass the same schema/semantic validation when read back; validation must preserve nonfatal gaps. | **Resolved as an invariant.** Test matrices belong in the implementation plan. |
| Environment-dependent outcomes | R10 cache membership and foreign placement contention | Environmental inputs that can change coverage must be recorded or explicitly declared observational; they must never silently support a stronger determinism claim. | **Resolved by narrowed claims and explicit causes.** Reproduction of cache membership is not required. |

One current mechanical erratum remains in this category: the latest handoff reports that §13.6 checks `result.type` although persisted `ClashResult` uses `result.mode`. Correcting `type → mode` is necessary so a valid writer is not rejected by its reader, but it is a bounded terminology fix—not evidence that the architecture needs another review round.

## 2. Implementation-plan requirements

These concerns are important, but they should be decided while decomposing modules, interfaces, tests, and resource ownership. They should not keep expanding the core design spec.

| Concern family | Review recurrence | Planning requirement |
| --- | --- | --- |
| Capture implementation | R11, R14–R19 | Choose the stable-input mechanism: descriptor-safe copy, trusted ownership transfer, bounded serialized bytes, or separate raw-input admission. Define read-slot timing and test mutation at yields. |
| Executor DTO validation | R10, R13, current diagnostic-type finding | Split per-unit projected diagnostics from stored aggregated diagnostics; define closed DTOs, enums, subset checks, and executor-side overflow signaling. |
| Persistence attempt state machine | R14–R18 | If remote stores are supported, specify ambiguous commit reconciliation, timeout, disposal ownership, retry/discard behavior, and one-shot observer settlement in a focused persistence design. For local v1, keep the port transactional and simpler. |
| Store reads and listings | R10, R11, R13–R15, R19 | Define read backpressure, nonresident behavior, summary schemas, page tokens/snapshot policy, corrupt-entry behavior, and byte-guard capability in the storage work package. |
| Derivations and comparison | R12–R16 | Choose engine-bound or context-bound scheduling; define async slicing, abort, concurrency, output caps, facet truth tables, comparison determinism metadata, and extreme numeric handling. |
| Annotation lifecycle | R11, R13, R16–R17, current Map concern | Define cancellation, supersession, source ownership, concurrency, pre-allocation limits, finite scalar handling, and eviction/disposal behavior in an annotation follow-up design or plan section. |
| Option/default ownership | R14, R17–R19, current defaults mismatch | Produce one exhaustive configuration table in the implementation plan and generate/verify public option schemas from it. Resolve `broadPhase`, yielding, persistence, cap, and diagnostic-retention defaults there. |
| API/editorial consistency | R15–R19 and current Mediums | Reconcile method signatures, reference-overload discrimination, `externalId`, archive wording, `mode/type`, legal retry states, and acceptance examples as a finite pre-plan errata checklist. |
| Runtime resource bookkeeping | R10, R14, R16–R19 | Implement slot/counter invariants and stress tests. Exact object/node/record formulas are implementation assertions, not product architecture. |

These items may block completion of the implementation plan or a particular work package, but they do not justify reopening federated pair-space, coverage, identity, or lifecycle design.

## 3. Verification / calibration gates

| Gate | Evidence required | Effect |
| --- | --- | --- |
| Viewer owner mapping and enumeration (OQ-4) | Live Viewer research artifact covering tree-owner vs. `fragList.getDbIds`, source enumeration, readiness, unreachable/mixed populations, and the documented fallback. | Blocks the Viewer-adapter work package, not the core engine plan over the enumerator port. |
| Browser memory and synchronous capture | AC-12 measurements of bytes per record/node, peak clone amplification, maximum synchronous capture/validation span, and resident/transient worst cases on the reference environment. | Freezes deployable defaults; does not require more design prose. |
| Batch responsiveness and scheduling | Unit makespan, frame gaps, cancellation latency, derivation/annotation concurrency, and chosen scheduler behavior. | Tunes caps/yield policy during implementation. |
| Geometry/tree readiness limits | Live evidence about render-proxy readiness and instance-tree completeness where available. | Characterizes supported content and claim caveats; cannot be solved by inventing an unevidenced witness. |
| Maximum-shape persistence | Produce → persist → evict → read → validate/rerun tests at calibrated ceilings. | Validates writer/reader invariants and store adapters. |

## 4. Product / integration decisions

| Decision | Owner input required | Why the spec should not decide it alone |
| --- | --- | --- |
| Authorization scope | Decide whether the next plan covers the core engine only or core plus Viewer adapter. | OQ-4 evidence is absent; core work can proceed over a port while adapter work cannot. |
| Durable model identity derivation (OQ-1) | Host/Panel must choose genuine `modelKey` and `modelVersion` witnesses. | The engine cannot infer content identity safely. |
| Placement invalidation ownership (OQ-17) | Host/Panel must name the component responsible for every transform change. | No engine-only prose can detect an unreported host mutation. |
| Hierarchy-internal acceptance (OQ-16) | Product owner must accept or reject the qualified limitation using fixture evidence. | This is a supported-content/product claim, not an algorithm question. |
| Bracketed-proof claim policy (OQ-19) | Product owner should affirm the standing policy or require a stronger core witness/qualified claim. | A transient A→B→A excursion is an acknowledged proof limitation shared by current query boundaries. |
| Browser memory/stall budget | Product owner must confirm a target environment and acceptable peak/stall budget. | Caps cannot be “correct” without a deployment target. |
| Persistence backend scope | Choose local transactional v1 versus remote/server-backed v1. | Remote acknowledgement ambiguity introduces a distributed protocol that deserves its own design. |

## 5. Deferred / non-goals

- M4 Phase 4, workers, transferables, and shared-memory execution remain unauthorized.
- Collision-core enhancements such as per-call population identity, exact-owner extraction, abortable `findClashes`, or admission isolation remain separate roadmap §8 proposals.
- Cross-version element reconciliation and workflow-state carry-over remain host/Panel concerns.
- UI, Group By presentation, approvals, assignments, comments, issue management, and backend synchronization remain outside the first core milestone.
- Nested ancestor/descendant selection, models beyond collision-core capacity, incremental/resumable runs, and multi-test suites remain deferred as already stated by the spec.

## Why the loop stopped converging

The later review loop mixed three abstraction levels in one artifact:

1. **Architecture:** pair space, truth semantics, identity, lifecycle, durable result meaning.
2. **Implementation contract:** exact DTO fields, scheduler queues, retry states, page tokens, capture algorithms, default tables.
3. **Operational qualification:** live Viewer evidence, memory measurements, product claim policy, deployment budgets.

The first level converged. Attempts to fully freeze the second and third levels inside the design spec introduced recurring machinery defects:

- capture hardening created node ceilings, read queues, and raw-input admission contradictions;
- remote persistence support created ambiguous outcomes, reconciliation timeouts, detached disposal, and one-shot settlement contradictions;
- annotation and derivation bounds created cancellation, scheduler ownership, and pre-allocation questions;
- precise memory accounting created defaults and formula drift;
- claim qualification fixes created additional API-shape and predicate duplication issues.

This does not mean those concerns are unimportant. It means the correct next artifact is an implementation plan—or a focused persistence/annotation spec—not another whole-design defect pass.

## Freeze recommendation

Freeze the following as the core design baseline: test semantics, three-cell exact-cover planning, gap/caveat/claim rules, identity, unit orchestration over `findClashes`, lifecycle precedence, and sealed Result Set meaning.

Before starting code, perform one **bounded errata pass** limited to mechanical contradictions already enumerated in the current handoff and this review (`result.mode`, diagnostic DTO naming, single defaults table, legal retry/overload/signature examples). Do not run another open-ended full-spec defect loop after that pass.

Split the remaining work into:

1. a core-engine implementation plan;
2. a Viewer-adapter OQ-4 research artifact and subsequent adapter plan;
3. a persistence-backend contract only if remote persistence is in v1;
4. an annotation/derivation plan or follow-up spec; and
5. product decision records for identity derivation, placement ownership, hierarchy acceptance, bracketed claims, and deployment budgets.

`freeze core design; split remaining gated areas into separate follow-up specs/research`
