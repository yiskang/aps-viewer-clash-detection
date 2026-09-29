# G1 SVF2 F1–F8 F5 remediation — bounded independent re-review

**Date:** 2026-09-29  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed branch / HEAD:** `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088`  
**Scope:** the uncommitted F5 remediation and directly affected F1/F2/F4 evidence plumbing only. No live G1 execution was performed.

## Verdict

The **F5 blocking defect is closed**. The implementation now derives the per-owner maximum from authoritative extracted records, explicitly evaluates every reviewed existing limit, fails closed when required evidence is unavailable, and preserves the specific oversized-geometry outcome. The prior accepted F1 digest remediation remains intact.

The harness implementation is accepted for a future live gate, with one non-blocking Low evidence-hygiene finding. It is **not operationally ready to execute live from the current working tree**: the reviewed remediation and documentation remain uncommitted, while Phase 0 deliberately rejects dirty paths other than the narrow `docs/prompts/` exception. The accepted set must first be committed and the clean-tree preflight state independently verified. A live F1–F8 execution remains a separate owner authorization after that closeout.

**Finding count:** 0 Critical / 0 High / 0 Medium / 1 Low.

## Finding

### Low L1 — one F1 extraction-exception carrier still bypasses `describeError`

**Location:** `test/acceptance/g1-svf2-f1-f8-verification.mjs:777-783`, `3083`.

`buildF1EvidenceDetails` now correctly passes `digestError` and `populationDigest.error` through the bounded/redacting `describeError`. However, an `extractFragments` exception is retained under `first20Mismatches[].extractFragmentsThrew`; that record has no `digestError` property, so the mapper returns it unchanged. Its `sessionErrOf` message therefore remains unbounded/unredacted in the final durable result.

This cannot create a false PASS, change F1/F5 scoring, or obscure the distinction between extraction, oracle, and true digest mismatch. It is a residual evidence-hygiene gap and the latest handoff's claim that all new F1 exception evidence uses `describeError` is too broad.

**Disposition:** non-blocking for F5 acceptance and future live authorization. Correct the wording now; defer code hardening unless separately authorized.

## 1. Authoritative per-dbId maximum

Verified in `observeF1`:

- Source is `populationExtraction.records`, which is the same Map retained as `session.artifacts.f1PopulationRecords` (`verification.mjs:3129-3143`, `3196-3211`).
- Every extracted record contributes through its own `ownerDbId`; the former ownerless `populationClasses` carrier is not used for this calculation.
- Counts are ranked by descending fragment count, then ascending dbId, making ties deterministic; `maxPerDbIdFragmentCount` and `maxPerDbIdOwnerDbId` come from the first ranked row (`3213-3220`).
- Evidence retains state, loaded/missing-owner counts, distinct-owner count, and the top five `{dbId,count}` rows (`3221-3227`).
- No records, extraction unavailable, or any unusable owner makes the maximum and responsible dbId `null`, never numeric zero (`3214-3220`).

The prior collapse-to-total-population path is no longer reachable through the real implementation.

## 2. Existing-limit checks

`scoreF5` constructs five explicit checks using only existing `collision/constants.js` values:

| Check | Observed value | Existing limit |
| --- | --- | --- |
| `maxCollisionInstancesPerEpoch` | F1 whole population | `maxCollisionInstancesPerEpoch` |
| `maxFragmentsPerDbId` | F1 per-owner maximum | `maxFragmentsPerDbId` |
| `maxFragmentsPerRoot` | F1 per-root subtree maximum | `maxFragmentsPerDbId` |
| `maxChildrenPerNode` | F2 maximum child fanout | `maxChildrenPerNode` |
| `maxSyncTriangleCount` | F4 maximum active triangle count | `maxSyncTriangleCount` |

Each record retains `{name, observed, limit, withinLimit, responsibleDbId}` (`verification.mjs:5430-5436`). Comparison uses `observed <= limit`, matching the library's strict-`>` enforcement: equality passes and any exceedance fails. The per-owner and per-root checks retain their responsible dbIds. No new public/resource limit was introduced.

## 3. Upstream evidence and oversized geometry

- Missing/malformed F1 population, root, or per-owner counts produce `BLOCKED / f1-evidence-unavailable`.
- A non-ok/absent F2 observation is passed as `null` by `runHarness` and produces `BLOCKED / f2-evidence-unavailable`; malformed F2 evidence does the same. A completed F2 observation with `accountingBalanced:false` is substantive negative evidence rather than unavailable evidence, so F5 correctly remains `FAIL / not-fully-enumerated` under the governing plan.
- Missing/malformed F4 `maxActiveTriangleCount` or `oversizedGeometryCount` produces `BLOCKED / f4-evidence-unavailable`; missing values are retained as `null`, never synthesized as zero.
- Valid `oversizedGeometryCount > 0` reaches `FAIL / oversized-geometry-present`, including when the maximum active triangle count also exceeds its limit.

No unavailable upstream value can produce F5 PASS.

## 4. F1 regression safety

The previously accepted F1 remediation remains present:

- subtree and class-L population digest rows retain `geometryId`;
- digest exceptions increment oracle-error counters and remain distinct from true digest mismatch;
- bounded first-20 mismatch evidence and population digest evidence still flow through `checks.F1.evidence.details` in `runHarness`;
- `f1PopulationRecords` remains assigned before population digest evaluation, preserving dependent F4/control executability.

Low L1 is limited to redaction/bounding of one extraction-error subfield; it does not regress these semantics.

## 5. Deferred Low dispositions

1. **Per-root limit check:** defensive and redundant once F1 is valid because the underlying tree walk already throws when that subtree exceeds `maxFragmentsPerDbId`. Retaining it is harmless, records the observed margin, introduces no new limit, and does not block live authorization.
2. **`blocked()` copies `sumRootFragmentCount` without validating it:** cosmetic. The value does not participate in a BLOCKED verdict or limit comparison, cannot synthesize PASS, and does not block live authorization.

## 6. Independent tests

- Focused command: `node --test test/acceptance/g1-svf2-f1-f8-verification*.test.mjs`
  - **646 total / 646 pass / 0 fail / 0 todo**, exit 0.
- Aggregate command: `npm run test:offline`
  - **4233 total / 4232 pass / 0 fail / 1 existing todo**, exit 0.
- The unchanged timing-sensitive `test/query/ContainmentModeQuery.test.mjs:64-85` passed within this aggregate run and has no working-tree diff.

Claude's two earlier clean aggregate runs do not weaken the evidence: they were offline, made no live attempt, and the result is independently reproduced here with one additional aggregate run. No retry was requested or used merely to increase confidence.

## 7. Scope and authorization

- Branch / HEAD verified as `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088`.
- No live F1–F8 rerun occurred during remediation or this review.
- No diff exists under production `collision/`, `clashtest/`, `clashpanel/`, or `wwwroot/`; no G2/G3, host H1/H2, OQ-1, host integration, Core, Viewer Adapter, M4, or Panel production work was introduced.
- Current action authorized by the review request is complete. Live F1–F8 remains unauthorized.

**Recommended next owner action:** authorize commit/clean-tree closeout of the accepted F1/F5 harness, tests, evidence, reviews, and handoff set. After the resulting clean repository state is independently verified, the owner may separately consider a fresh exactly-one live F1–F8 authorization.

