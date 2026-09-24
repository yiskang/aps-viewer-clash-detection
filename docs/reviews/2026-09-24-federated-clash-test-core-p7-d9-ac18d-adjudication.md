# D-9 adjudication — is AC-18(d)'s "single call" normative?

**Date:** 2026-09-24
**Branch / HEAD at adjudication:** `feature/federated-clash-test-core-engine` @ `ba46e66`
**Type:** targeted, read-only adjudication of owner note D-9 (from `docs/reviews/2026-09-24-federated-clash-test-core-p7-acceptance-run.md` l.128, l.176). No spec, plan, production, test or handoff file was edited. Everything under "Proposed wording" is a **proposal only**.
**Owner question:** Is AC-18(d)'s literal "single call" normative, or only a test mechanism for the whole-model-target isolation invariant of §6.4 item 3?
**Second opinion:** one `codex-advisor` (medium) consultation. Its result is recorded in §6.

---

## 1. Verbatim sources

Spec file: `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md` (below, "spec").

**AC-18(d), spec l.1495:**
> **(d) Diagnostic stress (T2, real `CollisionWorld` with mock models):** a federation of many target models whose whole-model extraction emits thousands of `fragment-not-loaded`/`fragment-owner-unresolvable` diagnostics; the recording fake world asserts that **no single call's `targets` exceed the per-unit caps**; the executor records, per unit, the raw diagnostic count received from the library and the outcome's retained size, and the test asserts the count is ≤ the unit's own (source + target) fragment weight plus the library's per-call budgets and that projection stays within `maxDiagnosticsPerOutcome`; a **negative control** (caps set to their ceilings, all target models in one unit) shows the un-sliced call receives a diagnostic volume proportional to the whole federation — documenting the fan-out the caps prevent. The spec asserts no absolute raw-diagnostic bound; this test *measures* it.

AC-18's heading, same line: "**Target fan-out bounded before the first call (H2, §6.4).**"

**§6.4 item 3, spec l.393 (extract):**
> **Slicing.** Target entries are taken in ascending `modelKey` order and packed greedily into target slices. An **explicit-root** entry whose weight exceeds the remaining room is cut **between roots** […]. A **whole-model sentinel** is not partitionable (partitioning it would change extraction semantics, §6.4 split order): it is placed alone in a slice. […] (The *source* side is deliberately different: […] Source size drives latency, an operational lever; target size drives the diagnostic/memory fan-out this section exists to bound.)

**§6.4 target-side bounds lead-in, spec l.389 (rationale):**
> The library accumulates whole-model diagnostics and extracts every target of a call before anything can be projected or capped (F1, F12 […]), so a target-heavy unit would allocate and run in proportion to the whole federation no matter how small its source side is. The planner therefore slices the **target side** deterministically […]

**§6.4 item 5, spec l.395 (what AC-18 is *for*):**
> […] the spec asserts no numeric bound on raw in-call diagnostics beyond "proportional to the unit's caps and the library budgets" and requires AC-18 to measure a target-heavy unit's raw diagnostic count and peak retained size rather than assume them.

**Caps and ceilings:** spec l.1223–1224 (`maxTargetModelsPerUnit` 4, "Bounds per-call extraction fan-out"; `maxTargetFragmentsPerUnit` 20,000, "AC-18 characterizes raw in-call diagnostics/latency at this cap"). §17.1.1 option table: `maxTargetModelsPerUnit` ceiling 64, `maxTargetFragmentsPerUnit` ceiling 100,000.

**Where the controls came from.** Round-7 design review H2, `docs/reviews/2026-09-20-federated-clash-test-and-results-design-review.md` l.37:
> **Minimum design correction:** Introduce deterministic target-side partitioning before the first collision call. Bound target model count and target population per unit, while preserving the current whole-model target sentinel within each call. […] and add a target-heavy diagnostic stress acceptance test.

Spec H2 disposition, l.1691: "AC-18 (exact cover, cap enforcement, negative control, measured diagnostic stress)." `git log -S` shows the §6.4 "placed alone in a slice" rule and AC-18(d)'s "all target models in one unit" control **both entered the spec in the same commit** (`256b092`, rounds 8–9 remediation). No round review records a separate rationale for the control's construction.

**Where the words "one call" / "exactly one" actually appear.** Not in the spec. They appear in the plan:
- `docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md` l.1673 (Step 13): "The same fixture at the **ceilings** (`maxTargetModelsPerUnit: 64`, `maxTargetFragmentsPerUnit: 100_000`) so all six target models land in one unit: assert exactly one recorded `findClashes` call, and that its fragment-scoped diagnostic count is `>=` the sum of the six models' individual sliced counts […]"
- same file l.2030 (AC traceability): "`::negative control: one un-sliced call receives the whole federation's diagnostic volume (AC-18 d)` (one call, volume ≥ the six sliced counts, identical `pairSetDigest` across both cap settings)"
- the controller brief `.superpowers/sdd/p7-engine-integration/task-P7.8-brief.md` l.258 repeats l.1673.

## 2. Code facts

- `clashtest/planning/sizing.js:169–175` (`sliceTargets`): a whole-model entry is either oversize (gap) or `flush(); slices.push([entry])` — alone in its slice at **every** cap value. `test/clashtest/planning/sizing.test.mjs:119` pins this ("a whole-model sentinel is never partitioned: it is placed alone in its slice").
- `collision/CollisionWorld.js:1473–1490`: only the whole-model branch (`extractAllFragments`) pushes extraction diagnostics into `statistics.diagnostics`. The explicit branch (`extractFragments`, `collision/viewer/ViewerModelAdapter.js:62–160`) emits no `fragment-not-loaded`/`fragment-owner-unresolvable` diagnostics. Those come only from `extractAllFragments` (`ViewerModelAdapter.js:245, 255`).
- The F3 test, `test/clashtest/integration/realWorldProvenance.test.mjs`:
  - l.395–439, sliced arm: every call is within `maxTargetModelsPerUnit`/`maxTargetFragmentsPerUnit`; fragment-scoped raw count ≤ source + target weight; projection ≤ `maxDiagnosticsPerOutcome` and exact; sealed accounting exact.
  - l.441–480, negative control:
    - (i) The engine at the ceilings (64 / 100,000) issues 6 one-target calls, with the same `pairSetDigest` and `diagnostics.total` as the sliced arm.
    - (ii) The six-whole-model call is issued **directly** via `fx.world.findClashes` on a fresh real world. It measures 4,800 fragment diagnostics, which is ≥ Σ sliced (800×6) and > the largest sliced call.
- Implementer and reviewer: `task-P7.8b1-report.md` l.137 and `review-P7.8b1.md` l.38. The reviewer's sabotage (packing whole sentinels under the caps) makes control (i) fail, so (i) discriminates a build that breaks §6.4 item 3.

## 3. Analysis

**What invariant AC-18(d) protects.** The heading and §6.4 l.389/l.395 give it: **per-call target fan-out is bounded before the call**. A call's raw in-call diagnostic volume and allocation must scale with its unit's own caps, not with the federation. The engine cannot cap anything inside the call (F12), so the pre-call slicing is the only lever, and AC-18(d) *measures* that the lever works. This is a volume/isolation invariant. It is not about ordering or dedup. The run-level dedup/accounting assertions in the sliced arm are supporting checks on §12.4, not the purpose of (d).

**The engine-behavior requirements in (d).** Three clauses constrain the engine:
1. "no single call's `targets` exceed the per-unit caps";
2. the per-unit raw count is ≤ the unit's (source + target) weight plus the library's per-call budgets;
3. projection stays within `maxDiagnosticsPerOutcome`.

All three are about **the sliced (normal) behavior**.

**The negative control is a description of the test's construction.** It is introduced as "a **negative control**", and its stated output is "documenting the fan-out the caps prevent". It describes a counterfactual: the call the caps exist to *prevent*. A control that the engine is *required* to be able to issue would contradict clause 1's purpose. Its parenthetical, "(caps set to their ceilings, all target models in one unit)", says how to reach the un-sliced call. It sets no obligation on the engine. The literal phrase "single call / exactly one call" is not in the spec at all. It is plan text (l.1673, l.2030, brief l.258) that turned the spec's construction hint into an assertion.

**Can the engine ever make that call?** Not for the federation (d) describes. That federation is "many target models whose **whole-model extraction** emits thousands of […] diagnostics", so its target entries are whole-model sentinels. §6.4 item 3 places each of them alone in a slice at any cap value, including the ceilings. So "all target models in one unit" cannot be planned by a §6.4-conformant engine. A build that did plan it would be violating §6.4 item 3, and the reviewer's sabotage shows the current test catches exactly that. Explicit-root targets *could* be packed into one unit at the ceilings (≤ 64 models, ≤ 100,000 weight). But they emit no N/U storm, so an explicit-root control would measure nothing that (d) is about. The literal engine-level reading is therefore **unsatisfiable together with §6.4 item 3** for the only federation shape that makes (d) meaningful. Reading it as normative would put AC-18(d) in contradiction with a normative spec section. Under the ordinary rule that an acceptance criterion's construction note yields to the normative section it tests, the reading that stays consistent is the test-mechanism one.

**Does the current F3 satisfy the intent?**
- The sliced arm covers the three normative clauses.
- Control (ii) issues the un-sliced call the caps and the sentinel rule prevent, against the same real `CollisionWorld` library. It shows the volume is the whole federation's: 4,800, versus 800 per sliced call.
- Control (i) runs the engine at the literal ceilings. It shows the engine still isolates each whole-model target and that coverage (`pairSetDigest`) is unchanged.

Together they document the prevented fan-out, which is the point of the AC. What they do not do is show that *the engine's caps alone* turn the fan-out on or off. For whole-model targets the sentinel rule, not the caps, is what isolates them. The spec's own premise that the caps "prevent" this fan-out is therefore slightly imprecise for whole-model federations. For whole-model targets, the cap that binds in practice is `maxTargetModelsPerUnit` = 1-per-slice, as imposed by item 3. That imprecision is editorial, not a correctness contradiction.

## 4. Verdict

**A — "single call" is a test mechanism.** The invariant is per-call target fan-out isolation (bounded before the call; §6.4 items 3–5, H2). The current F3 satisfies AC-18(d)'s intent: 6 one-target engine calls at the ceilings, plus a direct un-sliced library control. The literal "exactly one recorded `findClashes` call" is plan wording that §6.4 item 3 makes unsatisfiable for a whole-model federation. The plan text needs a wording erratum. For the spec, a clarifying (non-behavioral) erratum to AC-18(d)'s control wording is recommended but not required for the gate (§5, §6).

**Confidence:** high (≈ 85–90 %).

**What would change this verdict:**
- A recorded owner or round-review statement that the control was meant to exercise the **engine** at its ceilings with a packable (explicit-root) federation. That would be B: a spec-internal conflict needing a spec erratum to (d)'s federation description.
- Evidence that the spec intended whole-model sentinels to be packable up to the caps, i.e. that "placed alone in a slice" was itself the error. That would also be B, but in the other direction (an erratum to §6.4 item 3 and `sizing.js`). Nothing supports this: H2's minimum correction explicitly preserves the whole-model sentinel per call, and the sentinel-alone rule is pinned in P3.
- A demonstration that the direct call in (ii) measures something materially different from what an engine-issued un-sliced call would receive. None is known: it is the same library method on the same real world with the same target entries.

## 5. Proposed wording (PROPOSAL ONLY — not applied)

**Plan, required for consistency with the accepted reading:**

1. `docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md` l.1673. Replace "so all six target models land in one unit: assert exactly one recorded `findClashes` call, and that its fragment-scoped diagnostic count is `>=` the sum …" with:
   > (i) the engine at the ceilings still issues one call per whole-model target — §6.4 item 3 places each whole-model sentinel alone in its slice at any cap — so assert `calls.length === 6`, every call carries exactly one target, and `pairSetDigest`/`diagnostics.total` equal the sliced arm; (ii) the un-sliced call the caps and the sentinel rule prevent is issued **directly** against a fresh real `CollisionWorld` (one source, all six whole-model targets): assert its fragment-scoped diagnostic count is `>=` the sum of the six sliced counts and `>` the largest.
2. Same file, l.2030, AC-18 row. Replace "(one call, volume ≥ the six sliced counts, identical `pairSetDigest` across both cap settings)" with:
   > (engine at the ceilings: one call per whole-model target, identical `pairSetDigest` and diagnostic total; direct un-sliced library call: volume ≥ the six sliced counts)
3. `.superpowers/sdd/p7-engine-integration/task-P7.8-brief.md` l.258: this is a working brief, not an authority. Mirror (1) only if the brief is kept in sync.

**Spec, recommended clarifying erratum (editorial; it does not change engine behavior).** This was upgraded from "optional" after the Codex read (§6). The reason: AC text sits in the acceptance table, and a reader can reasonably take its construction as normative. In spec l.1495, AC-18(d), replace "a **negative control** (caps set to their ceilings, all target models in one unit) shows the un-sliced call receives a diagnostic volume proportional to the whole federation — documenting the fan-out the caps prevent." with:
> a **negative control** that bypasses the planner issues one real `CollisionWorld.findClashes` call carrying every target whole-model sentinel (a call §6.4 item 3 never plans) and shows it receives at least the federation's aggregate diagnostic volume — documenting the fan-out the target-side slicing prevents; an engine run at the option ceilings stays sliced per §6.4 item 3 and preserves coverage and `pairSetDigest`.

This also replaces "proportional to" with "at least the aggregate", which is what the test actually asserts (`unsliced >= slicedSum`). If the owner wants proportionality itself proven, the alternative is a scaling arm (for example 1, 3 and 6 target models with exact expected counts). That would be a test addition, and it is not proposed here.

**Not proposed:** no change to §6.4 item 3, `sizing.js`, or the F3 test.

## 6. Independent read (codex-advisor, medium)

Request `20260924-182204-18013-13084` (`.codex-worker/responses/…/response.md`). Codex independently checked `sizing.js:169`, `ViewerModelAdapter.js:62/245/255` and `CollisionWorld.js:1473`.

- **It agrees with the substance.** A conforming engine must isolate whole-model sentinels. The six-model call is a library-level control, not required engine behavior. "No engine-plannable target representation can both combine the six models and produce this storm." F3 "substantially satisfies the intended control". Allowing packed whole-model sentinels would weaken the H2 remediation and is not justified.
- **Its label is C, not A.** "The engine invariant is A, but the spec's AC-18(d) wording still needs a clarifying erratum." It argues acceptance-table text is normative, so leaving the literal fixture in place is unsafe.
- **Its other points.**
  - `>= sum` is adequate for the H2 safety argument, but it does not prove proportionality. It recommends rewording to "at least the aggregate volume".
  - No formal precedence rule between design clauses and AC text is recorded in the repo.
  - "Peak retained size" at heap level is unverified and belongs to performance characterization.

**Reconciliation.** Codex and this adjudication agree on every factual and behavioral point. The difference is only whether the spec clarification is optional or required. This adjudication keeps **A**, which is the owner's option that matches the finding: test mechanism, invariant = isolation, F3 satisfies intent. It adopts Codex's point by upgrading the spec erratum in §5 from "optional" to "recommended" and by adopting its "at least the aggregate" wording. Because the difference is about how strongly to recommend the edit, not about the gate verdict, it is not recorded as a blocking disagreement. The owner decides whether to apply the §5 spec and plan text.

## 7. Remaining concerns (outside the verdict)

- **"Retained size" not asserted.** (d) says the executor "records, per unit, the raw diagnostic count … and the outcome's retained size". The F3 sliced arm records the raw count and projected count via `t.diagnostic`. It does not record a retained-size measure (bytes) per outcome. §6.4 item 5 also names "peak retained size". This is a measurement/characterization gap, not part of D-9. Classification: verification/calibration gate. It should be dispositioned by the owner alongside AC-18(e).
- **Proportionality is not proven.** The control asserts `>=` the aggregate and `>` the maximum. It does not show scaling across federation sizes. This is adequate for the H2 argument, and the §5 wording aligns the AC with it.
- **Caps vs the sentinel rule.** As noted in §3, for whole-model federations it is §6.4 item 3, not the caps, that isolates targets. So AC-18(d)'s "fan-out the caps prevent" is loosely worded. Editorial only.
