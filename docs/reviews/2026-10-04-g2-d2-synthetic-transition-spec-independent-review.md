# G2 D2 Synthetic-Transition Specification — Independent Review

**Verdict:** requires bounded specification correction before checkpointing or D2-OFFLINE authorization.

**Findings:** 1 Critical / 5 High / 5 Medium / 0 Low.

The source-supported core is sound: one shared pending slot, last-writer-wins replacement, active-versus-pending separation, tick-gated consumption, zero-motion step 0, completion-before-next-consumption gap, frozen T4's lack of request identity, historical/synthetic separation, and bounded evidence outputs. The remaining defects are in causal ordering, restore/autocam synchronization, oracle independence, classifier/outcome contracts, T4 equivalence, and geometry-separation mechanics. They can change the result rather than merely its presentation.

## Verified repository state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `dee0850b1fbcf23ff8762cf614b4cb4ca88b2836`; `origin/main` matches.
- Harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`. Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- Pinned Viewer bundle SHA-256 was independently rechecked as `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`.
- The immutable evidence directory still contains the same 11 files (including `MANIFEST.md`). Historical G2 remains `FAIL (row 3)`; C6 remains `NOT_EVIDENCED`; C8 remains unresolved; T4 is unchanged. No live retry, new authorization record, attempt reset, simulator, or harness/test/product/procedure implementation change was found.

## Findings

### Critical C1 — closed-loop schedules violate their own causal boundary

**Sections:** §5.2 “Frame micro-order” and “Settle loops”; §7 CL mode.

All external events for frame `f` run before phases `H/A/T`. In CL mode, however, request N is issued at `f1 + δ`, where `f1` is the frame in which the prior settle returns. For `δ=0`, the model inserts N in the external-event slot **before** the `H` sample that determines `f1`. The real harness cannot issue N before its awaited settle has returned: P6 performs `await settle()` and only then continues to reset/fit or the next check. Thus half of the declared CL `δ` schedules causally issue work before the condition authorizing it exists.

This can overwrite or hold a pending request earlier than the harness can, changing PRE/GAP/RST reachability and the CL verdict—the central D2 question. Calling these schedules “harness-faithful” is therefore false.

**Minimum correction:** define post-phase continuation slots. A CL `δ=0` issue must occur after the deciding `H` callback/microtask continuation, with its legal order relative to later Viewer callbacks explicitly represented. Enumerate only causally legal placements, specify rAF-callback eligibility for callbacks scheduled during the frame, and recompute the schedule count and deterministic tuple order.

### High H1 — restore/autocam resynchronization is assigned to an unsupported phase

**Sections:** §4 S8–S9; §5 `tick`; §5.2 skipped-tick lifecycle; §5.1 restore variants.

The pinned implementation shows that immediate restore writes the Viewer camera and `impl.syncCamera(true)` marks the camera updated. Autocam resynchronizes through the `cameraChanged` listener, whose event is dispatched from the render path when the camera-changed signal is observed. The spec instead performs `autocamState := cameraState` at the start of **every model tick**, including active-transition ticks. D0 explicitly left this restore/next-step interaction untraced.

That invented placement can change the source pose used by the next autocam step and therefore the RST mechanism. The restore model also lacks an exception branch even though D0 retained exceptions as possible outside the valid no-throw path.

**Minimum correction:** model camera-change dispatch/autocam synchronization as its own finite, ordered event/phase (or explicitly enumerated unknown branches) rather than as an unconditional tick action. Keep valid OK, false/NOOP, and THROW/aborted-run behavior distinct. Do not claim a particular intermediate overwrite sequence beyond the pinned final-destination behavior.

### High H2 — the request-tagged oracle is self-referential and does not define the observed camera

**Sections:** §5 `completedLedger`; §6.2; §8.4; §12 Outcome C.

`O_tag` reads the simulator's internal request id at the same completion that populates `completedLedger`, then is “validated” by requiring it to agree with that ledger. This is not an independent validation path. The spec also does not define which camera is sampled when the tagged delivery is received, especially for latency `e=1`, when a restore, later fit, or transition step may have changed the camera after N completed.

Consequently the claim that request-tagged completion “would cure” a stale T4 observation is not mechanically established. Event identity alone does not prove that the later sampled camera still belongs to N.

**Minimum correction:** specify an oracle receiver with independent issue/consume/complete token flow, delivery ordering, and a camera snapshot/ownership rule at delivery. Validate it against a separately derived transition trace, including overwrite, restore, and `e=1` cases. Oracle generation and oracle validation must not use the same ledger entry as both expected and actual value.

### High H3 — classifier and outcome names are inconsistent, and the CL/OP verdict cannot represent the stated result

**Sections:** §7.4; §8.1–8.2; §12.

The classifier emits primary classes `RST`, `GAP`, `PRE`, `MID`, and `UNCLASSIFIED-STALE`, but falsifiability and outcomes test undefined names `STALE-PRE/GAP/RST`, `STALE-MID`, and `STALE-*`. A conforming implementation cannot know whether to transform names or which values enter A/B/C.

Separately, §8.1 says OP-only stale schedules mean “Outcome B for the harness, A for a more aggressive caller,” while §12 defines one scheduling outcome where any stale schedule forces A. One global A/B value cannot represent OP=A and CL=B. Finally, oracle-validation failure is both H5 “support” and Outcome C model defect; a defective oracle cannot support a Viewer-state hypothesis.

**Minimum correction:** define one canonical enum and use it everywhere. Report independent scoped scheduling outcomes for CL and OP (plus an explicitly defined combined summary if desired). Treat oracle/conformance failures only as model-invalid C, not as H5 support. Limit H5 support to validly classified behavior outside the named PRE/GAP/RST mechanisms.

### High H4 — symbolic pose identity is not an exact model of frozen T4

**Sections:** §4 A1/A3; §5 pose algebra; §6.1; §9.3.

T4 compares 32 numeric matrix entries with absolute tolerance `1e-9`; it does not compare semantic camera/request labels. The spec replaces that observable with label identity and then calls T4 “modelled exactly.” Distinct destinations or `H` versus `R(h)` can be semantically distinct while producing equal 32-entry samples—for example, navigation target/pivot changes along the view ray are invisible to T4. Conversely, two labels intended to represent the captured home and a successful restore of that same home should be equal at T4's observable surface, but label identity does not define that equivalence.

A2 handles only active-step magnitudes; it does not repair the general label-to-sample mismatch.

**Minimum correction:** define a normative 32-entry sample (or a formally defined T4-equivalence class) for every pose and make `cameraSamplesWithin` the equality relation. State A3 at the observable-sample level where needed. Make captured home and successful restore agree unless a separately enumerated branch changes an observable matrix component.

### High H5 — the control-separation gap has two conflicting normative definitions

**Section:** §11.5.

The opening paragraph defines order-independent `g(c1,c2) = max(min_c1 − max_c2, min_c2 − max_c1)`. Step 2 then redefines `g = min_c1 − max_c2` as signed. Depending on pair order, the same disjoint distributions can therefore pass or fail the 3× criterion. This prevents deterministic D/E classification and means the internal geometry/oracle correction is incomplete.

**Minimum correction:** choose one orientation-independent interval-separation formula, define overlap/touching behavior, and specify what candidate quantity is reported when separation is stable. Keep the 3× factor and `d_min` exploratory unless separately accepted by the owner.

### Medium M1 — the no-tail-stall assumption is too strong for the primary claim

**Sections:** §4 A2; §7.2; §8.2.

The pinned interpolation is time-based and source does not establish that every non-final step changes a retained matrix entry by more than `1e-9`. Excluding sub-epsilon repeats removes a direct way current T4 could settle before formal completion. Conditional reporting is honest, but a primary D2 run without a bounded sensitivity branch biases the study against MID settlement.

**Disposition:** require a bounded sensitivity dimension/run with at least `>epsilon`, `<=epsilon for one adjacent pair`, and a short bounded tail-stall case. Keep A2 as the primary simplification only if results are reported separately and no unconditional B is emitted from A2-only evidence.

### Medium M2 — omitting `D=1` leaves out the shortest source-plausible completion

**Sections:** §4 A4; §5.2; §7; §16 decision 2.

Under the corrected progress semantics, `D=1` means step 0 followed by the first active rAF callback reaching the destination and completing. A sufficiently large callback delta can make this source-plausible. The current set starts at 2 without rationale.

**Disposition:** add `D=1` to the exhaustive synthetic domain, retain `2,3,4,6,10`, and retain D=30 as a characterization witness. Recompute all cardinalities. These remain frame-scaled synthetic durations, not historical milliseconds.

### Medium M3 — the 64-frame timeout is a scaled assumption, not exact T4

**Sections:** §5 state domains; §6.1; §14.

Real T4 uses a 5000 ms deadline, so the number of samples depends on frame cadence. D2 uses 64 frames while claiming exact T4 modeling. This is a reasonable bounded research budget but not an exact timeout model.

**Disposition:** label it as a separate scaling assumption, retain elapsed-time or cadence scenarios if timeout conclusions matter, and ensure a timeout-derived outcome is never generalized to the live 5000 ms contract.

### Medium M4 — state domains stop at 63 while shadow execution continues to 127

**Sections:** §5 state-variable table; §5.2 shadow simulation; §14.

`frameIndex` and `tickIndex` are declared `0..63`, but the same machine continues through frame 127 for oracle delivery. This is an internal domain contradiction.

**Disposition:** define simulation counters through 127 and separately cap T4 samples/decision at frames 0..63.

### Medium M5 — `M=0.9` is an observed anchor, not a verified fit margin

**Sections:** §9.1–9.2; §10.

D0/D1 explicitly found that 0.9 was read from the N2 sample and was not independently derived from pinned `computeFit`. D2 calls it a “retained-derived fit margin,” then uses it as the fit equation's baseline. The synthetic use is acceptable, but the label risks promoting a self-referential observation into Viewer behavior.

**Disposition:** label 0.9 as a synthetic calibration anchor derived from the retained N2-like sample, not a verified Viewer fit margin. Continue varying it and do not use RET-U self-consistency as independent validation of the fit algorithm.

## Requested technical verdicts

### State machine, pending slot, and transition length

- **State-machine fidelity:** not yet accepted because C1 and H1 alter causal behavior. No unsupported queue is present.
- **Pending-slot semantics:** accepted. One shared slot, overwrite-in-place, hold while active, and consumption only while inactive match the pinned source.
- **Transition-length correction:** the progress counter and `D=2` example close the original off-by-one inside the abstraction: zero-motion step 0, `M(k,1..D−1)`, then final destination/completion at progress D. M2 still requires the valid `D=1` boundary.
- **Same-frame ordering:** not accepted; the phase permutation is explicit, but CL `δ=0` violates causality and restore/autocam synchronization is assigned to the wrong phase.
- **Restore branches:** partially accepted. Non-cancellation and final destination are source-supported; intermediate resync ordering and THROW handling require correction.

### T4 and oracle

- **T4 fidelity:** the frozen harness facts are correctly quoted—32 entries, `1e-9`, first equal adjacent pair, one rAF wait per sample, no transition/request input—but the symbolic equality and 64-frame timeout prevent the simulator from being called exact.
- **Request-tagged completion:** correctly labelled idealized and unavailable publicly, but its validation and camera-at-delivery semantics are not independent or complete.
- **H2 falsifiability:** conceptually valid after C1/H3/H4 correction; current CL schedules and enums cannot support a reliable verdict.
- **H5 falsifiability:** not accepted as written because oracle/model defects are conflated with evidence for other async state.

### Schedule space and synthetic geometry

- **Count:** the declared arithmetic is correct for the current domains: F0 180 + F1-OP 1,800 + F2-OP 10,800 + F1-CL 360 + F2-CL 1,440 = **14,580**; witnesses = **36**. The count is not acceptance-worthy because C1/M2 require domain changes.
- **Historical/synthetic boundary:** generally strong; U/A:104 and retained scalars are identified, missing geometry/timing is synthetic. M5 is the one required wording correction.
- **Class disjointness:** the scheduling predicates now have precedence and mechanism labels. `P_C6` and `L_N2stale` intentionally share a camera but are role-distinct and are not compared as opposing classes; that is acceptable if retained explicitly. Enum inconsistency in H3 remains blocking.
- **Geometry specification:** coordinates, normalization, boxes, fit projection, variation grid, and 7,200-evaluation count are reproducible; no unavailable B:111/A:135 geometry is smuggled in.
- **Margin derivation:** no final margin is selected, which is correct. H5's formula contradiction must be fixed; 3× and `d_min` remain exploratory reporting criteria pending owner disposition.

### Outcomes, bounds, and reproducibility

- **Oracle validation:** not accepted; see H2.
- **Outcome matrix:** independent scheduling and control axes are appropriate, but H3 prevents deterministic CL/OP and H5 classification.
- **Output-size bounds:** accepted. Schedule/frame/sample caps, bounded witness selection, summary/raw/total byte ceilings, and fail-on-overflow prevent runaway artifacts while retaining useful witnesses.
- **Reproducibility:** largely accepted—pure ESM, no network/browser/Viewer, no randomness/time-derived results, canonical JSON, input hashes, deterministic order, and two-run byte comparison. Exact implementation filenames may be selected at authorization, but the blocking semantic corrections must land first.

## Internal-review remediation assessment

- **Closed:** transition off-by-one within D≥2; witness count/sentinels; digest self-inclusion and companion traces; explicit F0 subject; destination abstraction scope; bounded geometry equations; evidence caps.
- **Not fully closed:** same-frame ordering (C1); oracle validation (H2); classifier/outcome consistency (H3); geometry D/E oracle (H5); consume/resync ordering (H1).
- **No additional D0/D1 live evidence is required** to repair these specification defects. They are bounded spec corrections plus owner decisions.

## Owner-decision recommendations

1. **D2-OFFLINE:** do not authorize yet. First correct C1/H1–H5 and re-review the bounded changes.
2. **Durations:** use `{1,2,3,4,6,10}` exhaustively plus D=30 characterization; label all as scaled frames, not milliseconds.
3. **Tail stall:** require a bounded sensitivity run. A2 may remain as one primary branch but cannot support an unconditional absence claim.
4. **3× and `d_min`:** keep both exploratory. Collect distributions first; do not adopt either as a C6 policy, acceptance threshold, or final margin.
5. **Simulator location:** use `docs/research/2026-10-04-g2-d2-synthetic-transition/` with pure-ESM simulator, colocated offline tests/fixtures, and temporary outputs by default. Checkpoint outputs under `docs/research/evidence/` only under a later explicit evidence authorization.
6. **Undocumented Viewer observables:** acceptable as version/hash-bound inputs to the offline source model; permitted in later diagnostic instrumentation only under a separate authorization with drift/fail-closed handling; not a production or acceptance dependency without an explicit owner decision and procedure re-acceptance.

## Readiness

- **D2 spec checkpoint:** not ready to commit/push. It needs one bounded specification correction covering C1, H1–H5, and the directly affected Mediums.
- **D2-OFFLINE:** not ready for implementation authorization.
- **Exact next action:** owner authorization for a bounded documentation-only remediation of this review, followed by a targeted independent re-review. Do not implement the simulator, alter T4/C6/C8, run Viewer/browser/live G2, issue a record, reset the attempt, or commit/push yet.
