# Bounded independent re-review — G2 ViewerBridge / DockingPanel procedure v2

- **Date:** 2026-09-30
- **Repository state reviewed:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd` (`origin/main` equal); documentation-only working tree described in `docs/handoffs/latest.md`; no G2 harness exists and no live G2 execution occurred.
- **Scope:** only the v2 remediations and their directly affected authorization, verdict, evidence, and acceptance cross-references.
- **Governing artifacts:** accepted Viewer Clash Panel design and implementation plan; G1 verified-`PARTIAL` closeout; the original independent G2 procedure review; both G2 internal review records.

## Verdict

**Not ready for owner acceptance or G2 harness-implementation authorization.** The v2 remediation closes the original scene-ownership contradiction, fail-first ordering defect, incomplete C17 oracle, model-B cleanup gap, C2 lookup ambiguity, and the associated scope/naming defects. Three High procedure defects remain blocking. One Medium control-construction defect and one Low documentation-consistency defect should be corrected in the same bounded edit.

**Findings:** 0 Critical / 3 High / 1 Medium / 1 Low.

No production, Core, Viewer Adapter, M4, Panel, server, OQ-1, or host change is required. All corrections belong to this procedure and its future test-only harness contract.

## High findings — blocking

### H1 — an authorization can be reused after a crash before `AUTH_BOUND`

- **Procedure:** §4.1, state table and Phase 0 ordering (lines 80–97).
- **Failure mode:** the authorization record is validated before several fallible operations, but `AUTH_BOUND` is not durably written until after git-tree and served-module-manifest checks. A process abort, harness throw, or failed evidence-writer setup in that interval leaves no journal. Startup therefore sees `NOT_STARTED` and permits the same authorization record again, while the procedure also says every Phase 0 failure requires a fresh owner record. The crash classification cannot help because it only classifies an existing `AUTH_BOUND` or `ATTEMPT_CONSUMED` journal.
- **Type:** procedure correctness / authorization-accounting defect.
- **Minimum correction:** durably create `AUTH_BOUND` immediately after deterministic interlock and authorization-record/digest validation, before any subsequent fallible preflight operation, then record any later preflight failure as `PREFLIGHT_FAILED`. Alternatively introduce and durably write an earlier bound state with the same startup-refusal semantics. Reconcile the state table, Phase 0 sequence, and crash proof.

### H2 — failure to persist the result can remain PASS-compatible

- **Procedure:** §4.1 evidence-write handling, §8 row 5, §10.
- **Failure mode:** after consumption, an evidence write may fail and the harness may still successfully append `COMPLETED` with `evidenceWriteFailed:true`. Section 8 row 5 fails only when a journal write prevents the terminal record; it does not make `evidenceWriteFailed` itself a FAIL predicate. A run with every C-check/control passing, clean cleanup, and a `COMPLETED` journal can therefore reach row 8 even though its authoritative result JSON was not durably written. That contradicts the retained-evidence contract and makes `COMPLETED` ambiguous.
- **Type:** procedure correctness / evidence-integrity defect.
- **Minimum correction:** make any required result/evidence write failure a row-5 FAIL predicate regardless of whether the journal reaches `COMPLETED`; persist that failure in the journal when possible, and define the final recomputation/write order so a successful terminal journal cannot make missing evidence PASS-compatible.

### H3 — v2 silently removes overlay rendering from the G2 acceptance gate

- **Procedure:** Table T row T17, D-C7r, D7, §13 limitation; governing design §16/PG-1 and implementation plan PG-1 live-check list.
- **Contradiction:** making arbitrary pixel/hue thresholds diagnostic-only is correct, but the procedure then allows all C1–C19 to PASS while declaring SVF2 overlay/marker rendering “not gate-evidenced by G2.” The accepted design and plan explicitly assign overlay-scene rendering on the SVF2 branch to PG-1/G2. Structural calls, scene ownership, and mesh counts do not prove that the overlay is rendered. Thus overall G2 PASS would overstate the governing gate.
- **Type:** verification gap plus unresolved acceptance-scope decision.
- **Minimum correction:** either (a) add a non-arbitrary, owner-accepted verdict-bearing rendering oracle, or (b) represent overlay rendering as required `NOT_EVIDENCED` so this procedure can end only `PARTIAL` until separately evidenced, or (c) obtain an explicit owner amendment that defers this PG-1 item. Do not give T17's arbitrary thresholds verdict power without separate calibration.

## Medium finding

### M1 — N6's mandatory gross-deficit case is not realizable for every selected box

- **Procedure:** §7 N6(ii) and T15.
- **Failure mode:** `bMax_x := rMax_x - 2*T_x` is defined while `T_x` itself is recomputed from the mutated box. No fixed-point construction is specified for case (ii), and a zero/thin x extent can make the mutated box invalid (`bMin_x > bMax_x`). Yet case (ii) is forbidden from becoming `NOT_APPLICABLE`. The control can therefore fail because of target geometry or an underspecified construction rather than because the C4 oracle failed to detect non-containment.
- **Type:** executable-control defect; fail-closed, so it does not create a false PASS.
- **Minimum correction:** deterministically choose an axis/face with sufficient usable extent, falling back across axes, and construct a valid finite box with an independently chosen deficit; then recompute and assert `d > T`. If no axis can support the construction, define a separate fail-closed fixture-insufficiency outcome rather than an impossible mandatory subcase.

## Low finding

### L1 — Table T is not literally exhaustive for D-C7r's numeric sampling

The diagnostic says to take two consecutive off/on observations and permits one retake, but those numeric counts are absent from Table T even though §4.7 calls it the frozen table of every proposed threshold. They are diagnostic-only and cannot change the verdict, so this does not block safety. Add a diagnostic/AP row or narrow Table T's exhaustiveness claim.

## Bounded remediation verification

| Area | Result | Independent basis |
|---|---|---|
| Journal input and identity binding | **Partially closed; H1 remains** | explicit non-symlink `docs/prompts` input, exact markers/digests, candidate/supersession rules and durable monotonic journal are specified; the first durable binding occurs too late |
| Fail-first verdict | **Closed for check/control/cleanup precedence; H2 remains for evidence writes** | rows 1–5 precede unavailable evidence; X1–X8 correctly preserve FAIL; `sessionTainted` cannot PASS |
| C4 oracle | **Closed** | full recursive fragment-union reference and componentwise containment rule are executable and do not import G1 F7 conclusions |
| N6 sensitivity control | **Not fully closed — M1** | relative-to-reference construction fixed the earlier false premise, but the mandatory gross case is not total over valid targets |
| C7/C18 scene ownership | **Closed** | bridge-created Panel scenes must be absent; pre-existing/foreign scenes and sentinels must survive; cleanup later removes harness-owned foreign fixtures |
| C17 / N7 | **Closed** | V0–V7 define exact action/order/outcome/residue assertions; N7 proves the loaded-B predicates discriminate |
| Model-B cleanup | **Closed** | A and B have separate guarded, bounded unload steps and final empty-model-set verification |
| C2 title lookup | **Closed** | prototype spy captures the exact title node passed by the real base-class path; no class-name fallback remains |
| Scope/dependencies | **Closed** | checks remain at ViewerBridge/DockingPanel boundary; G3, H1/H2, OQ-1, host integration and production changes remain excluded |

## Actual API cross-check

- `ViewerBridge` is the only reviewed mutating layer and its public `present`, `clear`, `dispose`, listener, ledger, isolation, fit, and overlay behavior support C7/C14–C19 without inventing a production API.
- `createMarkerSet` tracks whether it created a scene, removes only its own meshes, and removes only self-created empty scenes. The v2 Panel-owned/foreign-scene oracle matches that implementation.
- `ClashDockingPanel.createPanelShell` constructs the subclass and relies on the base DockingPanel lifecycle; spying on `DockingPanel.prototype.createTitleBar` is a realizable way to capture the actual node.
- No Viewer Adapter/Core API is needed by the procedure. The procedure correctly treats live Viewer event/order/rendering behavior as evidence to obtain, not as already proven fact.

## D1–D7 adjudication

| ID | Classification | Recommended disposition |
|---|---|---|
| D1 | owner operational fixture decision | Approve Mechanical + Structure after the procedure blockers are corrected; Structure adds the second-model aggregate surface and no new production dependency. |
| D2 | owner acceptance-policy decision | Defer approval until H1–H3 are corrected; then adopt the fail-first rows. The current core precedence is sound, but evidence-write failure and rendering completeness are not. |
| D3 | technical scope disposition | Adopt: do not seed foreign theming; prove zero Panel theming calls. Foreign-theming preservation remains outside claims. |
| D4 | owner execution-risk decision | Require explicit approval after harness implementation review; permit only the bounded, restored/tainted C15 injections. |
| D5 | technical scope disposition | Adopt: C17/C19 remain bridge-boundary checks and do not become G3 workflow or OQ-1 identity tests. |
| D6 | deferred product/integration decision | Keep OD-12 coexistence deferred; G2 exercises only the accepted isolation guard and loads no other extension. |
| D7 | mixed technical/calibration/acceptance disposition | Freeze the technically corrected table and keep AP thresholds diagnostic-only, but resolve H3 explicitly: rendering must remain `NOT_EVIDENCED`/PARTIAL or be covered by an owner-accepted gate. |

## Authorization result

- **Procedure readiness:** not ready for owner acceptance or harness-implementation authorization.
- **Required next action:** one bounded documentation-only remediation of H1–H3, M1, and L1, followed by a targeted independent re-review.
- **Owner decisions after remediation:** D1, corrected D2, D4, and the H3/D7 rendering-gate disposition. D3 and D5 are technical; D6 remains deferred.
- **Dependencies:** no production/Core/Viewer Adapter/M4/Panel/server/OQ-1/host dependency appeared.
- **Still unauthorized:** procedure edits until separately authorized; G2 harness implementation; any G2 live execution; G3; H1/H2; OQ-1; host integration; G1-F7 probe/calibration; production changes; commit; push.
