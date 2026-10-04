# G2 D0 Viewer API Evidence + D1 R1 Replay — Independent Review

**Verdict:** the D0 source investigation and D1 arithmetic replay are technically useful and preserve the historical G2 verdict, but the research checkpoint is **not yet ready to commit/push**. Two bounded wording/scope corrections are required before checkpoint closeout. D2, T4 changes, and any live work remain unauthorized.

**Findings:** 0 Critical / 0 High / 2 Medium / 2 Low.

## Repository and evidence state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `ef436d4a5632692fadbddc09fb9aa6410fadc258`; `origin/main` matches.
- Committed harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.
- Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- All ten files named by `docs/research/evidence/g2-live-20261004-75a3ccb9/MANIFEST.md` independently re-hash to their recorded values. The only G2 live evidence directory remains `g2-live-20261004-75a3ccb9`; its journal retains one `ATTEMPT_CONSUMED`, and K remains `FAIL (row 3)`.
- C3/C2 correction is committed and pushed. C8 remains unresolved, C6 remains `NOT_EVIDENCED`, and T4 is unchanged. No retry, replacement authorization record, or attempt reset was found.

## Findings

### Medium M1 — the synthesis still overstates camera/request identity and pattern strength

**Research sections:** §§8–12, especially §10 statements that the N2 sample is “exactly fit(U), i.e. the result of C6's aggregate request” and that “N2 sample = C6's result exactly”; handoff D1 summary.

The preserved numbers exactly establish projection geometry, not request identity. N2 projects U almost perfectly centered (centre about `(+1.6e-8, -4.8e-8)`) with observed half-extent about `0.9`, which is strong geometric similarity to a tight union framing. But the expected aggregate-fit padding was not independently derived, B:111's box was not retained, and the no-op/non-framing alternative is still open. C6's home/default identity cannot be checked because the pre-call/home camera was not retained. C8 is inconsistent with its own requested A:104 framing, but tying it to N2's B:111 request depends on an unretained B:111 box and inferred corner-element identity.

The evidence therefore supports a **moderate, partial one-request-lag pattern**, with one strong similarity link and two inference-dependent links. It does not support “exact” camera/request attribution or the handoff's unqualified “strong pattern.” Causality remains unproved, as the artifact otherwise correctly says.

**Minimum correction:** reserve “exact/bitwise” for the frustum arithmetic; describe N2 as geometrically consistent with the previous aggregate request under stated assumptions; describe the overall lag pattern as moderate/partial rather than strong. Apply the same wording to the handoff and fact/inference matrix.

### Medium M2 — the proposed D2 input set names historical geometry that is not retained

**Research section:** §13, “with the R1 geometry (U, A:104, B:111).”

R1 retains U and A:104's box, but not the selected B:111 or A:135 boxes. D2 cannot honestly claim to replay historical B:111 geometry from R1. This does not invalidate the D2 recommendation, but it makes the proposed minimum model underspecified and risks turning an inferred identity into a fixture fact.

**Minimum correction:** define D2 around retained U and A:104 plus an explicitly synthetic B-side target (or a separately sourced, clearly non-historical fixture value). Require the pinned-source aggregate-fit destination/padding to be independently derived. Do not label a synthetic/current value as the historical B:111 box.

### Low L1 — `restoreState(..., true)` success wording is too broad

The source proves that a valid state with an available viewer/model reaches the immediate camera path without clearing the pending destination, transition-active flag, or Autocam callback, and that the historical call returned `true`. It does **not** return true unconditionally: missing state or missing viewer/model returns `false`, and exceptions remain possible. Narrow “returns true regardless” to the valid-state path used here.

### Low L2 — the reproducibility appendix has portability/staleness defects

Section 1 still says replay scripts were kept outside the repository and that only three files were touched, while the scripts are now present under `docs/research/`. `load.py` hard-codes this checkout's absolute path, and the Viewer-source recipe names a helper without an exact retained command/path. The documented in-place replay works in this checkout and reproduced the committed output exactly, but another checkout is not self-contained.

Minimum correction: use a script-relative R1 path or document the absolute-path assumption; reconcile the stale “outside repo” sentence; give an executable fetch/verification command or explicitly state that source reproduction requires the named external helper/network access.

## D0 source/API adjudication

The pinned Viewer bundle was independently found and hashed to `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`, matching the research record.

| Claim | Classification | Independent disposition |
|---|---|---|
| `Viewer3D.fitToView` returns before transition consumption/completion | **Source-proven; public API method, completion semantics undocumented** | The facade discards the impl boolean and returns `undefined`; the impl stores a navigation request. |
| Motion begins later and runs for roughly 500 ms | **Source-proven implementation behavior, not a public guarantee** | Consumption occurs in `ViewingUtilities.update`; Autocam step 0 has zero interpolation and advances elapsed time by frame delta divided by 500. Scheduling can extend wall time. |
| One pending request slot; later pending writes replace earlier ones | **Source-proven implementation detail** | `Navigation.__destinationView` is a single shared transition slot, not a fit-specific public queue. |
| A request arriving during an active transition is held | **Source-proven implementation detail** | `ViewingUtilities.update` consumes the slot only while transition-active is false. The current transition can finish before the held request starts. |
| `restoreState(..., true)` does not cancel active/pending transition work | **Source-proven for the valid immediate-camera path** | It applies camera state directly and does not clear the request slot, active flag, or Autocam rAF chain. Its boolean result is not a cancellation/completion witness. |
| No public request-correlated completion signal | **Supported by public API shape plus source** | `CAMERA_TRANSITION_COMPLETED` is public but has no request identity/payload. Fit-start events identify issue, not completion. |
| Completion event is not guaranteed for every fit | **Source-proven behavior/comment; not an affirmative public guarantee** | Immediate, early-return, disabled-action, and exact-same-camera paths can lack the expected completion event. |

Public supported but semantically insufficient surfaces are `fitToView`, `restoreState`, `FIT_TO_VIEW_EVENT`/`AGGREGATE_FIT_TO_VIEW_EVENT`, `CAMERA_TRANSITION_COMPLETED`, camera-change/render events, and camera getters. `getRequestTransition`, `getTransitionActive`, the transition-active flag event, and `EventUtils.waitUntilTransitionEnded` are undocumented/version-sensitive surfaces. `__destinationView`, `ViewingUtilities.update`, Autocam state, interpolation fields, and rAF callbacks are implementation details only. A future remediation that depends on the latter two groups carries pinned-build drift risk and needs explicit contract evidence.

## T4 and pending-slot adjudication

The three stated T4 gaps are source-proven:

1. a fit can exist as pending work, and Autocam's first transition step is zero-motion;
2. T4 samples only two matrices and reads no pending/active state;
3. T4 has no request identity or issue/completion correlation.

They establish that T4 lacks the information needed to distinguish “current request finished” from “not started,” “held,” or “previous request finished.” They do **not** by themselves demonstrate that the live scheduler supplied two qualifying rAF samples before the current request moved. Early settlement is plausible and strongly source-supported, but reproduction and historical causality remain open.

The single slot is last-writer-wins while pending. It is consumed only when no transition is active; an active transition therefore completes before the held destination starts. Immediate restore changes the camera but neither clears that slot nor stops active Autocam work. These mechanics make the C6/N2/C8 phenomenology possible, not proven.

## D1 replay and arithmetic adjudication

The scripts read the immutable R1 artifact and do not mutate it. They embed the historical `1e-4` frustum epsilon and reproduce the harness's column-major `P·V·p`, inside, and excess formulas. They write only the derived `recompute_out.txt` in their working directory.

An independent run in a temporary directory produced SHA-256 `9d39b4d07b585cba63ed0b89e2a2c933460ad97a1b300bf876d86c8f6ffc21a9`, byte-identical to the retained output. C6 recomputed clip entries have maximum difference `0`; C6, N2, and C8 `worstExcess` values compare exactly equal to the decoded finite IEEE-754 values. N2/C8 affine residuals are approximately `1.67e-16` and `8.88e-16`.

This closes the “frustum/oracle arithmetic defect” hypothesis for the preserved samples. It does not establish that the harness captured the correct request's camera.

## Camera/request alignment and causal verdict

| Sample | Evidence and metric | Verdict |
|---|---|---|
| C6 | U projects loosely (`max|NDC|≈0.459`), off-centre by roughly `(0.044,0.101)`; world-origin-centred view line. No home camera retained. | Not a tight own-request fit; **home/default-like only, low confidence**. |
| N2 | U projects at centre about `(1.6e-8,-4.8e-8)`, observed half-extent about `0.9000000`. B:111 box and an independently derived Viewer padding rule are absent. | **Strong geometric similarity to union framing; request identity inferred, medium-high similarity confidence but not exact attribution.** |
| C8 | A:104 is far outside and not tightly framed; the reconstructed camera aligns one U corner near `(0,0.9)`. B:111 identity is not retained and s2 is absent. | Not its own requested fit; **previous-request alignment is plausible, low-to-medium identity confidence**. |

Overall: **moderate/partial one-request-lag phenomenology, cause unproved**. Start delay, held pending request, non-cancelling restore, scheduler order, and a no-op/non-framing fit remain observationally entangled. D0+D1 cannot select one historical cause.

## C6, fixture, and margin dispositions

- C6's recorded positive predicate is vacuous for the intended aggregate-fit claim because the loose captured camera already contains U. N2's result is consistent with the same timing chain, but alternative target/no-op explanations remain. C6 correctly stays `NOT_EVIDENCED`; it must not be upgraded.
- Fixture innocence is not established. Missing evidence includes B:111/A:135 boxes, a quiescent direct A:104 fit, the home/pre-call camera, and C8's second settled sample. Model geometry or an ineffective fit remains possible.
- The retained `-0.54`, `-0.10`, and inferred `+16.12` values are descriptive observations, not a calibration population. No defensible C6 separation margin, including the proposed `≈1`, can be chosen from this run.

## D2, live diagnostic, and T4 decision

**D2 is recommended before a T4/C6 implementation decision.** It should remain offline and synthetic: model one shared pending slot, last-writer replacement, active-transition gating, zero-motion first step, frame-driven interpolation/final snap, an uncorrelated completion event, immediate restore that does not cancel work, no-op/disabled/early-return cases, and the current two-sample T4 observer. Use retained U/A:104 geometry and explicitly synthetic missing targets. Score candidate discriminators across idle-delay/interpolation/order variants without changing the procedure or choosing a C6 margin.

D2 can prove a counterexample and candidate-observer behavior. It cannot prove which scheduling/mechanism caused the historical run. If D2 reproduces false settlement and leaves request ownership or completion dependent on undocumented Viewer state, a **separate, bounded instrumented live diagnostic** is safer than using a new acceptance attempt as diagnosis. It should capture pre-call camera, per-frame samples/timestamps, pending/active edges, issue identity, and completion evidence under its own authorization/schema. No live diagnostic is authorized now.

Keep T4 unchanged. Open a redesign decision only after D2 demonstrates the counterexample and a candidate rule rejects delayed/held/no-op stale observations while accepting correct and legitimate no-motion fits. Any adopted T4 change requires explicit owner authorization, procedure amendment/re-acceptance, new procedure/harness identities, and—if private signals remain involved—live pinned-build evidence.

## Internal-review and reproducibility assessment

The internal review's source call-path and arithmetic findings are sound, and its listener-removal downgrade and D2-causality limitation are present. Its prior High attribution correction is incomplete because exact/strong identity wording remains in §§10–12 and the handoff. Numeric replay is reproducible. Source lookup is independently verifiable from the matching bundle digest and symbol anchors, but the appendix is not fully portable for the reasons in L2.

## Readiness and exact next gate

The D0/D1 result is **not ready for checkpoint commit/push** until M1/M2 and the two Low documentation defects are corrected and targeted re-reviewed. No harness, test, product, or procedure change is needed.

After that bounded correction is accepted, commit/push the D0/D1 research, scripts/output, internal review, independent review, and handoff as one clean research checkpoint before D2. The next owner-authorized technical gate should then be **D2 synthetic-transition research only**. D2 implementation, any T4/C6 change, any live diagnostic or retry, a new authorization record, attempt reset, and G3/downstream work remain unauthorized.
