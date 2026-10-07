# D-V6 Architecture Planning and Self-clash Runtime — Targeted Independent Work Review

**Date:** 2026-10-07  
**Role:** Independent Work reviewer  
**Scope:** Current handoff's §15 D-V6 implementation/evidence and Architecture whole-model self-clash readiness  
**Verdict:** **D-V6 code correction accepted at implementation level; package not checkpoint-ready**  
**Findings:** **0 Critical / 2 High / 0 Medium / 1 Low**

## 1. Repository and review boundary

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `main`
- **HEAD:** `dcdab38a9808ba8c45b1a89181f2fa9871a08c3f`
- **Origin relation:** `main == origin/main`
- **Working tree:** dirty and uncommitted. Before this review it contained the D-V6 source/test changes, the upstream final-report and handoff edits, and the untracked headed evidence directory. This review adds only this independent review and updates the handoff. Nothing was committed or pushed.
- **Upstream input, reviewed read-only:** `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md` §15.

This review does not reopen M1/M2, G1, G2, C6/C8, reflected-fragment work, M3, or the upstream final report. No live run was repeated.

## 2. D-V6 implementation adjudication

### Narrow behavior is correct

`clashtest/viewer/ViewerElementEnumerator.js:145-158` now permits exactly a tree-reachable population record satisfying `rec.cls === 'N' && rec.nullGeometry === true`. It marks that fragment reachable, skips the owner comparison that cannot be made for the class-N row, and continues. The remaining fail-closed boundaries are intact:

- tree-reachable class N with a real geometry id still throws `tree-reachable-fragment-unattributable`;
- tree-reachable class U still throws;
- a fragment outside the population still throws;
- population and root-subtree digests continue to include the fragment through their existing encodings; no digest function or persisted shape changed;
- no collision-library, Core-engine, threshold, or capacity-limit source changed.

The focused test at `test/clashtest/viewer/resolveRoots.whole.test.mjs:146-173` proves the permitted null-geometry case and the real-geometry negative control. Existing D-V6 tests continue to cover U, ordinary N, out-of-range, deterministic failure, no partial carrier, and recovery on the next call.

### Independent test results

- Viewer Adapter suite: **128/128 pass**.
- Offline suite: **5,350 total / 5,349 pass / 0 fail / 1 existing todo**.
- Panel DOM suite: **95/95 pass**.
- `git diff --check`: clean.

The first offline invocation was invalidated by workspace sandbox restrictions on temporary test files and local sockets. It was rerun once with the repository's normal local permissions and produced the result above. This was not a live Viewer run.

### Headed evidence

All eight PNGs under `docs/research/evidence/2026-10-07-d-v6-headed/` were independently inspected. The six ordered cross-model Hard runs show `Completed`, `Coverage full`, and no `planning:enumeration-failed`, with the reported symmetric clash counts:

| Pair | Clashes | Diagnostics |
|---|---:|---:|
| Architecture → Mechanical | 1,211 | 5,438 |
| Mechanical → Architecture | 1,211 | 5,454 |
| Architecture → Structure | 2,277 | 6,836 |
| Structure → Architecture | 2,277 | 6,842 |
| Structure → Mechanical | 491 | 781 |
| Mechanical → Structure | 491 | 781 |

This is sufficient live evidence that the narrow D-V6 exception removes the Architecture planning failure for the exercised SVF2 models. It does not establish product readiness for the self-clash workflow.

## 3. Findings

### Critical

None.

### High

#### H1 — Architecture whole-model self-clash is a product-performance blocker

**Evidence.** `Architecture-vs-self-in-progress.png` records the normal headed product at **18:04 elapsed**, **67%**, **80/4,294 units**, **3,415 results**, and **35,225 diagnostics**. `Architecture-vs-self-after-stop.png` records a user-stopped run with `Coverage partial`, reason `cancel-requested`, and **4,213 parts not evaluated**. No complete Architecture self-clash result exists.

**Why this blocks readiness.** Architecture self-clash is not an incidental stress case. The accepted Panel design exposes self-clash as a v1 setup control and specifically uses whole-model Architecture self-clash as a concrete v1 scenario (`docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md:220,297`). The frozen Core design defines `A = B = {model X}` as the cell-3b same-model case and explicitly records its unit-count/per-unit overhead as unmeasured OQ-5 (`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:383,1534`).

Successful planning proves only that the D-V6 admission failure is gone. A normal v1 action that remains incomplete after 18 minutes and requires manual cancellation is not product-ready, irrespective of the absence of a predeclared SLO. The observed run is direct evidence that the previously unmeasured same-model decomposition/execution cost is material on the designated Architecture fixture.

**Minimum correction.** Before checkpoint/product-readiness approval, authorize a bounded performance investigation of the Architecture same-model path. It must retain phase/unit timing and unit-shape evidence, identify whether the dominant cost is cell-3b planning, per-unit extraction/digest verification, collision execution, diagnostics, or UI/result processing, and produce an owner-reviewed disposition. Readiness then requires either:

1. a representative Architecture whole-model self-clash completing within an owner-accepted product envelope after a bounded correction; or
2. an explicit owner product decision that narrows/defers/disables that v1 workflow with corresponding design and UI behavior.

This finding does not authorize a Core/planner optimization or another live run.

#### H2 — The implementation changes the frozen D-V6 contract, but the governing documents still require failure

**Evidence.** The implementation accepts tree-reachable null-geometry class-N fragments at `ViewerElementEnumerator.js:153`. The current governing records still say the opposite:

- `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md` erratum A18 says a tree-reachable null-geometry fragment still fails D-V6;
- `docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md` D-V6 says every tree-reachable class N fails planning;
- `clashtest/viewer/README.md:48-49,56-77` says the same case is rejected.

The upstream §15 statement that this is “no spec-contract change” is therefore not correct. The change is narrow and technically coherent, and the report records owner authorization, but it is still a behavioral exception to the frozen fail-closed contract.

**Failure mode.** A future maintainer following the accepted spec/plan/README can “restore” the old rejection and reintroduce the normal-app Architecture failure; conversely, conformance review against the frozen text currently rejects the shipped behavior. The repository has two incompatible authorities for the same input.

**Minimum correction.** Apply one bounded, owner-approved contract reconciliation covering only the tree-reachable `N + nullGeometry:true` exception. The governing spec erratum, Viewer Adapter D-V6 disposition, and adapter README must agree that this exact case is informational while every other class N/U/out-of-range case stays fail-closed. The upstream final report remains read-only to Work.

### Medium

None.

### Low

#### L1 — Retained headed evidence is adequate for this decision but weakly packaged

The evidence directory contains screenshots plus one console text file, with no manifest or structured run record. The console header says `Errors: 0`, while the retained body contains two token-refresh failures represented by four `[ERROR]` entries; it also lacks timestamps capable of proving they were late. The screenshots independently establish the D-V6 planning outcome and the self-clash runtime blocker, so this does not change either High finding. Before a checkpoint, the package should avoid stronger timing/causality claims than the retained artifacts support and should integrity-bind the evidence if it is intended as durable acceptance material.

## 4. Accepted and unaccepted claims

**Accepted:**

- the root cause is the two tree-reachable, intentionally omitted null-geometry SVF2 fragments;
- the source fix is narrowly scoped and preserves the other fail-closed D-V6 cases;
- the exercised cross-model Architecture runs now plan and complete;
- focused, offline, and DOM regression gates are green.

**Not accepted:**

- “no spec-contract change”;
- package/checkpoint or product readiness based on successful planning alone;
- completion, full coverage, or usable runtime for Architecture self-clash;
- a claim that G3/PG-2/PG-3 evidence is wholly unchanged—the run produced partial live engine/Panel measurements, although it does not satisfy or close G3.

## 5. Authorization and next gate

**Review result:** the D-V6 implementation correction is accepted at code level, but the candidate is **not ready for checkpoint authorization** because H1 and H2 remain open.

**Recommended next action:** owner authorization for one bounded remediation stage consisting of (a) D-V6 contract reconciliation and (b) Architecture self-clash performance diagnosis/disposition. A subsequent targeted independent review must verify both before checkpoint readiness can be reconsidered.

**Currently authorized:** this independent review and handoff update only.

**Must not begin without explicit owner authorization:** spec/plan/README remediation, performance instrumentation or optimization, another live run, product-scope narrowing, commit/push, G1/reflection work, G2/C6/C8, G3 acceptance, M3 changes, or any Core/planner change.
