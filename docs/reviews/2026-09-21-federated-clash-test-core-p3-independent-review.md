# Federated Clash Test core — P3 independent implementation review

- **Date:** 2026-09-21
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/federated-clash-test-core-engine`
- **Reviewed checkpoint:** `34d0eb3b51d567ce575518ba2e961c72f978cbd1` (`feat(clashtest): P3 planner (enumerator port, scope digests, decomposition, sizing, splitting, ledger)`)
- **Scope:** P3 only. P0–P2 remain accepted and were not reopened. The frozen design was used as the governing contract and was not modified.
- **Verdict:** **P3 not accepted. Four High implementation findings block P4.** This document is an independent Work review claim and requires the targeted adjudication prescribed by `CLAUDE.md` before remediation or phase advancement.

## Finding summary

| Severity | Count | Gate effect |
| --- | ---: | --- |
| Critical | 0 | — |
| High | 4 | Block P3 acceptance and P4 |
| Medium | 1 | Remediate with the blocking P3 pass |
| Low | 1 | Test-hardening follow-up; not independently blocking |

## High findings

### H1 — Cell decomposition allocates an unbounded quadratic intermediate before either plan guard

**Evidence:** `clashtest/planning/decompose.js:49-107`; `clashtest/planning/planner.js:276-285`; frozen spec §6.5.1 and AC-16/AC-18(c).

`decomposeCells` eagerly returns one array containing every cell. Cell 3a appends one record for each model pair (`m < n`), doubled in ordered mode. `createPlan` materializes that entire array before `sizeUnits({limit})` sees the remaining `maxUnitsPerRun` capacity and before cell/range records are admitted against `maxPlanReferences`.

This defeats the incremental-before-allocation contract. With 10,000 models carrying one `C` root, unordered cell 3a alone has 49,995,000 CellSpecs. Planning can exhaust memory or monopolize the main thread before returning `plan-too-large`, even when `maxUnitsPerRun` is 10,000. A focused probe with only 500 such models created 124,750 CellSpecs and increased the observed heap by about 51 MiB before any unit guard ran.

**Minimum correction:** make decomposition lazy, or fuse decomposition and sizing so each CellSpec is consumed under the remaining unit/reference budget and checkpoint seam. Stop at the first provable overrun without retaining the unadmitted pair space. Add a many-model `C`-root test that proves bounded allocation and deterministic `plan-too-large` behavior.

### H2 — Cap-sized planning contains multiple unsliced, non-cancellable spans

**Evidence:** `clashtest/planning/planTables.js:29-120`; `clashtest/planning/decompose.js:49-107`; `clashtest/planning/sizing.js:123-197,215-256`; `clashtest/planning/planner.js:272-359`; frozen spec §17.3 and AC-12(a).

The planner awaits `checkpoint()` between coarse stages and cell groups, but large inner work does not receive or invoke the deadline-aware seam. Examples include root/owner table construction, cell decomposition, source packing, target slicing, unit construction, range totals, root-owner projection, large array filtering/mapping, ledger commit, and recursive `deepFreeze`. Cancellation cannot be observed during these spans. H1 makes the worst case extreme, but the contradiction remains even after bounding decomposition: a legal plan can contain up to 500,000 planning records and 10,000 units, while §17.3 requires engine-controlled planning to check time at least every 64 items and yield when its slice budget expires.

**Minimum correction:** thread the P0 slicer/checkpoint through every size-dependent planning loop (including decomposition/sizing and final plan assembly/freezing), or express those stages as async iterators consumed by `createPlan`. Add a fake-clock cap-shaped test proving repeated yields and cancellation from inside each large stage, not only between stages.

### H3 — The “sliced” scope-digest path performs its largest sort/copy/projection synchronously

**Evidence:** `clashtest/planning/scopeDigest.js:33-43,53-55,66-70`; frozen spec §6.2.1, §17.3 and AC-12(a); P3 plan phase interface for `digestPopulation` / `digestSubtree`.

Passing a slicer affects only `digestCanonicalSliced`. Before that call, `digestPopulation` executes `[...records].sort(...).map(...)` through `encodePopulationRecords`, and `digestSubtree` performs the same copy/sort/map pattern. Whole-model inputs may reach the collision-instance ceiling, so the Viewer adapter cannot make the full digest operation deadline-aware through the public P3 helper. AC-12 would measure only the canonical encoding/hash slices while the preprocessing stall remains outside the reported sliced span.

**Minimum correction:** use a sliced stable sort and sliced validation/projection (or accept a separately validated canonical record stream and verify it incrementally), with the same bytes as the current digest. Add fake-clock tests that force yields during preprocessing itself for population and subtree digests.

### H4 — Duplicate unresolved dbIds can be emitted into a Result Set shape that P5 must reject

**Evidence:** `clashtest/planning/ElementEnumerator.js:128-151`; `clashtest/planning/rootResolution.js:179-189`; `docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1443`.

The explicit-answer validator checks each unresolved row and its relationship to requested/resolved ids, but not uniqueness within `unresolved`. `rootResolution` sorts the `no-fragments` ids without deduplicating them. A conforming-looking enumerator response containing the same `{dbId: 1, reason: 'no-fragments'}` twice therefore produces an `UnresolvedSelection.dbIds` value of `[1,1]`. P5's pinned durable schema requires that array to be unique, so the core writer can produce a ledger its own future Result Set validator rejects.

The focused boundary probe returned `{ok:true, issues:[]}` for that duplicate input.

**Minimum correction:** reject duplicate/unordered unresolved ids at the enumerator boundary, or canonicalize them to a strictly ascending unique list before ledger construction. Pin both the boundary behavior and a production-path ledger round-trip compatible with P5's shape.

## Medium finding

### M1 — Malformed whole-scope observations are reported as demonstrated drift

**Evidence:** `clashtest/planning/scopeDigest.js:92-104`; `clashtest/planning/ElementEnumerator.js:165-190`.

`compareScopeExpectation` verifies only `observed.kind === 'population'` for a whole scope. Invalid values such as `{count:'bad', digest:null}` are classified as `mismatch`, although the function's contract says an unreadable/malformed observation is `unverifiable`. The roots branch does perform structural validation. A focused probe reproduced `status:'mismatch', detail:'population'` for the malformed whole observation.

Both outcomes fail closed for a clean claim, so this is not a false-clean defect, but it changes the externally observable reason and can misdiagnose an adapter/corruption failure as input drift.

**Minimum correction:** validate the whole observation's count and digest shape before comparison, preferably through the same rules as `validateDigestScopeResult`; return `unverifiable / malformed-observation` when invalid. Add the symmetric whole/roots tests.

## Low finding

### L1 — The unit-cap regression test uses a contention-sensitive wall-clock threshold

**Evidence:** `test/clashtest/planning/planner.test.mjs:531-545`.

The test asserts completion under 500 ms as a proxy for bounded construction. During this review it failed at about 580 ms while another suite was running concurrently, then passed in isolation (about 138 ms for the named test; 277/277 for the normal P3 suite). The threshold does not prove the more important allocation invariant and is sensitive to host load.

**Minimum correction:** replace or supplement elapsed time with an instrumented production seam/counter that proves only `limit + 1` unit records and a bounded number of cell specs are produced. Keep timing as informational if useful.

## Confirmed sound areas

- Seeded exact-cover tests support the three-cell pair-space semantics in unordered and containment modes.
- The reviewed code keeps work units range-based and keeps Viewer / `collision/` dependencies outside `clashtest/planning`.
- Unit/range record admission and live split admission are atomic; the plan and ledger ceilings are enforced once records reach those admission paths.
- Per-root `cls`, root ownership, hierarchy-internal exclusion, target caps, over-cap target gaps, split weight conservation, and scope-expectation role handling have direct tests.
- The four High findings are implementation defects within P3. They do not expose an architectural impossibility or require reopening the frozen design.

## Verification performed

- `node --test test/clashtest/planning/*.test.mjs` → **277/277 pass** in the normal standalone run.
- `node --test test/clashtest/**/*.test.mjs` → **594/594 pass**.
- `node scripts/run-tests.mjs` in the restricted Work environment → **1,720 total / 1,716 pass / 3 fail / 1 todo**. All three failures are the known environment restriction in `test/performance/m4/spike-server.test.mjs` (`listen EPERM` on `0.0.0.0`); the todo is the pre-existing containment known gap. No product failure appeared outside those environment-bound tests.
- Direct decomposition probe: **500 models → 124,750 cells**, about **51 MiB observed heap growth** before a unit cap can run.
- Direct boundary probes reproduced duplicate unresolved acceptance and malformed whole-observation misclassification.
- `git diff --check` was clean before this review artifact/handoff update; the reviewed checkpoint started from a clean tree.

## Gate decision

P3 does **not** pass the independent checkpoint gate. H1–H4 must be adjudicated under `CLAUDE.md`; if confirmed, remediate only those findings plus directly affected invariants, rerun the focused and full P3 verification, and request a focused independent re-review. Do not start P4.

