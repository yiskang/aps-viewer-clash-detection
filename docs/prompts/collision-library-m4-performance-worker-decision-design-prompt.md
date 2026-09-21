# M4 Design Prompt — Performance / Worker Decision Gate

Create the design spec for the next collision-library milestone:

**M4 — Performance / Worker Decision Gate**

This is a design/spec task only.

Do NOT implement code.
Do NOT create an implementation plan yet.
Do NOT add Federated Clash Test & Results.
Do NOT add Viewer Clash Panel scope.
Do NOT reopen settled M1–M3 architecture unless the M4 evidence model exposes a concrete contradiction.

Use as source of truth:

- the actual landed `main` branch after M3 merge,
- `docs/superpowers/specs/collision-library-roadmap.md`,
- the completed M1–M3 specs/plans,
- `collision/README.md`,
- `CHANGELOG.md`,
- existing performance gates (`run-gate.mjs`, `run-gate-m2.mjs`, `run-gate-m3.mjs`),
- existing scheduler/checkpoint instrumentation.

Save the new spec under:

`docs/superpowers/specs/`

Suggested filename:

`2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`

The roadmap is binding: M4 remains a **benchmark-driven decision gate** for whether worker/off-main-thread execution is actually necessary.

---

## Product / architecture goal

M4 must answer:

> Is the current synchronous collision architecture good enough under realistic federated workloads, or is some worker/off-main-thread execution justified?

This is not a foregone conclusion.

The outcome may be:

1. **No worker needed** — current architecture remains synchronous.
2. **Targeted worker boundary justified** — only specific expensive work moves off-main-thread.
3. **Broader off-main-thread architecture justified** — evidence supports a more systemic worker design.
4. **Insufficient evidence / blocked** — current benchmarks cannot justify a safe decision yet.

The spec must define how to reach one of these outcomes without bias.

---

## Current evidence to treat as provisional, not assumed truth

M3 produced useful evidence, but M4 must re-measure rather than copy conclusions blindly:

- TLAS produced meaningful candidate reduction in realistic federated scenes.
- Candidate reduction did not automatically imply equivalent end-to-end wall-clock improvement.
- In M3, Hard-Clash precheck cost dominated more than the clearance-distance primitive itself.
- Worst measured `clearanceQuery` single-call span was roughly **6.1–6.5 ms** against an **8 ms** frame budget.
- The margin was real but thin.
- M3 explicitly proved that correctness parity between TLAS and linear must be a hard gate, not a reporting-only metric.

Use these as hypotheses / baseline evidence only.

---

## Required design decisions

### 1. Workload matrix

Define a representative workload matrix.

At minimum cover combinations of:

- one source vs one target model
- one source vs many federated target models
- whole-model target scope
- small / medium / large fragment counts
- low / medium / high candidate density
- Hard Clash (`volume-overlap`)
- Soft Clash (`clearance`)
- cold vs warm cache
- placement-refresh / invalidation cases
- pathological but realistic geometry where one pair is expensive

Do not rely on one happy-path fixture.

Prefer a bounded matrix with a small number of deliberately chosen representative cases.

---

### 2. Measurement protocol

Define exactly how each case is measured.

At minimum:

- warm-up policy
- cold vs warm runs
- number of repetitions
- median / percentile / worst-case reporting
- separation of:
  - extraction
  - BLAS build/cache
  - TLAS build/cache/query
  - broad-phase candidate work
  - Hard-Clash precheck
  - exact narrow phase
  - clearance distance query
  - scheduler/yield overhead
  - total end-to-end latency
- single atomic synchronous span measurement
- total main-thread blocked time
- total elapsed time

Avoid using only total wall-clock if it hides where the cost occurs.

---

### 3. Decision thresholds

Define the criteria that determine whether worker/off-main-thread execution is justified.

The spec must distinguish:

- **frame-budget risk** — one atomic synchronous span exceeds the allowed frame budget
- **aggregate latency** — total query time is high but individual spans remain cooperative
- **throughput pressure** — many candidate pairs cause long total work despite acceptable per-span cost
- **memory pressure**
- **transfer/rebuild overhead**

Do not invent arbitrary thresholds without rationale.

Where numeric thresholds are provisional, mark them as such and tie them to existing project conventions.

---

### 4. Possible M4 verdicts

Define explicit decision outcomes.

For example:

#### A. Stay synchronous
Criteria may include:
- no realistic atomic span materially exceeds frame budget,
- yielding keeps UI responsive,
- worker transfer/rebuild cost would outweigh benefit,
- memory duplication is not justified.

#### B. Targeted worker
Possible candidates:
- BLAS build only,
- selected narrow-phase primitive,
- clearance distance evaluation,
- Hard-Clash precheck sub-stage,
- batch-level work partitioning.

#### C. Broader worker architecture
Only if evidence shows multiple expensive synchronous stages and a coherent transferable data boundary.

#### D. No decision yet
If worker feasibility cannot be evaluated safely without additional research/spikes.

The design must not force a worker answer.

---

### 5. Worker-boundary feasibility

Evaluate what can actually cross a worker boundary.

At minimum analyze:

- geometry buffers
- welded geometry
- BVH serialization / transferability
- BVH rebuild cost inside worker
- transferables vs structured cloning
- memory duplication
- cache ownership
- TLAS ownership
- per-model placement state
- diagnostics/statistics transport
- result transport
- cancellation signaling
- progress signaling

Do not assume existing Three.js / `three-mesh-bvh` objects are directly transferable.

---

### 6. Runtime identity implications

The roadmap distinguishes live runtime identity from future durable identity.

M4 must preserve that distinction.

Evaluate how worker boundaries interact with:

- live Viewer `Model` object references
- `loadEpoch`
- geometry identity
- fragment identity
- source/target provenance
- model unload / eviction
- stale worker results

A worker must never become an alternate identity authority.

Define how the main thread retains authoritative Viewer/model lifecycle ownership.

---

### 7. Lifecycle / stale-result correctness

A worker design, if adopted, must preserve:

- model unload semantics
- `loadEpoch`
- placement revision validation
- `invalidateModelPlacement(model)`
- query cancellation
- stale-result rejection
- no result from an evicted/replaced model being accepted accidentally

Design the required version/revision tokens if needed.

Do not weaken existing M2/M3 lifecycle correctness.

---

### 8. Cancellation / abort compatibility

M4 is not the Federated Clash Test result layer, but worker feasibility must evaluate cancellation.

Define what M4 needs to prove about:

- cancellation signal path
- cooperative abort checks
- worker termination vs graceful cancellation
- partial work disposal
- stale-result discard
- cleanup of transferred/rebuilt geometry state

Do not define final batch-result terminal semantics here; that belongs to future Federated Clash Test & Results.

---

### 9. Progress / yielding compatibility

The roadmap requires preserving progress/yielding compatibility.

Evaluate:

- whether current scheduler checkpoints already keep the UI responsive,
- whether worker execution would remove or reduce the need for main-thread yielding,
- whether progress can be reported from worker stages,
- whether progress reporting itself introduces meaningful overhead.

Do not add UI progress components.

---

### 10. Cache architecture

If worker execution is considered, define cache ownership options:

- main-thread BLAS + worker rebuild
- worker-owned BLAS cache
- duplicated caches
- transferable serialized acceleration structure if supported
- per-worker vs shared strategy

Evaluate:

- startup cost
- warm-query cost
- memory cost
- invalidation
- eviction
- model replacement
- cache coherency complexity

Do not choose the most complex option by default.

---

### 11. Hard-Clash precheck focus

M3 evidence suggests Hard-Clash precheck can dominate Soft Clash cost.

M4 must measure it explicitly.

Break down:

- `ProperCrossingQuery`
- containment terms
- inconclusive cases
- non-manifold / parity-tainted cases
- how often the precheck runs
- how often it can be skipped because AABBs are disjoint
- cost distribution across real geometry

Evaluate whether any worker boundary should target this stage specifically.

---

### 12. Clearance distance focus

Re-measure `closestPointToGeometry` rather than assuming M3's 6.1–6.5 ms worst case remains representative.

Measure:

- per-call spans
- distribution
- geometry-size correlation
- cold/warm effect
- unequal-scale cases
- candidate-density effect
- how often the threshold-bounded query returns quickly

Determine whether the distance primitive itself is a worker candidate.

---

### 13. TLAS vs linear evidence

Preserve the permanent linear oracle.

M4 performance analysis must continue to compare TLAS vs linear on identical queries.

Required principle:

**Correctness parity is mandatory.**

Performance benefit is measured separately.

Do not remove or weaken `broadPhase:'linear'` for the sake of cleaner benchmark numbers.

---

### 14. Memory and duplication budget

If workers require duplicated geometry/BVH state, define how memory cost is measured.

At minimum report:

- base collision-world memory
- per-model BLAS memory
- TLAS memory
- worker duplicate / rebuilt structures
- peak memory during transfer/build
- steady-state memory

A worker design that improves responsiveness but doubles or triples memory without justification may still be rejected.

---

### 15. Benchmark harness design

Decide whether to:

- extend `run-gate-m3.mjs`,
- create a new `run-gate-m4.mjs`,
- or introduce a small shared benchmark harness.

Prefer minimal new infrastructure.

The M4 harness must:

- reuse real federated fixtures where possible,
- support bounded synthetic pathological cases where real fixtures lack coverage,
- produce summarized machine-readable JSON,
- never silently report GO from unexercised criteria,
- fail loudly on correctness mismatches.

---

### 16. Required spikes

If exact worker feasibility cannot be determined from static source review, define bounded spikes only.

Possible spikes:

- can a BVH be serialized/transferred safely?
- cost of rebuilding a representative BLAS in a worker
- transfer cost of welded geometry buffers
- stale-result rejection prototype
- worker cancellation latency

Every spike must have:
- a narrow question,
- a bounded implementation,
- a measurable result,
- explicit disposal afterward unless adopted.

Do not turn M4 design into hidden implementation.

---

## Downstream roadmap constraints

Preserve `collision-library-roadmap.md`.

M4 must not:

- implement Federated Clash Test definitions
- add Selection A / Selection B
- add persistent result sets
- add Group By/filtering UI
- add Viewer Clash Panel
- introduce issue/status workflow
- hard-code worker APIs that make future many-object orchestration harder

M4 worker decisions must remain compatible with future:

- many-object execution
- cancellation
- progress
- grouping/filtering-ready result semantics
- stable source/target provenance

---

## Correctness gates

Any worker/off-main-thread proposal must prove parity with the existing synchronous path.

Required categories:

- same final pairs
- same source/target provenance
- same diagnostics
- same `conclusive` / incomplete-result semantics
- same clearance distance / witness
- same deterministic aggregation
- same lifecycle rejection behavior
- same placement invalidation behavior

The synchronous implementation remains the oracle during M4 unless the spec explicitly proves a defect in it.

---

## Required review

After drafting:

1. Run one independent targeted design review focused on:
   - benchmark methodology,
   - worker-boundary feasibility,
   - lifecycle/identity correctness,
   - memory implications,
   - cancellation/progress compatibility,
   - decision criteria not being biased toward workers.
2. Fix genuine Critical/High findings in the same pass.
3. Do not run a comprehensive historical review.
4. Do not reopen M1–M3 unless a concrete M4 contradiction is proven.

---

## Final report

End the spec with:

- adopted workload matrix
- measurement protocol
- decision thresholds
- explicit M4 verdict categories
- worker-boundary options considered
- lifecycle/identity model
- cancellation/progress feasibility requirements
- cache/memory evaluation strategy
- benchmark harness plan
- required spikes
- correctness gates
- remaining open questions
- explicit verdict:

`ready for implementation planning`

or

`not ready for implementation planning`

with precise blockers.

Do not implement anything yet.
