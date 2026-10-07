# D-V6 and Architecture Self-clash H1/H2 — Targeted Independent Work Review

**Date:** 2026-10-08  
**Role:** Independent Work reviewer  
**Scope:** Re-review only the two High findings from `2026-10-07-d-v6-architecture-self-clash-targeted-independent-work-review.md`  
**Verdict:** **H1 and H2 are closed; ready for the owner checkpoint decision**  
**Findings:** **0 Critical / 0 High / 0 Medium / 1 Low**

## 1. Repository and review boundary

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch / HEAD:** `main` at `dcdab38a9808ba8c45b1a89181f2fa9871a08c3f`; `main == origin/main`.
- **Working tree:** dirty and uncommitted with the H1/H2 remediation, tests, specification/plan/README reconciliations, research/evidence, the prior Work review, this review, and the handoff update. Nothing was committed or pushed.
- **Authoritative upstream input, reviewed read-only:** `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md` §§16–20.
- **Review boundary:** H1 product performance and H2 D-V6 contract reconciliation only. This review does not reopen M1/M2, G1/reflection, G2/C6/C8, G3, M3, Core architecture, or the accepted R20-1 bracket protocol. No live run was repeated.

## 2. Finding summary

### Critical

None.

### High

None. Prior H1 and H2 are closed below.

### Medium

None.

### Low

#### L1 — Historical D-V6 test-title wording remains broader than the amended contract

The governing Viewer Adapter plan now carries the exact `N + nullGeometry:true` exception in D-V6, the global constraints, the Task 8 implementation section, and the environment gate. The current source and executable tests are also exact. A few historical phrases remain broad, notably the Task 8/test title and the Task 13 negative-control shorthand saying that a tree-reachable “not-loaded” fragment fails. Their actual fixtures exercise a real-geometry class-N fragment, and adjacent amendments expressly exclude null geometry.

This is not a contract contradiction or an implementation ambiguity: the normative D-V6 amendment is explicit and the counter-case is executable. A future documentation cleanup may rename those historical titles to “real-geometry not-loaded”, but no correction is required for checkpoint readiness.

## 3. H1 — Architecture self-clash product-performance blocker

### Prior gate

The prior High required more than successful planning. Closure required either:

1. a representative Architecture whole-model self-clash completing inside an owner-accepted product envelope after bounded correction; or
2. an explicit product decision narrowing or deferring the workflow.

The current package satisfies the first path.

### Implementation review

The bounded remediation preserves the accepted architecture and observable result semantics:

- **Option A:** `LocalUnitExecutor` now creates one P0 slicer-backed checkpoint per unit. The first checkpoint still yields; later checkpoints yield only when `sliceBudgetMs` expires. Pre/post scope bracketing, digest inputs/bytes, collision calls, settlement order, and unit-boundary cancellation are unchanged.
- **Option D:** the diagnostic aggregator adds `counters()` for the three exact running totals needed by progress. It rechecks the same sigma invariant from the same reason buckets without sorting or copying the retained diagnostic map. `snapshot()` remains unchanged and is still the seal-time authoritative `DiagnosticsSummary`; aggregators without `counters()` retain the old fallback behavior.
- **Option E:** the Panel now reports settled units, `(unitsEvaluated + unitsFailedOrSkipped) / unitsTotal`, labels that quantity explicitly, exposes failed/skipped units beside the evaluated counter, and documents the possible step-back when runtime splits increase the denominator. It no longer presents front-loaded pair-space progress as completion progress.

The N20 interface reconciliation and Panel design §7.1 now describe those exact surfaces. No collision threshold, digest encoding, decomposition rule, Result Set shape, or Core public API changed.

### Completed real-product evidence

The retained headed profile is not merely planning evidence:

- normal Viewer Panel path, SVF2 Audubon Architecture, Hard self-clash, Set B = Same as Set A;
- Viewer 7.124.2, headed Chromium 154, visible foreground tab on Apple M4;
- **4,294 / 4,294 units completed**;
- **4,770 clashes**, **57,130 completeness-affecting caveats**;
- completed Result Set reports Coverage full, Integrity caveated, Freshness current;
- all units settled `evaluated` with equal pre/post brackets;
- result count equals the sum of per-unit pairs, and the final progress caveat count equals the sealed diagnostic count and per-reason sum.

Measured runtime was **145.5 seconds from Run click to the last unit**, with the completion display/seal estimated at about **3.9 seconds** from retained long-task timestamps, for about **2.5 minutes total**. The exact “Completed shown” instant was not instrumented; the report states that limitation rather than presenting the estimate as an exact mark. Two Stop observations were **2.48 seconds** and **3.19 seconds**. The owner explicitly accepted this as checkpoint-level v1 performance for this Architecture scenario and accepted the current Stop latency; that decision is not a universal SLA.

The profile's 22-file SHA-256 table was independently recomputed with **22/22 matches**. The completed-run screenshot and head progress screenshot were visually checked. Shared-unit comparisons report no difference for all 3,034 post-A units, all 1,707 mid-stop units, and both head-stop units. Offline pre-D/post-D probes retain identical Result Set, diagnostic, and progress hashes for completed and cancelled runs.

### H1 disposition

**Closed for this checkpoint.** The original 18-minute incomplete workflow has been replaced by a completed representative product run inside an explicit owner-accepted envelope. This conclusion is based on execution, sealing, and final-result evidence—not successful planning alone.

The following remain recorded performance debt, not silently accepted as universal behavior: one-machine/one-browser coverage, background-tab and refresh-rate sensitivity, cross-model timing, whole-population digest cost, inter-unit frame wait, the unidentified synchronous seal block, and Option H. They do not reopen H1 because the owner accepted the bounded checkpoint envelope and authorized no further optimization.

## 4. H2 — D-V6 contract reconciliation

The repository now has one coherent rule:

- a tree-reachable population record with `cls === 'N' && nullGeometry === true` is informational, is marked reachable, skips the unavailable owner comparison, remains in the population and root digests, and permits planning;
- every other tree-reachable real-geometry class N, class U, or out-of-range fragment remains fail-closed as `tree-reachable-fragment-unattributable` / `enumeration-failed`;
- explicit scopes retain their previously declared trust boundary;
- no partial carrier, digest encoding, schema, limit, error code, or Core contract was added.

This rule agrees across design spec erratum A19, Viewer Adapter D-V6 and its directly affected constraints/gates, `clashtest/viewer/README.md`, `ViewerElementEnumerator.js`, and the whole-model tests. The accepted null-geometry case and a real-geometry negative control both execute. The complete Viewer Adapter suite passes **128/128**.

The prior evidence-packaging Low is also addressed: the D-V6 headed directory now records its console discrepancy without making a timing claim and integrity-binds all retained files. Its SHA-256 table was independently recomputed with **9/9 matches**.

### H2 disposition

**Closed.** Governing documents and implementation no longer disagree about the narrow null-geometry exception. The historical wording noted in L1 does not override the explicit amendment.

## 5. Independent verification

- Focused H1/H2 tests: **75/75 pass**.
- Offline suite: **5,383 total / 5,382 pass / 0 fail / 1 existing todo**.
- Panel DOM suite: **97/97 pass**.
- Viewer Adapter suite: **128/128 pass**.
- `git diff --check`: **clean**.

The first offline invocation inside the restricted workspace sandbox was invalid because temporary test-file writes and localhost socket binds were denied. It was rerun once with the repository's normal local permissions and produced the result above. This was not a live Viewer rerun.

## 6. Gate and authorization

**Review result:** both prior High findings are resolved. The H1/H2 package is technically ready for the owner checkpoint decision and, if accepted, a separately authorized checkpoint commit.

**Currently authorized action:** this targeted independent review and handoff update only; now complete.

**Recommended next action:** owner accepts or rejects the H1/H2 checkpoint and separately authorizes any commit/push.

**Must not begin without explicit owner authorization:** further performance optimization, Option H, commit/push, G1/reflection, G2/C6/C8, G3, M3, or any reopening of the frozen Core/R20-1 contract.
