# For Claude — G2 C3/C8/C6 Bounded Remediation Planning Only

I explicitly authorize **one bounded G2 remediation-planning task only** for the findings from the completed exactly-one live G2 attempt.

This task is **planning/investigation design only**.

It does **not** authorize:
- harness changes;
- test changes;
- production/Core/Viewer Adapter/Panel changes;
- procedure changes;
- another live G2 attempt;
- a new authorization record;
- attempt reset;
- G3 or downstream work;
- commit or push.

Use the repository and the preserved immutable live evidence as the source of truth.

## 1. Verify authoritative baseline first

Before planning, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`
- `main == origin/main`
- tracked tree clean
- immutable evidence snapshot exists:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- manifest exists and is internally consistent
- exactly-one live G2 remains closed at:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record was issued after the attempt
- no attempt state was reset
- harness SHA unchanged:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- procedure SHA unchanged:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`

Read at minimum:

- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-04-g2-live-evidence-verdict-independent-review.md`
- `docs/research/evidence/g2-live-20261004-75a3ccb9/MANIFEST.md`
- preserved evidence snapshot
- current harness source relevant to C2/C3/C6/C8/C20
- current product/source code relevant to those checks
- accepted G2 procedure
- governing live plan

If the baseline differs materially, stop and report.

---

## 2. Planning objective

Produce a bounded remediation/investigation plan that addresses only:

- **C3** — proven harness-oracle defect
- **C8** — real frustum-oracle failure with unresolved root cause
- **C6** — correctly `NOT_EVIDENCED`, N2 control non-discriminating
- **C20** — dependency-only consequence of C8; no standalone remediation unless evidence proves otherwise

The output must separate:

1. confirmed defects;
2. unresolved hypotheses;
3. investigation steps;
4. minimum implementation changes that may later be authorized;
5. verification needed before any future live retry could be considered.

Do not implement any of it now.

---

## 3. C3 — proven harness-oracle defect

Independent Work established:

- harness oracle compares dispatched intents against the **names**
  `PANEL_SHOWN` / `PANEL_HIDDEN`
- product dispatches the **values**
  `panel/shown` / `panel/hidden`
- therefore C3 is a deterministic false failure under the current oracle

Plan the minimum correction.

### Required analysis

Inspect the exact C3 implementation and relevant intent constants.

Determine:

- exact faulty comparison;
- intended semantic assertion;
- smallest safe oracle correction;
- whether the oracle should compare:
  - imported constant values;
  - literal canonical values;
  - another stable representation.

Prefer the approach least likely to drift if intent names/values change.

### C2 sibling check

Independent pre-read found the same name/value mismatch pattern in C2's `domainWrites` logic.

Inspect C2 independently.

Determine whether:

- C2 contains the same defect;
- it happened not to fail only because this run did not exercise the bad branch;
- any other C1–C20 check contains the same class of constant-name/value misuse.

Define a bounded static audit for this pattern.

Do not broaden into a general codebase refactor.

### Planning output for C3

Specify:

- exact file/section;
- exact behavioral defect;
- minimum proposed change;
- targeted unit/acceptance tests;
- regression test proving the old bug would fail;
- static sibling audit scope;
- whether procedure/plan changes are unnecessary.

---

## 4. C8 — unresolved frustum failure investigation

The authoritative live evidence established:

- C8 materially failed;
- observed excess approximately:
  `5.858358...`
- threshold:
  `0.0001`
- frozen C8 oracle was applied faithfully;
- retained evidence is insufficient to determine whether the cause was:
  - Viewer/navigation behavior;
  - camera observation/stabilization;
  - coordinate/frustum computation;
  - fixture/model geometry;
  - another timing/state issue.

Do **not** assume the settle-rule hypothesis is proven.

### Required C8 investigation design

Design a diagnostic experiment that can distinguish at least these hypotheses:

#### H1 — Product/navigation defect
The requested operation completes, but final Viewer camera/frustum genuinely leaves the target element outside the required bounds.

#### H2 — Camera-settle observation defect
The harness samples a transient/stale camera because its current "settled" predicate is insufficient.

#### H3 — Frustum/oracle computation defect
The camera is correct, but coordinate conversion, bounding-box interpretation, projection math, tolerance, or viewport basis is wrong.

#### H4 — Fixture expectation defect
The selected element/fixture cannot satisfy the current oracle as defined.

#### H5 — Other asynchronous Viewer state
Navigation command resolves before all camera/viewer state used by the oracle becomes stable.

### Evidence that future diagnostics should retain

The next diagnostic design should require preserving enough state to distinguish these hypotheses, such as:

- camera position
- target
- up vector
- projection mode
- FOV / orthographic scale
- viewport dimensions
- device-pixel ratio if relevant
- target element world bounds
- projected bounds / NDC values
- per-plane frustum distances
- exact failing plane/value
- command start/end timestamps
- camera-changed event timeline
- repeated frame samples
- settle predicate state
- stable-frame count
- Viewer transition/navigation state if exposed
- model/global-offset/placement context if relevant

Use current code/evidence to decide the minimum necessary set.

### Settle-rule investigation

Inspect the current rule that reportedly declares the camera settled after two equal frames.

Determine:

- exact predicate;
- what "equal" means;
- whether equality is position-only or includes target/projection state;
- whether it is tied to the current operation;
- whether Viewer exposes an explicit transition-complete signal that should be considered;
- whether an event-correlated or bounded stability window is more appropriate.

Do not select a new algorithm merely because it sounds better; define competing options and the evidence needed to choose.

### C8 planning output

Specify:

- diagnostic experiment phases;
- what data each phase records;
- pass/fail discrimination between H1–H5;
- offline/unit-testable pieces;
- whether a synthetic camera/frustum fixture should be added;
- what would justify a harness fix versus product investigation;
- what evidence must exist before any future live retry.

---

## 5. C6 — N2 non-discriminating control

The authoritative result is:

`C6 = NOT_EVIDENCED`

because N2 did not discriminate between aggregate and single-model framing.

Do not convert this to PASS or FAIL.

### Required analysis

Inspect:

- C6's intended claim;
- N2's intended negative/control behavior;
- actual live evidence for positive and N2 cases;
- why both outcomes were effectively indistinguishable.

Determine whether the issue is:

- fixture selection;
- camera state shared with C8;
- insufficiently separated expected outcomes;
- control oracle design;
- model geometry/scale;
- another cause.

### Control redesign planning

Design a control that is mechanically capable of discriminating the claim.

The plan should define:

- what observable must differ;
- minimum expected separation/margin;
- fail-closed behavior if the control is again non-discriminating;
- whether fixture changes are necessary;
- whether this can be proven offline before any live run.

### C6 planning output

Specify:

- exact control-design gap;
- candidate control strategies;
- preferred strategy only if evidence supports one;
- offline validation needed;
- future live evidence required;
- whether C6 could still cap overall G2 at PARTIAL even after C3/C8 correction.

---

## 6. C20 — dependency-only consequence

Current authoritative disposition:

- C20 was BLOCKED because C8 failed;
- C20 never ran;
- no screenshots/rendering evidence existed.

Treat C20 as derivative unless investigation reveals a separate issue.

Plan only:

- what must become true in C8 for C20 to execute;
- whether any additional C20 preconditions need offline verification;
- what evidence should be captured once it is allowed to run.

Do not create a separate C20 remediation workstream without evidence.

---

## 7. Cross-cutting harness audit

Perform a bounded static audit for defect patterns directly related to the live findings.

At minimum inspect for:

- constant-name vs constant-value comparison errors similar to C3;
- camera-settle helpers reused by C6/C8/C20;
- duplicated or divergent frustum/projection utilities;
- control/check pairs sharing hidden state that defeats discrimination;
- evidence omissions that prevented root-cause attribution.

Keep scope restricted to code paths relevant to C2/C3/C6/C8/C20.

Do not turn this into a broad harness rewrite.

---

## 8. Remediation ordering

Propose an explicit order.

A reasonable structure to evaluate:

### Phase A — deterministic offline correctness
- C3 oracle correction design
- C2/sibling audit
- targeted tests
- C6 control-design offline proof
- C8 math/oracle unit tests

### Phase B — diagnostic instrumentation design
- additional camera/frustum evidence
- settle timeline
- control discriminators

### Phase C — implementation authorization gate
Only after independent review of this plan.

### Phase D — offline verification
No live attempt.

### Phase E — independent review
Decide whether a future live retry is technically justified.

### Phase F — new record + owner-authorized retry
Only if explicitly authorized later.

Do not assume this exact sequence; refine it based on repository evidence.

---

## 9. Future retry criteria

Define objective criteria that must all be met before anyone may even request another live G2 attempt.

At minimum consider:

- C3 deterministic defect fixed and regression-tested;
- C2/sibling audit clean;
- C8 root cause either fixed or diagnostic ambiguity materially reduced;
- C8 future evidence captures settled camera state;
- C6 N2 control proven discriminating offline;
- C20 prerequisites validated;
- all focused/offline suites pass;
- independent Work review accepts remediation;
- clean checkpoint commit/push;
- new authorization record bound to that new HEAD;
- explicit owner authorization for exactly one new live attempt.

No retry is authorized by this planning task.

---

## 10. Evidence preservation remains immutable

Do not modify:

`docs/research/evidence/g2-live-20261004-75a3ccb9/`

Treat it as historical authoritative evidence.

Do not replace the FAIL result with a revised interpretation.

The remediation plan must cite/use the preserved evidence without rewriting it.

---

## 11. Planning artifact

Persist the bounded remediation plan under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`

If repository conventions prefer `docs/superpowers/plans/` for implementation plans, keep this artifact in `docs/research/` because this task is still investigation/remediation planning rather than implementation authorization.

Clearly label:

- confirmed findings;
- hypotheses;
- proposed diagnostics;
- candidate corrections;
- non-goals;
- retry gates.

---

## 12. Focused internal review

Perform one focused internal review of the remediation plan.

Review:

- C3 defect correctness;
- C2 sibling audit scope;
- C8 hypothesis separation quality;
- C8 evidence-capture sufficiency;
- C6 control discrimination design;
- C20 dependency handling;
- scope discipline;
- retry gate strictness;
- whether any proposed change silently alters the accepted procedure.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High planning defects within planning scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

---

## 13. Handoff requirements

Update the handoff to state:

- G2 exactly-one live attempt remains closed at `FAIL (row 3)`;
- immutable evidence checkpoint:
  `6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`
- C3 confirmed harness-oracle defect;
- C8 materially failed but root cause remains unresolved;
- C6 remains `NOT_EVIDENCED`;
- C20 derivative BLOCKED;
- bounded remediation plan status;
- no implementation is authorized;
- no retry/new record is authorized;
- next action:
  **independent Work review of the bounded remediation plan**.

Do not imply implementation or retry authorization.

---

## 14. Commit policy

Do not commit or push.

Leave the planning artifact, internal review, and handoff update uncommitted for independent Work review.

---

## 15. Stop gate

Stop after:

- bounded remediation/investigation plan;
- focused internal review;
- handoff update.

Do not:

- modify harness/tests/production/procedure;
- implement C3/C8/C6 fixes;
- rerun live G2;
- issue a new authorization record;
- reset attempt state;
- start G3/downstream work;
- commit;
- push.

Next gate:

**Independent Work review of G2 C3/C8/C6 bounded remediation plan → owner decision on whether to authorize remediation implementation**

## Final report

Report:

- branch / HEAD / origin relation;
- planning artifact path;
- C3 proposed correction scope;
- C2/sibling audit scope;
- C8 hypothesis matrix / diagnostic design;
- C6 control redesign plan;
- C20 disposition;
- proposed remediation order;
- objective future-retry criteria;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no implementation change occurred;
- no retry occurred;
- no new authorization record was issued;
- preserved live evidence remained unchanged;
- no commit;
- no push.
