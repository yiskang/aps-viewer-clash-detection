# G2 D0/D1 Final Wording Correction — Targeted Independent Re-review

**Verdict:** accepted. The final documentation correction closes the prior Medium and both Low findings without changing the accepted technical dispositions. **Findings: 0 Critical / 0 High / 0 Medium / 0 Low.** The D0/D1 research set is ready for an owner-authorized checkpoint commit/push. D2 remains unimplemented and unauthorized; after a clean D0/D1 checkpoint, the next owner gate may authorize one D2 synthetic-transition specification/research task only.

## Verified repository state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `ef436d4a5632692fadbddc09fb9aa6410fadc258`; `origin/main` matches.
- Current harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`. Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- Historical attempt-time harness SHA-256: `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4` at commit `75a3ccb9`. The current diff is confined to the later C2/C3 intent-name-versus-value correction and its helper/export plumbing; the cited C6/C8/N2, T4, frustum, and P6 behavior is unchanged.
- The immutable evidence snapshot remained byte-identical before and after the independent replay. Historical G2 remains `FAIL (row 3)`; C6 remains `NOT_EVIDENCED`, C8 remains unresolved, and T4 remains unchanged. No retry, new authorization record, attempt reset, harness/test/product/procedure change, or live work occurred.

## Targeted adjudication

### §10 historical claims and removed overclaims

Closed. Sections 8–10 now keep three levels separate: retained geometric similarity, consistency with a moderate/partial lag hypothesis, and unproved historical ownership/sequence causality. Section 10 expressly says that the evidence does **not** establish that N2 examined C6's result, that C6 and N2 belonged to one stale request sequence, or that `resetHome()` restored the intended state merely because `restoreState(..., true)` returned `true`.

The former “freshly reset,” affirmative stale-sequence/C6-result identity, and unsupported B:111 `~13–27-unit` field claim are removed or converted into explicit non-establishment statements. Section 8 now rejects only the tested reconstructed interpolation; because the historical start camera was not retained, mid-transition capture generally remains possible. No coupled wording elsewhere restores the stronger claim.

### Fact/inference matrix

Accepted. The lag row is explicitly labelled inference, uses “plausible and compatible,” and states that ownership and sequence are unproved. The C6/N2 row keeps the shared mechanism as a compatibility inference. The `restoreState` row distinguishes pinned-source behavior from the unobserved possibility of a later overwrite. Request identity, historical sequence causality, no-op behavior, unavailable geometry, and reset effectiveness remain unresolved rather than silently promoted to facts.

### Working-directory and working-tree language

Closed. The displayed replay command is labelled as repository-root-relative. The artifact separately explains that another working directory requires an absolute/resolvable script path and a known repository location. The scripts themselves require no implementation change.

The inaccurate phrase “checked in (uncommitted)” is gone. Remaining “checked in” uses correctly describe committed preserved inputs or state that the Viewer bundle is not checked in. Uncommitted replay artifacts are described as present in the working tree and untracked.

### Harness-revision reconciliation

Accepted. The artifact identifies both the attempt-time harness (`471fae40...`, commit `75a3ccb9`) that produced R1 and the current harness (`cc8868cd...`, commit `ef436d4`) used for navigation citations. Direct Git comparison confirms that the intervening harness change is confined to C2/C3 intent-value correction plumbing; `frustumPredicate`, `waitForCameraSettle`, `evaluateC6`, `evaluateC8`, `evaluateN2`, and the P6 runner are unchanged. The document correctly treats current line numbers as navigation aids and does not reinterpret the historical evidence through the newer C2/C3 behavior.

### D2 completion and `restoreState` branches

Accepted as research-level framing. “One completion event” is limited to a normal animated completion; the future D2 specification must define emission/absence for immediate, early-return, gotoview-disabled, same-pose/no-op, overwritten-pending, timeout, and destruction outcomes. This leaves implementable choices to the separately authorized specification without making the present research an implementation contract.

The D2 recommendation also correctly models `restoreState` interaction as separate alternatives. The pinned Viewer 7.124.2 bundle still hashes to `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`; its valid immediate branch synchronously applies camera state but does not itself clear the pending destination, transition-active state, or animation callback. The artifact does not claim that a later overwrite is guaranteed and defers the exact interaction to D2.

### Internal-review Critical and circular-gate disposition

Rejecting “no implementable D2 contract” as a Critical defect of D0/D1 is correct. D0/D1 is a bounded research artifact, not the D2 contract. It already defines the safe research boundary: retained U/A:104 inputs, explicitly synthetic missing geometry/state, mechanical-possibility rather than historical-causality claims, source-derived bounded scheduling, exhaustive-versus-exploratory reporting, and a separately authorized D2 specification before implementation. No missing research-level decision makes checkpointing unsafe.

Deferring the circular-gate design to that specification is also correct. The handoff records four separate future gates: D2 simulator specification, offline simulator, separately authorized diagnostic instrumentation/live run, and T4/harness remediation. That decomposition prevents the current artifact from silently authorizing a self-validating implementation. The future D2 specification must make the boundaries and evidence flow explicit; no additional D0/D1 wording is required now.

## Replay reproducibility and scope discipline

An independent replay was run from `/tmp` using the absolute script path and an explicit temporary output. It produced SHA-256 `9d39b4d07b585cba63ed0b89e2a2c933460ad97a1b300bf876d86c8f6ffc21a9` and was byte-identical to retained `recompute_out.txt`. Retained finite values reproduced exactly: C6 clip difference `0`; C6/N2/C8 `worstExcess` equality; N2/C8 affine residuals approximately `1.67e-16` and `8.88e-16`. The scripts only read R1 and wrote the requested temporary output.

All 11 files in the preserved evidence directory, including `MANIFEST.md`, had identical hashes before and after replay. `git diff --check` is clean. The only tracked diff is `docs/handoffs/latest.md`; all other current task artifacts are under `docs/`. No harness, test, product, procedure, or immutable-evidence file changed.

## Preserved technical dispositions

- Lag evidence remains a **moderate/partial pattern; historical causality unproved**.
- D2 inputs remain retained U/A:104 plus explicitly synthetic missing geometry/state; exact arithmetic applies only to retained finite values.
- T4 gaps establish plausibility, not historical occurrence; T4 is unchanged. C6 remains `NOT_EVIDENCED`; no numeric C6 margin is selected.
- No live diagnostic, retry, record issuance, attempt reset, C6/N2 redesign, D2 implementation, or downstream work is authorized by this review.

## Readiness and next gate

The D0/D1 research, replay scripts/output, internal reviews, independent reviews, and updated handoff are **ready for an owner-authorized checkpoint commit/push**. This review does not perform or itself authorize that external state change.

After a clean checkpoint, the next owner-authorized gate may be **one D2 synthetic-transition specification/research artifact only**. Its bounded scope is: retained U/A:104 inputs; openly synthetic missing geometry/state; explicit scheduling/state-machine and outcome branches; no historical-causality claim; no T4 or procedure change; no production/harness remediation; no live diagnostic; no acceptance retry; no new authorization record or attempt reset.
