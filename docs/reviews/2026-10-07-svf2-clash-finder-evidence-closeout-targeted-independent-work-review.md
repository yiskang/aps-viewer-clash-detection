# SVF2 Clash Finder Evidence Closeout — Targeted Independent Work Re-verification

**Date:** 2026-10-07  
**Role:** Independent Work reviewer  
**Scope:** Prior review findings M1 and M2 only  
**Verdict:** **M1 and M2 closed; package ready for checkpoint authorization**  
**Findings:** **0 Critical / 0 High / 0 Medium / 1 Low**

## 1. Repository boundary

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `main`
- **HEAD:** `2529402392e948db4ebba52c521a827fe5f206d0`
- **Origin relation:** `main == origin/main`
- **Working tree:** dirty and uncommitted; the integrated package, evidence closeout, reviews, and handoff remain in the working tree. Nothing was committed or pushed by this review.
- **Prior authority:** `docs/reviews/2026-10-07-svf2-clash-finder-compatibility-targeted-independent-work-review.md` — M1 required a post-amendment two-format M3 run; M2 required durable acceptance/performance evidence.
- **Upstream closeout input, reviewed read-only:** `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md` §14.

This re-verification did not reopen implementation, design, the prior Low, or any deferred scope.

## 2. M1 — closed

The new M3 evidence is from the post-amendment candidate and resolves the stale-run defect identified by the prior review.

### Current-tree binding

- `HEAD.txt` records the same base HEAD, `2529402392e948db4ebba52c521a827fe5f206d0`, and the then-current uncommitted package diff summary.
- The M3 log and outputs were produced before the closeout documentation/evidence-copy step. No product or test source under `collision/`, `clashtest/`, `clashpanel/`, `wwwroot/`, or `test/` is newer than the M3 run log; only generated ignored acceptance-result files are newer.
- The durable M3 JSON files are byte-identical to the latest generated ignored outputs:
  - SVF2: `5971c460...a825f`
  - SVF: `a141467b...01f70`
  - criteria: `a3347bb1...2fc6f`

### Gate result

- `m3-gate-svf2-criteria.json` records `allPass: true`.
- Criterion (a): both worlds record 96 builds, 336 hits, 0 shared waits, 432 resolutions, and 96 distinct keys; both accounting identities pass.
- Criterion (b): peak derived retained bytes are 365,880 against 7,595,514 SVF canonical bytes, ratio `0.0481705386`, below the 1.25 limit.
- Criterion (c): SVF2/SVF wall-time ratios are `1.30597`, `1.03337`, `1.35579`, and `0.95997`, all below 2.
- Criterion (d): the fresh legacy-SVF run records 532 spans, worst 7.3 ms, zero over 8 ms, and `GO`. The prior 9.6 ms `CAUTION` remains accurately preserved as a separate accepted measurement; no threshold or constant changed.

### Amendment-specific proof

- The fresh SVF2 report has no `clearance-anisotropic-scale-unsupported` diagnostic. Its diagnostics are exactly two informational `fragment-null-geometry` and 288 `clearance-hard-clash-precheck-inconclusive` entries.
- Both measured worlds record the amendment's `noSurfaceOperands` activity: Architecture 12 per cold pass and Mechanical 208 per cold pass, doubling cumulatively after warm execution.
- Every measured TLAS/linear cold/warm run returns the same 30 pairs.

The old pre-amendment artifact's 212 anisotropic diagnostics are therefore no longer being used as final-tree T7 evidence. M1 is fully closed.

## 3. M2 — closed for the checkpoint candidate

The required evidence now exists under `docs/research/evidence/2026-10-07-svf2-clash-finder-closeout/` and is not ignored.

### Completeness and integrity

- Eleven evidence files exist: README, HEAD record, SHA-256 manifest, three JSON acceptance/performance result groups, and three corresponding run logs.
- `SHA256SUMS.txt` covers every evidence file except itself. All ten entries independently verify.
- Durable acceptance JSON is byte-identical to the generated source reports and to the hashes inspected in the prior review:
  - Clash Finder: `f4425dfb...aae2a0`
  - Room Locator: `5c0b9075...877645`
- The durable M3 files are byte-identical to the latest generated M3 outputs, as listed under M1.
- A targeted credential-pattern scan found no credential-bearing evidence file.

### Retained results

- Clash Finder: 257/257 checks pass, 16 N/A, SVF2 format, zero console errors, zero page errors, format-local 34-pair baseline and the two informational Architecture null-geometry records retained.
- Room Locator: 13/13 checks pass.
- M3: one two-format invocation, all four criteria pass, with the complete reports and log retained.

The evidence directory is currently **untracked**, because the entire package is still awaiting its checkpoint commit. It is trackable (`git check-ignore` does not match it) and must be included in that checkpoint. Subject to that normal pre-commit condition, M2 is fully closed.

## 4. Finding

### Critical

None.

### High

None.

### Medium

None.

### Low

#### L1 — “Tracked evidence dir” is premature wording while the package remains uncommitted

- **Affected:** upstream final report §14 and the pre-review handoff wording.
- **Evidence:** `git ls-files docs/research/evidence/2026-10-07-svf2-clash-finder-closeout` is empty, while `git check-ignore` confirms the directory is not ignored.
- **Impact:** no evidence-content or integrity defect exists, but “tracked” is not yet literally true. The files become tracked only when the authorized checkpoint commit includes them.
- **Disposition:** non-blocking. This review corrects the handoff to say **trackable/untracked** and makes inclusion of the entire evidence directory an explicit checkpoint condition. The upstream final report remains unchanged under the independent-review ownership boundary.

## 5. Verification performed

- Parsed and cross-checked all five durable JSON reports.
- Independently verified all ten SHA-256 manifest entries.
- Compared each durable JSON report with its latest generated ignored source; all hashes match.
- Confirmed no product/test source is newer than the fresh M3 gate log.
- Confirmed the evidence directory is not ignored and is not yet tracked.
- Confirmed the run logs contain the stated terminal results.
- `git diff --check`: clean.

No live acceptance or performance run was repeated by this review; the task was evidence re-verification, not another execution authorization.

## 6. Gate and authorization state

M1 and M2 are closed. The prior implementation acceptance now has the required final-tree performance verification and a complete, integrity-checked, trackable evidence package. No Critical, High, or Medium blocker remains from the targeted compatibility review.

**Recommended next action:** owner authorization for one scoped checkpoint commit/push containing the complete integrated package, both independent reviews, package report, handoff, and the entire `docs/research/evidence/2026-10-07-svf2-clash-finder-closeout/` directory.

**Currently authorized:** this targeted independent review and handoff update only.

**Must not begin without explicit owner authorization:** checkpoint commit/push, any further product/test/spec/evidence change, M3 contract/threshold change, D-V6 work, G1 mapping edits, reflected-fragment support, G2/C6/C8, G3, or further milestone scope.
