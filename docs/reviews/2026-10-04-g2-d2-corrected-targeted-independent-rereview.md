# G2 D2 Corrected Synthetic-Transition Specification — Targeted Independent Re-review

**Verdict:** the corrected D2 specification is ready for checkpoint commit/push. After that clean checkpoint, the owner may separately authorize **D2-OFFLINE synthetic simulator implementation only**.

**Findings:** 0 Critical / 0 High / 0 Medium / 3 Low.

The original independent-review findings (1 Critical / 5 High / 5 Medium) and the subsequently recorded internal-review corrections are closed at the specification's intended abstraction level. The three remaining Lows are bounded precision/implementation-contract items; they do not change the state-machine architecture, the outcome model, or the historical/synthetic boundary.

## Verified repository boundary

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `dee0850b1fbcf23ff8762cf614b4cb4ca88b2836`; `origin/main` matches.
- Working tree at review start: tracked modification only to `docs/handoffs/latest.md`, plus the documented untracked prompt/review/spec artifacts. No implementation file is modified.
- Harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.
- Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- Pinned Viewer 7.124.2 decoded bundle SHA-256 rechecked: `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`.
- The immutable evidence directory is unmodified. Its retained R2 still records `FAIL (row 3)`; R1 still records C6 `NOT_EVIDENCED(n2-not-discriminating)`, C8 `FAIL(element-outside-frustum)`, and fit-pair distance `263.8571494974672`.
- No simulator directory or D2-OFFLINE implementation exists. No live retry, new authorization record, attempt reset, T4/C6/C8 change, or harness/test/product/procedure implementation change was found.

The codebase-memory graph was used to verify `cameraSamplesWithin`, `waitForCameraSettle`, `g2CreateCameraAdapter`, P6, `evaluateC6`, and `evaluateC8`, followed by direct source checks. Coverage reported no recorded issue for every relied-on in-repository file; the pinned Viewer bundle was read directly because it is external to the repository graph.

## Findings

### Low L1 — the normative THROW example is one synthetic frame late

**Section:** §5.2, “Normative abort example.”

For the stated tuple `D=4, S=0, ORD=HAT, G=0`, §5.2's own activation rule makes settle(N−1) sample at `H` of frame 0, after which `T` consumes request 1. The second unchanged sample is therefore at `H` of frame 1, so the settle returns and `restore(THROW)` runs in frame-1 `H+`, not frame 2. Request 1 still completes at frame 4, and the example's intended THROW/shadow-execution conclusion is unchanged.

**Disposition:** non-blocking wording/example correction. The future simulator tests should derive the expected frame from the normative transition rules instead of copying the example's frame number.

### Low L2 — the 128-byte trace-row bound requires an explicit compact encoding

**Section:** §14.

The trace schema and field semantics are defined, but field encodings and maximum string/array lengths are not. A verbose but schema-conforming JSON row can exceed 128 bytes. The higher-level 2.5 MiB raw-witness and 3.5 MiB total limits still fail closed, so this cannot create unbounded output or silent truncation.

**Disposition:** implementation-plan requirement, not a spec-correctness blocker. D2-OFFLINE must use bounded enum/integer encodings or assert the actual canonical row byte length and fail closed. If compact encoding cannot meet 128 bytes, update the documented arithmetic before accepting simulator evidence; do not silently drop a required witness.

### Low L3 — the cross-runtime reproducibility sentence is imprecise

**Section:** §15, “Runtime.”

“Results must be byte-identical on both” does not name two concrete runtimes: the repository contract is Node `>=20`, while only Node `v22.23.1` is the observed baseline. The deterministic two-run check on one pinned runtime is otherwise complete.

**Disposition:** implementation/authorization precision item. The D2-OFFLINE authorization should pin the execution runtime(s). Cross-version byte identity should be claimed only for explicitly run versions.

## Targeted correction verdicts

### Causality, restore, and ownership

- **δ=0 causal order — accepted.** A CL continuation occurs only in `H+` after the deciding `H`; δ=1 is the next frame's external step. V0 is an acyclic, mechanically checkable slot-order assertion. No request is issued before the observation that enables it.
- **Restore/autocam — accepted as a bounded model.** Restore leaves the pending slot, active transition, transition flag, autocam state, and completion ledgers untouched. Camera-change dispatch is separated into `R`; `OK-SAME` and `OK-NEXT` explicitly enumerate the unresolved source timing. The result is scoped synthetic/source-model evidence, not a claim that the source guarantees only those two timings. Simulator output must retain the chosen branch.
- **Ownership oracle — accepted.** Request tokens flow slot → active → terminal, while ownership tags are written at camera-write sites. Delivery snapshots the current owner and numeric camera independently of the candidate T4 verdict. Restore, overwrite, pending, in-flight, and delayed-delivery branches remain distinguishable.

### T4 and outcomes

- **Classifier/outcomes — accepted.** The first-match decision list is mutually exclusive and exhaustive over the declared owner states. `C1-INVALID` (exit 2) is reserved for conformance/model defects; `C2-INCONCLUSIVE` (exit 0) is a completed study with missing decision evidence. A/B are cell-scoped, D/E are a separate geometry-control axis, and no global CL/OP verdict collapses contradictory cells.
- **T4 numeric fidelity — accepted within the declared synthetic pose map.** All 32 actual T4 fields are materialized; comparison is elementwise absolute `1e-9`; the first equal adjacent pair settles; `prev` is per invocation; activation and first-sample timing are explicit. The real 5000 ms deadline is not falsely equated to the 64-sample research budget.
- **C1/C2 reporting — accepted.** Invalid schedules cannot support H2/H5. Inconclusive schedules are preserved as an explicit outcome rather than converted to B. The summary schema carries cell outcomes and per-cell hypothesis verdicts.

### Transition domains and enumeration

- **D semantics — accepted.** Step 0 is synchronous and zero-motion; `D` counts later A-steps including the terminal snap. D=1 is valid. D=30 is exactly 36 characterization schedules and does not enter exhaustive cells or conclusions.
- **Tail stall — accepted.** `L={0,1,2}` is finite, separate from the primary branch, and uses a nonzero sub-epsilon increment whose mapped sample delta remains within `1e-9`. It is adequate for the stated bounded sensitivity purpose; broader tail shapes remain explicitly outside exhaustiveness.
- **Timeout/counters — accepted.** The decision budget is exactly 64 processed samples with no 65th sample; shadow execution is separately capped at frame 127. Counter domains, initialization, updates, resets, and classification roles are defined sufficiently for implementation.
- **Schedule count — accepted.** Independent recomputation produced 13 valid `(D,L)` pairs and the exact cells: CL-primary 4,104; CL-tail 4,788; OP-primary 18,144; OP-tail 25,272; total **52,308**. The 36 D=30 characterization schedules are separate. Enumeration keys and sentinels make ordering deterministic.
- **THROW — accepted, subject to L1.** THROW terminates harness actions, yields `HARNESS_ABORT`, and leaves the Viewer shadow machine running only for token invariants. It cannot produce a stale or owned subject verdict, and retained traces remain bounded.
- **Settle activation — accepted.** Activation is synchronous after the corresponding fit, absent after abort, and handles external-step versus `H+` registration without sampling before activation.

### Geometry, evidence, and reproducibility

- **Separation formulas — accepted.** One orientation-independent interval separation is used. Touching/overlap is non-separated. `d_min` and `3×` are exploratory observations; `κ=0.9` is consistently a synthetic calibration anchor, not a Viewer margin or acceptance threshold.
- **Geometry exactness — accepted as synthetic geometry.** Coordinates, axes, normalization, aspect, offsets, perturbation signs, boxes, classes, and 7,200 evaluations are specified. `263.8571494974672` is loaded exactly from retained R1 and used as a synthetic grid coordinate; the spec does not claim the fabricated A/B boxes reconstruct the unavailable historical A:135/B:111 geometry.
- **Runtime hashes — accepted with an implementation detail.** The spec, harness, R1, and fixtures are the mandatory byte inputs. Harness and R1 expected digests have repository sources; spec and fixture digests are pinned by the future D2-OFFLINE authorization. Mismatch is `C1-INVALID`/exit 2 and does not rewrite historical evidence. The implementation must perform these checks before enumeration and make the authorization-pinned values explicit inputs/constants.
- **Diagnostic witnesses/output caps — accepted with L2.** Witness selection and count are deterministic; invalid/inconclusive paths retain bounded first witnesses; count mismatch carries no fabricated trace. Total output fails closed rather than truncating silently.
- **Historical/synthetic boundary — accepted.** Retained U, A:104, camera/frustum values, and scalar outcomes are separated from synthetic A:135/B:111 boxes, home/destination poses, phase order, durations, delays, and tail stalls. No historical causality is claimed.
- **Reproducibility — accepted with L3.** Pure ESM, no dependency/network/browser/Viewer, deterministic schedule IDs/order, no randomness/wall clock in output, canonical JSON, companion digest, command shape, and two-run byte comparison are sufficient for D2-OFFLINE planning.

## Original and internal-review finding closure

- **Original Critical C1:** closed by `H+`, δ slot definitions, and V0.
- **Original High H1–H5:** closed by the explicit restore-sync phase/THROW branches; independent token/ownership flows; one classifier/outcome model; numeric 32-entry T4 samples; and one separation formula.
- **Original Medium M1–M5:** closed by the bounded tail branch, D=1, scaled-time labelling, complete counter ranges, and κ relabelling.
- **Internal N1–N8/Q3:** substantively closed: THROW shadow semantics, settle activation, C1/C2 split, 64-sample boundary, per-settle `prev`, runtime hashes, exact retained constant/perturbation equations, bounded diagnostics, and explicit H2/H5 verdict fields. L1 corrects only the worked example's frame number.

No additional D0/D1 or live evidence is needed before D2-OFFLINE implementation. D2-OFFLINE results remain synthetic research and cannot reopen or reinterpret the historical G2 attempt by themselves.

## Owner-decision recommendations

| Item | Recommendation | Reason |
|---|---|---|
| D2 spec checkpoint | **Accept for commit/push** | No Critical/High/Medium specification blocker remains; L1–L3 are bounded and dispositioned. |
| D2-OFFLINE | **May be separately authorized after the clean checkpoint** | The simulator contract is finite, deterministic, and offline; implementation does not require harness/product/procedure changes. |
| Durations | Accept `{1,2,3,4,6,10}` exhaustive + D=30 characterization | Covers the shortest transition and a bounded scaled range without presenting frames as milliseconds. |
| Tail branch | Accept `L={0,1,2}`, `τ=1e-10` for this study | Adequate bounded sensitivity; broader tails remain a stated non-goal. |
| `3×` / `d_min` | Keep exploratory | They describe synthetic separability and must not become C6/T4 thresholds without a later decision. |
| Location | Accept `docs/research/2026-10-04-g2-d2-synthetic-transition/` | Keeps non-production research code and tests together. |
| Undocumented Viewer observables | Accept the proposed three-part policy | Version/hash-bound offline inputs and separately authorized diagnostics are acceptable; production/acceptance use requires procedure re-acceptance. |

## D2-OFFLINE authorization boundary

If separately authorized after the checkpoint, the bounded scope is:

1. Add only a deterministic pure-ESM simulator, fixtures, and offline tests under `docs/research/2026-10-04-g2-d2-synthetic-transition/`.
2. Read and hash the specification, current harness, retained R1, and fixtures; perform no mutation of those inputs.
3. Produce temporary deterministic summary/witness outputs within §14 caps; do not checkpoint outputs under `docs/research/evidence/` without separate evidence authorization.
4. Do not modify the G2 harness/tests, Viewer Clash Panel production code, accepted procedure, T4/C6/C8/N2, Viewer/Core/Adapter/M4, or historical evidence.
5. Do not open a browser, load Viewer/models, run live G2, issue an authorization record, reset the spent attempt, or begin G3/H1/H2/OQ-1/host integration.

**Exact recommended next authorized action:** authorize one documentation-only D2 specification checkpoint commit/push containing the corrected spec, its review records, prompts, and updated handoff. After the clean pushed checkpoint is independently verified, the owner may issue a separate authorization for the bounded D2-OFFLINE scope above.
