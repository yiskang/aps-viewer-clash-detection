# Corrected G2 D0/D1 Research — Targeted Independent Re-review

**Verdict:** the correction closes the D2 input boundary, falsifiability, separate-spec, `restoreState`, public/private API, and executable replay-portability findings. One coupled camera-attribution contradiction remains in §8/§10, so the D0/D1 checkpoint is **not yet ready to commit/push** and D2 research is not yet ready for owner authorization.

**Findings:** 0 Critical / 0 High / 1 Medium / 2 Low.

## Verified repository state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `ef436d4a5632692fadbddc09fb9aa6410fadc258`; `origin/main` matches.
- Harness SHA-256 remains `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`; accepted procedure SHA-256 remains `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- The immutable evidence tree was hashed before and after the replay and remained byte-identical. Its only G2 live attempt remains historically committed as `FAIL (row 3)`; C8 remains unresolved, C6 remains `NOT_EVIDENCED`, and T4 remains unchanged.
- No harness, test, product, procedure, or evidence implementation change, live retry, new authorization record, or attempt reset was found.

## Findings

### Medium M1 — §10 still turns similarity into camera/request ownership

**Affected text:** research §10, especially line 166; directly related §8 lines 148 and 151.

Most of the artifact now correctly separates observed facts, a moderate/partial pattern, inference, and unresolved causality. Section 10 nevertheless says:

- the positive and control are “two points on one stale sequence”;
- N2 passed “because it examined C6's result”;
- N2 operated on “a freshly reset home camera.”

Those are historical camera/request and reset-effectiveness claims that R1 cannot establish. The artifact itself records that the 0.9 aggregate-fit expectation was not independently derived, B:111 geometry and the home camera were not retained, no-op/non-framing behavior remains possible, and `resetHome()` returning true is not a cancellation/completion witness. The defensible statement is that N2 examined a camera **geometrically consistent with** the framing expected from C6's aggregate request under stated assumptions.

The nearby statement that mid-transition capture is “rejected” is also too strong. The comparison uses an inferred/predicted A:104 destination and does not retain the actual pre-transition start camera; it can reject only that particular reconstructed interpolation hypothesis, not mid-transition capture generally. Section 8 also says a B:111 fit would produce a roughly 13–27-unit field immediately after stating that B:111's historical geometry is unavailable; this must be removed or explicitly sourced and labelled non-historical/synthetic.

**Minimum correction:** rewrite §10 so every causal/ownership statement remains similarity/inference; replace “freshly reset” with the observed restore call and unknown effectiveness; narrow the mid-transition sentence to the tested reconstruction; remove or qualify the unsupported B:111 field-size statement. Reconcile the correction internal review and handoff if their “M1 done” claim is retained.

### Low L1 — the documented “any cwd” command is repo-root-relative

The scripts themselves are working-directory independent when invoked by a resolvable path: `load.py` resolves R1 from `__file__`, and `recompute.py` resolves its sibling import from `__file__`. The command shown under “Replay command (any cwd)” is `python3 docs/...`, which resolves only from the repository root (or another directory with that relative tree). Use an absolute/script-resolved path for the any-cwd example, or relabel the displayed command “from repo root.”

### Low L2 — “checked in (uncommitted)” is contradictory status wording

Research §1 calls the replay files “checked in (uncommitted).” They are present as untracked working-tree files, not checked into Git. Replace this with “present in the working tree (uncommitted)” or equivalent. This does not affect evidence or replay correctness.

## Targeted correction adjudication

### M1 lag claim and “not N” wording

The headline, §§8–9, and the fact/inference matrix now correctly say **moderate/partial one-request-lag pattern; historical causality unproved**. “Not consistent with the expected successful tight framing” is appropriately weaker than assigning the camera to another request, and §§8–9 keep no-op behavior and ownership unresolved.

The correction is not globally complete because §10 reasserts the stale sequence and C6-result identity as fact. Exactness is otherwise correctly confined to retained arithmetic.

### M2 D2 input boundary

Closed. D2 is limited to retained U and A:104 data. B:111, A:135, and home/pre-call state are explicitly synthetic when needed and cannot be presented as reconstructed history. Pinned-source aggregate padding must be derived independently rather than copied from the observed 0.9 sample.

### D2 falsifiability and separate-spec boundary

Closed. A negative search result supports bounded impossibility only if the schedule space is source-derived, explicitly bounded, and exhaustively enumerated; otherwise the result is only “not found in explored schedules.” D2 is limited to mechanical possibility and candidate-discriminator behavior, not historical causality.

The required separately authorized D2 specification is an effective scope barrier. It must define the state machine, schedule space, case matrix, exhaustive/non-exhaustive status, pass/fail rules, and retained outputs before implementation. It does not authorize harness remediation, T4 amendment, a live diagnostic, or a G2 acceptance retry.

### `restoreState(..., true)`

Closed. The pinned bundle still hashes to `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`. Its valid-state immediate path applies camera state synchronously without clearing `__destinationView`, transition-active state, or the Autocam callback; missing state or viewer/model returns false. The research now correctly treats the boolean as neither a cancellation nor completion witness and labels a later overwrite as an unobserved source-derived inference.

### Public/private API and official documentation

Closed. The artifact distinguishes current public documentation, pinned 7.124.2 implementation behavior, undocumented navigation surfaces, and internal Autocam details. Async consumption, last-writer-wins slot behavior, active-transition holding, and the zero-motion first step are pinned implementation facts—not public guarantees. The public completion event has no request identity in the pinned implementation.

The official APS `ViewingUtilities.fitToView(immediate)` reference independently states that `immediate=false` animates over a short period. That animation statement may remain as a qualified current-v7 public description; exact consumption, coalescing, duration, no-op, and completion behavior must continue to come from the pinned bundle. The source/API distinction does not carry the remaining M1 defect.

## Replay and source reproducibility

The scripts have no absolute evidence path or local-cache dependency. `load.py` resolves R1 relative to its own file; `recompute.py` resolves the sibling import the same way and accepts an explicit output path. Dependencies are Python 3 standard library only, with the verified Python 3.9.6/macOS envelope stated.

An independent run from `/tmp`, invoking the script by absolute path and writing to a temporary output file, produced SHA-256 `9d39b4d07b585cba63ed0b89e2a2c933460ad97a1b300bf876d86c8f6ffc21a9`, byte-identical to retained `recompute_out.txt`. C6 clip difference was `0`; C6/N2/C8 finite `worstExcess` values compared exactly equal; N2/C8 affine residuals were approximately `1.67e-16` and `8.88e-16`. No preserved evidence file changed, and output order is deterministic in the verified envelope.

The appendix now identifies the Viewer bundle as external, gives its exact URL/version/digest, names the external fetch helper and environment, uses symbol anchors, and defines fail-closed behavior if the source is unavailable or the digest differs. Repo-only arithmetic/evidence conclusions remain reproducible without network access; D0 source-derived and D2 source-calculation conclusions require the matching external bundle. This is sufficient source portability without checking in the 11 MB bundle.

## Remaining contract dispositions

- **Fact/inference matrix:** accepted. The lag row is explicitly an inference; N2 is similarity-only; restore overwrite is an inference; fixture/no-op alternatives remain open.
- **Request-tagged completion:** accepted as an instrumentation-derived design concept, not an existing Viewer signal. Future work must define issue identity, quiescence, pending/active witnesses, attribution, timeout, and ambiguous outcomes.
- **T4:** unchanged. Zero-motion/start delay, no transition-state input, and no request correlation remain source-proven gaps; premature settlement and historical occurrence remain plausible, not proved. Any change still requires explicit owner authorization and procedure re-acceptance.
- **C6/margin:** C6 remains `NOT_EVIDENCED`; no numeric margin is selected or supportable from the retained single-run observations. Calibration stays deferred to accepted synthetic/offline or later separately authorized evidence.

## Readiness and exact next gate

The corrected D0/D1 research is **not yet ready for checkpoint commit/push** because M1 remains coupled to the central causal claim. The replay implementation and D2 design boundary need no further technical change; L1/L2 should be corrected in the same bounded documentation pass.

After M1/L1/L2 are corrected and targeted re-reviewed, checkpoint the research, replay scripts/output, internal reviews, independent reviews, and handoff before D2. The next technical owner gate should then authorize **one D2 specification/research-artifact task only**—no D2 implementation, harness/T4/C6 change, live diagnostic, acceptance retry, record issuance, attempt reset, or downstream G3 work.
