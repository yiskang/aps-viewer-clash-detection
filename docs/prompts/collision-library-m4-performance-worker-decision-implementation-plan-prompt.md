# M4 Implementation-Plan Prompt — Performance / Worker Decision Gate

Create the implementation plan for:

**M4 — Performance / Worker Decision Gate**

This is a planning task only.

Do NOT implement code.
Do NOT create any production worker architecture.
Do NOT add Federated Clash Test & Results.
Do NOT add Viewer Clash Panel scope.
Do NOT reopen settled M1–M3 public contracts.

Use as source of truth:

- `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`
- `docs/superpowers/specs/collision-library-roadmap.md`
- the actual landed `main` branch
- current `collision/` source
- current `test/performance/` gates and helpers
- current Viewer/runtime harness
- current README/CHANGELOG

Prefer landed code over stale snippets in older plans/specs when they differ.

Save the implementation plan under:

`docs/superpowers/plans/`

Suggested filename:

`2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md`

## Goal

Turn the finalized M4 design into an executable implementation plan for a **pre-registered benchmark/decision gate**.

M4's implementation outputs are:

1. a new standalone `test/performance/run-gate-m4.mjs`
2. additive benchmark-only instrumentation required by the spec
3. a pure evidence→verdict reducer with synthetic correctness fixtures
4. bounded disposable spikes under `spike/m4/`
5. machine-readable M4 evidence/results
6. exactly one final M4 verdict: **A / B / C / D**

A result of **D / blocked is a valid successful completion of M4** if that is what the pre-registered evidence mapping yields.

M4 does **not** implement the worker architecture selected by a B/C verdict.

## Planning discipline

Before writing tasks:

1. Inventory the actual landed implementations of `CollisionWorld`, scheduler/checkpoint hooks, `GeometryRegistry`, `createGeometryRegistry`, Viewer extraction/adaptation, TLAS cache / placement state, M2/M3 performance gates, and acceptance harness.
2. Reconcile every instrumentation insertion against exact current source locations/signatures.
3. Keep all M4 instrumentation additive, disabled/no-op when unused.
4. Preserve historical M1/M2/M3 gate files byte-stable.
5. Keep spike code outside `collision/` and `wwwroot/`.
6. Use RED → GREEN tests for every new seam/reducer/harness rule.
7. Put reviews at real dependency boundaries only.
8. Do not introduce extra human checkpoints beyond the final batching strategy.

## Critical scope rule

The plan must never confuse **building evidence about a worker boundary** with **building the actual worker collision path**.

Allowed:
- harness instrumentation
- stage-input capture
- stub worker lifecycle tests
- module-resolution spike
- worker startup timing
- per-message overhead spike
- stage-scoped S7′ verticals with downstream stub mapping
- progress-overhead measurement

Forbidden:
- worker-produced collision results entering the production query pipeline
- a production worker backend
- production cache ownership changes
- new cancellation API
- workerized `findClashes`
- new public result shapes
- Federated Clash Test orchestration

## Required implementation responsibilities

### 1. M4 harness skeleton and immutable provenance

Plan a new standalone `test/performance/run-gate-m4.mjs`.

It must leave `run-gate.mjs`, `run-gate-m2.mjs`, and `run-gate-m3.mjs` untouched; launch both required runtime configurations; record browser/version/flags/OS/machine class; load and re-confirm the real federated fixture; implement sacrificial warm-up; implement fresh-world identity exactly as the spec defines; produce summarized JSON only; and fail process only for correctness/harness failures, not for A/B/C/D performance outcomes.

Add tests for empty-set guards, result-file schema, provenance completeness, `FAILED_VALIDATION` exit behavior, and performance verdicts exiting normally.

### 2. Yield instrumentation

Plan scheduler instrumentation for real yield count, resume latency, and cumulative yield delay using the existing recorder-hook style.

Requirements:
- zero overhead beyond existing null-check when unused
- no public API change
- exact reset/install/clear discipline per measured call
- tests for recorder leakage and yielded vs non-yielded checkpoints

### 3. Structured diagnostic-event recorder

Plan:
- `setDiagnosticEventRecorder(fn)`
- `clearDiagnosticEventRecorder()`
- `reportDiagnosticEvent(kind, payload)`

Use the exact bounded schema from the M4 spec.

Include online aggregation only, raw-event discard, bounded top-N slow events, per-stage summaries, correlation accumulators, `inconclusiveCauses` histogram, `precheckNotRunReason` histogram, and cause co-occurrence count.

Do not encode structured payloads into span-label strings.

### 4. Hard-Clash precheck instrumentation

Plan exact telemetry for direct `volumeOverlapQuery` duration, `ProperCrossingQuery`, containment A-in-B and B-in-A, geometry resolution separately, inconclusive cause set, containment samples, precheck run/skip reason, pair geometry covariates, and repeat frequency.

Preserve existing public diagnostics and `conclusive` semantics unchanged.

### 5. Extraction vs weld brackets

Plan two non-overlapping synchronous brackets inside the actual `buildWeld(...)` body.

Requirements:
- extraction/adaptation bracket closes exactly when Viewer/collision geometry resolution returns
- weld bracket opens immediately after and closes at `compactAndWeld` completion or unsupported early return
- no overlap and no silent gap in the synchronous `buildWeld` body
- `_runPhase` await/glue overhead remains a named residual

### 6. Memory diagnostic accessors

Plan read-only accessors for Metric M: per-epoch geometry-entry count, resident geometry enumeration, welded buffer sizes, BVH internal buffers, connectivity sizes, TLAS primitive data, placement/instance counts.

Do not expose mutable internals.

### 7. S7′ benchmark-only transient input capture

Plan the disabled-by-default M4-only capture hook.

Precheck vertical: exact finalized candidate list once per measured query.

Geometry-preparation vertical: every distinct geometry actually resolved during the query, source and target roles, lazy resolution, first-discovery-wins by `(loadEpoch, geometryIndex)`, one query-local accumulated set.

Requirements:
- disabled by default
- no public collision API
- no persistent cache
- no result JSON retention
- released before next repetition
- only M4 harness/spike consumes it

### 8. Cohort profiler implementation

Plan the Viewer-only profiling helper for S1/S2 matching production extraction semantics:
- recursive depth-first subtree traversal
- `enumNodeFragments` at every visited node
- child descent
- first-discovery-wins dedup
- cohort-wide shared dedup across requested dbIds

Implement `instances(dbId)`, `proximity(dbId)`, `density(dbId)`, deterministic quantile/band selection, forced `3076` replacement, achieved weighted density, `DENSITY_UNSTRATIFIED`, and undersized `NOT EXERCISED`.

Tests must cover overlapping subtrees, descendant fragments, duplicate fragments across dbIds, deterministic ties, and density collapse at large k.

### 9. S2T target-population facade

Plan the partially-synthetic target-population slice exactly as specified.

Requirements:
- facade replaces Architecture model identity; no fourth epoch/model
- real Architecture remains geometry source
- baseline level also uses facade
- real near-source cohort preserved
- distant bystanders appended deterministically
- disjoint fragment/geometry-id ranges
- Architecture population levels 5,435 / 10,000 / 15,000 / 20,000
- fresh world per level/arm/repetition/runtime tuple
- both linear and TLAS mandatory
- multi-process runtime only
- 5 counterbalanced repetitions

Implement the exact level-to-level control rule from the spec. Violations invalidate only S2T characterization, never A/B/C/D.

Preserve the non-conclusion that S2T does not measure BLAS/weld/connectivity/GeometryRegistry scaling.

### 10. R6 placement-refresh implementation

Plan deterministic pre-calibration, capture `T₀`, world +X translation, fixed step sequence, frozen expected pair delta, two-rAF stabilization, move → invalidate → refresh, and finally restore `T₀` → invalidate again → verify restoration.

Per-arm correctness:
- TLAS: one rebuild per invalidation
- linear: zero TLAS builds

### 11. CDP trace / clock model

Plan the trace parser and clock-correlation helper:
- exact pinned categories
- measured renderer process/thread discovery
- top-level tasks only
- no nested double counting
- boundary-crossing task intersection
- paired trace/performance samples
- drift reporting
- invalid tuple on trace data loss/missing anchors

Add synthetic trace-fixture tests.

### 12. Observation envelope, rAF cadence, and input-latency probes

Plan the exact envelope and trusted-input protocol:
- pre-query rAF anchor
- post-query rAF requirement
- CDP mouse events
- fixed 100ms external cadence
- unique coordinates
- coalesced/missed probes censored
- envelope timeout
- only in-window dispatches count toward T-c
- nearest-rank p95
- minimum N=5
- `INDETERMINATE`

### 13. Stage attribution and task residual engine

Plan a pure attribution engine implementing top-level task intervals, stage intervals, yield splitting, no double subtraction, innermost classified stage wins, longest contiguous uncovered residual, `Rᵢ(all,τ)`, and per-boundary `Rᵢ(w,τ)`.

Add synthetic timeline fixtures showing overlapping stages, yielded gaps, task split around await, permissive no-boundary screen, and broader boundary residual smaller than narrower boundary.

### 14. Worker delivery-task correlation and Hᵢ

Plan Hᵢ exactly as finalized:
- snapshot/extra-copy sub-marks
- serialization/postMessage sub-marks
- first-statement `onmessage` correlation mark
- identify containing top-level delivery task
- include delivery-task interval from task start up to `min(task end/yield, closing mark)`
- never credit post-close validation/sampling/disposal
- ambient Viewer/rAF/input tasks excluded
- `UNEVALUABLE` if task cannot be identified uniquely

Do not change the `Rᵢ(w,τ)+Hᵢ(w,τ)` formula.

### 15. Metric M / Metric H

Plan deterministic Metric M exactly from the spec, including welded arrays, BVH roots/indirect, connectivity, TLAS, placement/instance constants, payload backing buffers, metadata arithmetic, and physical-residency de-duplication.

Keep `instanceBytes = 88` and `recordBytes = 104` unless landed shapes changed; if they changed, recompute by the same declared rule.

Metric H remains cross-check only with feature detection and explicit `UNAVAILABLE`.

### 16. Verdict reducer

Plan the evidence→verdict reducer as a pure function with no measurement/I/O.

Encode mandatory-D precedence, A, B, C, otherwise D, boundary applicability, `UNEVALUABLE / INSUFFICIENT / SUFFICIENT`, B-class vs C-class, multi-tuple aggregation, and each named D cause.

Synthetic evidence-vector tests must cover all §19.3 fixtures, including A/B/C, all ten §7.5 D causes, §1.1 no-boundary D, B-over-C precedence, no sufficient applicable boundary, mixed cold/warm/multi-tuple aggregation, and every UNEVALUABLE trigger.

### 17. S1′ module-resolution spike

Plan one bounded same-origin module-worker spike:
- current bare-specifier entry
- at most one relative-path-only variant
- if needed, one repository-local rewrite/build variant using Node built-ins only
- no bundler dependency
- no blob worker
- no request interception

### 18. S3′ worker startup spike

Plan one worker, 10 repetitions, creation → first acknowledged message, both runtimes, median/max, explicit cleanup.

### 19. S4′ lifecycle/stale-result stub-worker spike

Plan stub-worker request-state machinery for all eight §10.4 scenarios, including monotonic requestId, workerGeneration, independent concurrent settlement, duplicate response handling, protocol-fatal unattributable messages, request-local schema failure, and no unsettled promise.

No geometry and no production worker code.

### 20. S5′ conditional termination spike

Only if selected topology depends on termination.

Measure long-running task termination latency, main-thread non-blocking behavior, next-query cold/rebuild cost, and cleanup.

### 21. S6′ message-overhead spike

Conditional. Measure compact request/response shape at observed candidate volume, result-message volume, per-message latency, bytes, and total overhead.

S6′ is explanatory only and never independently decides C.

### 22. S7′ stage-scoped worker verticals

Highest-risk spike-planning task.

Plan only the two authorized verticals.

Geometry-preparation vertical:
- models WB-1b
- extra main-thread copy
- weld/connectivity/BVH in worker
- optional isolated worker-side BVH-construction subspan for WB-1a evidence
- downstream stub mapping

Hard-Clash-precheck vertical:
- models WB-2p only
- exact real candidate list
- query-local worker-resident dataset
- precheck execution
- compact result
- downstream stub mapping

Do NOT invent a full-query worker path, exact-query vertical, clearance-distance vertical, or WB-2/WB-4 production path.

Use stage-scoped validity, 5 paired repetitions, report-only stage cost, Hᵢ, memory metrics, post-close validation, and immediate disposal.

Never route S7′ through §7.4.2.

### 23. S8′ progress-overhead spike

Conditional with S7′. Same worker/case, progress every 10ms, paired on/off, report X-1/X-2/X-3 delta, no verdict effect.

### 24. Full M4 matrix orchestration

Plan orchestration for R1–R6, S1, S2, S3, S4, S2T, and conditional spikes in fixed order.

Respect runtime requirements, fresh-world identity, counterbalancing, capacity rejections, workload-validity gates, and external-input mandatory-D conditions.

Never silently skip an inconvenient arm.

### 25. Correctness/parity gates

Plan the canonical comparator in one reusable location and prove pair-set exactness, TLAS/linear bit-identical distances, worker-only 1e-9 relaxation if a future full-result worker arm exists, witness tolerance, statistics equality, complete diagnostics multiset key, conclusive/incomplete semantics, deterministic aggregation, and R6 correctness.

Keep stage-scoped spike validity separate from full-result parity.

### 26. Reporting and final disposition

Plan final JSON/report fields for workload/provenance, responsiveness metrics, stage attribution, main-only/transferable partition, S2T characterization, memory metrics, spike outcomes, boundary dispositions, mandatory-D causes, reducer inputs, final A/B/C/D, unresolved external inputs, and named resolution path for D.

No raw event dumps.

The report must distinguish:
- D/no-boundary
- D/no-full-query-evidence
- D/no-settled-boundary
- prerequisite-driven D

## Required task sequencing

Derive the exact task count from dependencies, but organize roughly as:

### Batch 1 — Instrumentation and pure engines
scheduler hooks, extraction/weld brackets, precheck telemetry, memory accessors, S7′ capture, trace/clock parser, attribution/Rᵢ/Hᵢ engines, Metric M, verdict reducer.

### Batch 2 — Workload harness
base M4 gate, cohort profiler, S2T facade, R6, rAF/input envelope, R/S orchestration, canonical comparator.

### Batch 3 — Bounded spikes
S1′, S3′, S4′, S5′ conditional, S6′ conditional, S7′, S8′.

### Batch 4 — Real execution / evidence / closeout
real gate execution, conditionally required spikes, reducer validation, A/B/C/D disposition, evidence report, docs/CHANGELOG if project convention requires it, disposal/removal of spike code unless explicitly adopted.

Use different grouping only when actual dependencies justify it.

## Batch review strategy

At each batch boundary:
- targeted review only for that batch's contracts
- fix genuine Critical/High findings in-batch
- run relevant tests
- run full regression suite where production instrumentation changed
- main orchestrator independently verifies subagent claims
- report commits/tests/unresolved items/readiness

Do not create additional arbitrary checkpoints.

## M4 completion criteria

M4 is complete when:

1. the full harness exists and passes its own correctness/self-tests;
2. instrumentation is additive/no-op when unused;
3. historical M1/M2/M3 gates remain untouched;
4. all declared executable R/S cases are run or honestly reported `NOT EXERCISED` / `CAPACITY_REJECTED`;
5. required spikes run only under declared conditions;
6. correctness gates are green;
7. verdict reducer tests are green;
8. the pre-registered mapping produces exactly one A/B/C/D;
9. all mandatory-D causes are named where applicable;
10. D is accepted as successful M4 completion when mechanically produced;
11. no production worker architecture is implemented;
12. disposable spike code is removed unless explicitly adopted by the verdict.

End the plan with:

**Ready for execution**

Do not implement anything yet.
