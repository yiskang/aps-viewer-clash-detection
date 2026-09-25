# Federated Clash Test core — P8 remediation focused independent re-review

**Date:** 2026-09-26  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Checkpoint:** `acf347573fcb353bc0197b1e6e46c123fd4e44d6`  
**Review boundary:** `72497d10a4a10d410e9c640931c50b479e300981..acf347573fcb353bc0197b1e6e46c123fd4e44d6`

## Verdict

**PASS for the P8 H1/M1/M2 remediation checkpoint.** This focused re-review found **0 Critical / 0 High / 0 Medium / 0 Low**.

The three owner-authorized corrections are implemented consistently with their recorded rulings and directly affected invariants. This result is an independent-review claim, not P8 acceptance. Under `CLAUDE.md`, it must receive targeted adjudication before the owner may accept P8. No later phase is authorized.

## Scope

Per the repository's convergence rule, this pass reviewed only:

- H1's owner-authorized per-pair clean-proof hardening in `compareResultSets`;
- M1's guarded, descriptor-based, detached capture of derivation option bags, facet specifications, clause objects and their arrays;
- M2's owned JSON operand capture, typed refusal, depth ceiling, expanded-node accounting, shared per-call budget and engine-limit propagation;
- the new regressions and the directly affected ordering, planner-layout, mutation-isolation, resource-bound and public-surface invariants;
- the committed checkpoint boundary and claimed verification results.

It did not restart an unrestricted P8 review, reopen P5, reassess disposed/deferred findings, or reopen the frozen design.

## Findings

None.

## Remediation verification

### H1 — resolved

`cleanProof` now treats `covered-clean` as proof only when the covering unit itself could have evaluated the pair. Ordered modes require the direct source-to-target orientation; unordered modes allow either orientation. In both cases, the source root must belong to the unit's source domain, the target root must belong to the matching explicit or whole-model target domain, and a same-model target root must not also be a source root.

The forged overlap shapes from the original review now fail closed into the unverified classes in both comparison directions and both pair-semantics modes. Positive controls for disjoint, whole-model, multi-root and cross-model scopes continue to prove clean pairs. Real `createPlan`/`planSplit` layouts retain the expected pair space. The change is local to P8 comparison; the accepted P5 status readers and their separately recorded ordered-pair issue were not changed.

### M1 — resolved

`captureClosed` and `captureArray` take one guarded, descriptor-based snapshot before asynchronous work. Symbol keys, non-enumerable keys, accessors, hostile/revoked proxies, sparse/decorated arrays and non-plain bags fail as typed `InvalidOptionsError` cases; accessors and proxy `get` traps are not invoked. The owned copies are the values used by context creation and derivation preparation, so later caller mutation cannot alter execution.

Coverage includes context options and limits, every derivation method's options, group-by facet arrays, filter clause arrays, facet-spec bags and clause bags. Valid ordinary inputs retain their prior behavior.

### M2 — resolved

Filter `eq` and `in` operands are synchronously captured into owned JSON data before the returned promise can observe caller mutation. Cycles, accessors, hostile proxies and non-JSON values produce typed `InvalidOptionsError` results. Container depth 64 is accepted and deeper operands are refused explicitly.

Expanded tree size is memoised over shared DAGs and charged before canonical expansion against one `maxCapturedNodes` budget shared by all operands in a filter call. Exact-budget inputs are accepted, one-over inputs are refused, small shared DAGs preserve tree-value semantics, and exponentially expanding DAGs are rejected without expansion. Engine-bound derivations receive the engine's resolved limit; standalone contexts retain the recorded default. No new public option, exported limit, schema, or persistence obligation was introduced.

The recorded very-large default and host string-size edge remain calibration/resource notes under the owner's existing ruling, not defects in this bounded remediation checkpoint. Tightening them would require a separately authorized limit decision.

## Direct invariant checks

- The comparison proof remains linear in results plus ledger scope construction and does not consult the P5 public status API as its final predicate.
- Closed-option capture is applied consistently at all P8 entry and nested-bag boundaries changed by M1.
- Operand node accounting is exact for trees and shared DAGs, cumulative across clauses, and uses the engine's resolved `maxCapturedNodes` where applicable.
- Valid derivation outputs, deterministic ordering, public exports and P0–P7 behavior outside the one authorized engine-limit hook remain unchanged.
- The frozen design, implementation plans, Result Set schema, persistence layer, planner and P5 result implementation were not modified by this review.

## Verification

Independently run at `acf347573fcb353bc0197b1e6e46c123fd4e44d6` before persisting this review:

- focused H1/M1/M2 and engine-binding files: **188/188 passed**;
- full `node scripts/run-tests.mjs`: **2,848 total / 2,847 passed / 0 failed / 1 todo**;
- the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap;
- an initial sandboxed full run had exactly three `EPERM` failures from M4 spike-server tests opening local ports; the permitted rerun passed all three and the full suite;
- graph coverage metadata was current for all seven changed production files and four focused regression files, with no recorded indexing gaps; source, Git and executed tests remained authoritative;
- checkpoint diff: 14 files, 1,050 insertions and 71 deletions; production scope is six P8 derivation files plus the authorized engine-limit hook, with no spec, plan, schema, planner, P5 result or persistence change.

## Gate result

The P8 remediation checkpoint is ready for targeted adjudication of this review. P8 remains unaccepted until that adjudication and explicit owner acceptance. No phase beyond P8 may begin.
