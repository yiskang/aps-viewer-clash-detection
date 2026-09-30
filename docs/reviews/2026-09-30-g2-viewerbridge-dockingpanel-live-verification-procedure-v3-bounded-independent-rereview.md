# Bounded independent re-review — G2 ViewerBridge / DockingPanel procedure v3

- **Date:** 2026-09-30
- **Repository state:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd`; `origin/main` equal; documentation-only uncommitted working tree; no G2 harness and no live G2 execution.
- **Scope:** v3 H1–H3, M1, L1 remediation and directly affected authorization, verdict, evidence, PG-1, control and owner-decision cross-references only.
- **Sources:** v3 procedure; v3 remediation internal review; prior independent G2 reviews; current handoff; accepted Viewer Clash Panel design and implementation plan; actual `ViewerBridge`, marker and DockingPanel implementation where relevant.

## Verdict

**Not ready for owner acceptance or G2 harness-implementation authorization.** C20/N8, N6 and the exact repetition table are materially converged, and the prior Viewer ownership/scope closures remain intact. Three High closeout/durability defects remain. One Medium cross-section inconsistency and one Low boundary-test gap should be corrected with them.

**Findings:** 0 Critical / 3 High / 1 Medium / 1 Low.

No production, Core, Viewer Adapter, M4, Panel, server, OQ-1 or host dependency appeared. Every required correction is confined to this procedure and its future test-only harness contract.

## High findings — blocking

### H1 — first-creation durability does not cover the attempts directory entry

- **Procedure:** §4.1 W2 and durability algorithm, lines 93–109.
- **Failure mode:** W2 creates `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/` if absent, then fsyncs the reservation file and that new directory. It never fsyncs the new directory's parent after `mkdir`. On local POSIX filesystems, syncing the new directory makes its contents durable but does not itself make the parent's directory entry for the newly created directory durable. A crash can therefore lose the directory together with the supposedly durable reservation, allowing the same authorization to appear unused. The current “normal OS crash on local POSIX” claim is too broad for that path.
- **Related classification gap:** a crash after the exclusive reservation exists but before a complete journal exists is fail-closed at startup, but §4.1 defines inferred `CRASHED` only from a journal's last state. A reservation-only/empty-reservation state is therefore spent but not assigned a mechanically reviewable inferred state.
- **Minimum correction:** when the attempts directory is newly created, fsync its parent directory before treating reservation durability as established; retain the reservation-file and attempts-directory fsyncs. Define reservation-only, truncated-reservation, journal-absent and orphan-journal-temp combinations explicitly in `classifyJournal`/the state table (for example `CRASHED(reservation-only)`), and include them in the offline crash matrix. Also make W1's prose explicitly scan reservations as its startup rule already requires.

### H2 — R1's declared closeout schema is self-referential and contains future facts

- **Procedure:** §9.1 steps 4–6 and §10 top-level `closeout.requiredArtifacts` schema.
- **Failure mode:** R1 is serialized and verified before R2 is written and before the terminal journal transition. Yet R1's declared `requiredArtifacts:[{name,path,sha256,verified}]` includes R1 itself and the later required artifacts, while `closeoutFailures[]` can also acquire failures after R1 is immutable. R1 cannot contain its own final SHA-256 without an undefined self-hash convention, and it cannot truthfully contain the later R2/R3 verification outcomes or later closeout failures. Rewriting R1 would change its hash and invalidate the journal binding.
- **Minimum correction:** make R1 explicitly a pre-closeout result whose closeout fields contain only facts known before its serialization; remove its own/future hashes and final verification claims. Put the completed artifact manifest and final closeout outcome in the terminal journal or a separate required manifest written after R1/R2 and bound by the journal. Specify nullable/pending fields if retained, and make schema validation phase-aware.

### H3 — an ambiguous `COMPLETED` verification can lose the only durable FAIL witness

- **Procedure:** §8 authoritative-verdict rule and §9.1 corner rule.
- **Failure mode:** when the `COMPLETED` write returns an error or read-back verification fails, the journal may nevertheless contain a valid `COMPLETED`. The harness then records FAIL only on stdout and best-effort in the closeout-failure addendum. Raw stdout/log is explicitly optional, and the addendum may also fail. A later reader can therefore see valid `COMPLETED` plus matching R1/R2 hashes, find no durable recorded harness-final FAIL, and accept PASS. The “worse-of” rule cannot compare evidence that was never durably retained.
- **Minimum correction:** define one durable, non-self-referential completion protocol whose reader result is decisive. Either add a required completion/failure witness that cannot be omitted in this corner, or define a valid later-read terminal commit as success rather than simultaneously calling the same durable state a harness FAIL. Do not rely on optional stdout/O1 or a best-effort addendum for verdict precedence. Add the exact ambiguous-write/read-back cases to the closeout matrix.

## Medium finding

### New Medium — Table T2's global CA rule contradicts the retained C4 containment rule

- **Procedure:** §4.7 rule (a), T15 and C4.
- **Contradiction:** rule (a) says no rendering **or containment** FAIL predicate depends on a CA value, but T15 classifies `grossRelative = 2^-10` and the simplified scale as CA, and C4 returns FAIL when a deficit exceeds `T_a = grossRelative·S_a`. The individual C20 rule is safe—its CA values grant PASS or yield `NOT_EVIDENCED`—but the newly stated global rule is false for the retained C4 contract.
- **Minimum correction:** scope rule (a) specifically to C20/rendering, or explicitly document the already accepted C4 exception and its evidence envelope. Do not silently reclassify C4's calibration assumption as contract-derived.

## Low finding

### New Low — N6's property-test boundary list omits the rejected side of its cutoff

N6's in-domain construction and real-number proof are sound, preserve zero/thin extents, handle sign and large finite magnitudes, and fail closed when its recomputed inequality is not achieved. The test list covers `±2^900` but does not explicitly require the next representable values outside the cutoff, `NaN`, or `±Infinity`, even though out-of-range handling is part of the claimed totality. Add those cases and assert they cannot reach `contained` or `DETECTED`. This is a verification gap, not a false-PASS path in the written rule.

## H1–H3 / M1 / L1 closure assessment

| Area | Result | Basis |
|---|---|---|
| H1 authorization reservation | **Not fully closed — High H1** | `open(...,'wx')` correctly serializes concurrent contenders; any existing reservation/journal/orphan temp refuses reuse; durable `ATTEMPT_CONSUMED` precedes the first `loadDocumentNode`. First-directory creation durability and reservation-only crash classification remain incomplete. |
| H2 closeout/evidence | **Not fully closed — High H2/H3** | fail-first ordering and required-versus-optional artifacts are clear; R1/R2 failures prevent PASS. The R1 schema is temporally impossible and the ambiguous terminal-write FAIL may lack a durable witness. |
| H3 / D7 C20 rendering | **Closed technically; owner acceptance still required** | PG-1/G2 ownership is explicit in design §16/PG-1 and plan G2. C20 is analytic and mechanical; positive evidence is required for PASS; all uncertainty yields `NOT_EVIDENCED` and therefore overall `PARTIAL`. |
| Original M1 — N6 construction | **Closed technically; new Low test addition remains** | whole-interval translation preserves extents; the derived margin exceeds the recomputed gross tolerance throughout the stated domain; out-of-range inputs fail closed. |
| Original L1 — exact repetitions | **Closed** | double dispose, C15(e)'s second clear, C20 captures/retakes, action type, aggregation, gate/characterization and scope limits are all exact; no retry-until-observed path remains. |

## C20 / N8 adjudication

- **PG-1 ownership:** confirmed. The accepted design explicitly requires SVF2 overlay-scene rendering evidence, and the plan assigns it to G2.
- **Mechanical oracle:** confirmed. `markers.js` uses a unit `SphereGeometry` with uniform scale/position and a world-coordinate `THREE.Line` through the box-edge path; C20 retains the geometry, camera matrices, canvas/clip coordinates and projection rules needed to recompute analytic footprints.
- **Durable evidence:** the complete changed-pixel and clear-difference sets are retained losslessly as bounded RLE, with all masks recomputable from retained geometry/matrices/constants. PNGs may remain optional because no verdict datum exists only in them.
- **Constants:** `δ=2 px`, `r_px≥2 px`, capture counts and waits are CA and require D7 owner acceptance. They can grant PASS/evaluability but cannot cause C20 FAIL. Exact byte inequality is logical, not calibrated.
- **No final-frame signal:** acceptable `PARTIAL` semantics, not a technical contradiction. Positive localized change proves rendering at the captured frame; absence/mismatch remains ambiguous and cannot PASS or FAIL. N8 is non-vacuous: null-change rejects change-free false PASS, and displaced footprints test localization; inability to discriminate caps C20 at `NOT_EVIDENCED`.

## Prior closure preservation

No regression was found in C7/C18 Panel-owned versus foreign scene ownership; check/control/cleanup fail-first precedence; C4's componentwise containment mechanics; C17 V0–V7/N7; independent A/B cleanup; C2's prototype-spy title lookup; D3 no-theming scope; D5 bridge-boundary scope; or D6's deferred coexistence scope.

The actual source remains compatible: `ViewerBridge` is the sole Viewer-mutating layer; `createMarkerSet` creates the sphere/outline shapes and removes only owned meshes/self-created scenes; `createPanelShell` remains a thin DockingPanel shell. No new source/API extension is implied.

## D1–D7 readiness

| ID | Status after this review | Required disposition |
|---|---|---|
| D1 | explicit owner decision | Accept Mechanical + Structure as the bounded two-model fixture composition. |
| D2 | explicit owner decision, **after H1–H3 correction** | Accept fail-first plus corrected durable closeout/evidence policy. |
| D3 | technical disposition confirmed | No theming seeding; zero Panel theming calls. No owner blocker. |
| D4 | explicit owner execution-risk decision | Permit only the reviewed bounded C15 injection after harness implementation review. |
| D5 | technical disposition confirmed | Keep selection/departure at the bridge boundary. No owner blocker. |
| D6 | deferred/non-blocking | Keep coexistence outside G2; exercise only the isolation guard. |
| D7 | explicit owner calibration/acceptance-scope decision | Accept C20 as verdict-bearing, its `PARTIAL` fallback, and the PASS-granting CA constants/capture budget. |

## Authorization result

- **Procedure v3:** not ready for owner acceptance.
- **Required technical correction:** the three new High findings, the new Medium Table T2 inconsistency, and the new Low N6 boundary-test addition, followed by a bounded independent re-review.
- **Owner decisions still required before harness implementation:** D1, corrected D2, D4 and D7.
- **Current authorization:** no next action authorized. G2 procedure edits, harness implementation, live execution, G3, H1/H2, OQ-1, host integration, production changes, commit and push all require explicit owner authorization.
