# For Claude — Bounded G2 Procedure Remediation Only

I explicitly authorize **documentation/procedure remediation only** for the G2 ViewerBridge / DockingPanel live-verification procedure.

This authorization is limited to correcting the latest independent Work findings:

- H1–H5
- M1–M3
- directly affected Low findings / cross-references

It does **not** authorize:
- G2 harness implementation;
- any live G2 execution;
- G3;
- H1/H2 host integration;
- OQ-1;
- production host composition;
- Core / Viewer Adapter / M4 / Viewer Clash Panel production changes;
- any F7 probe or calibration change;
- any next milestone.

Use the latest independent Work review as the governing remediation input.

## H1 — Resolve C7 / C18 scene-ownership contradiction

The procedure currently contradicts itself:

- C7 requires a foreign/pre-existing marker scene to survive Panel disposal;
- C18 requires both Panel scenes to be absent.

Correct the ownership model explicitly.

The procedure must distinguish:

- **Panel-owned scenes/overlays** — must be removed by Panel cleanup/disposal;
- **foreign/pre-existing scenes/overlays** — must remain untouched and must not be removed by Panel cleanup.

Update C7, C18, cleanup requirements, evidence schema, and negative controls so they agree.

The final oracle must be mechanically testable:

- Panel-owned scene exists while needed;
- foreign scene exists before Panel work;
- after Panel cleanup:
  - every Panel-owned scene is absent;
  - the foreign scene is still present and unchanged.

Do not broaden this into theming. v1 remains markers-only and must make zero Panel theming calls.

## H2 — Make verdict precedence fail-first

A real check/control failure must never be downgraded to `BLOCKED`.

Define one exhaustive G2 verdict precedence table.

At minimum:

1. fatal runtime/page/console failure -> `FAIL`
2. unresolved cleanup/ownership failure -> `FAIL`
3. any required C-check failure -> `FAIL`
4. any mandatory negative-control failure -> `FAIL`
5. authorization/journal identity contradiction -> `FAIL`
6. only when no earlier failure exists, unavailable prerequisite/evidence may -> `BLOCKED`
7. non-failing incomplete evidence may -> `PARTIAL`
8. `PASS` only when every required check/control/cleanup/evidence condition is satisfied

Add explicit procedure examples proving:

- C-check FAIL + missing prerequisite => FAIL
- control FAIL + unavailable evidence => FAIL
- cleanup FAIL + unavailable evidence => FAIL
- no failure + unavailable prerequisite => BLOCKED
- all required evidence clean => PASS-eligible

Ensure no later branch can overwrite an earlier FAIL.

## H3 — Define deterministic authorization-record selection and durable binding

The exactly-one-attempt journal must identify **which owner authorization record** licenses the run and bind the attempt to it durably.

Define, before harness implementation:

### Authorization record selection

The live harness must receive or derive one exact authorization artifact using a deterministic rule.

Prefer an explicit artifact path / identifier from the handoff or execution command rather than "latest matching prompt".

The procedure must define:

- accepted authorization artifact type/path;
- required owner-authorization wording;
- how the harness rejects ambiguous or multiple candidate records;
- how stale/superseded authorization is rejected.

### Durable binding

Before live work begins, retain at minimum:

- authorization artifact path/id;
- SHA-256 of its bytes;
- repository HEAD;
- G2 procedure version/hash;
- fixture identity;
- runtime envelope requested;
- unique attempt id;
- journal state transition timestamp.

The attempt journal must become durable **before** the first action that consumes authorization.

A crash after consumption must not silently permit a second run.

Define the journal state machine explicitly, including:

- NOT_STARTED
- AUTH_BOUND
- ATTEMPT_CONSUMED
- COMPLETED / FAILED / CRASHED

or equivalent exhaustive states.

Specify what evidence allows a future reviewer to prove that exactly one attempt was consumed.

## H4 — Correct C4 bounds containment oracle

C4 must not PASS merely because bounds overlap or are numerically close.

Define the actual required relationship from the accepted design/implementation.

If C4 is intended to prove that the ViewerBridge-computed/target bounds contain the fragment union, PASS must require componentwise containment of the full reference fragment-union bounds within the candidate bounds, subject only to the frozen G2 tolerance.

Define:

- reference bounds source;
- candidate bounds source;
- coordinate space;
- transform handling;
- exact containment inequalities;
- tolerance application;
- failure evidence retained;
- a negative control where one bound face is moved beyond tolerance and C4 must FAIL.

Do not invent a looser relation merely to make the check pass.

If the accepted source contract requires a different bounds relation, state and prove that exact contract instead.

## H5 — Give C17 a complete executable oracle

C17 currently lacks a complete PASS/FAIL oracle.

Inspect the governing design/implementation and rewrite C17 so it is mechanically executable.

For C17 define explicitly:

- purpose;
- fixture/setup;
- preconditions;
- exact live action;
- observed Viewer/bridge state;
- PASS condition;
- FAIL condition;
- timeout;
- cleanup/restoration;
- retained evidence fields;
- one non-vacuous negative control.

The oracle must not rely on prose such as "behaves correctly", "works", or "looks restored".

If C17 depends on a state/value not observable within G2 without crossing into G3/H1/H2/OQ-1, mark that dependency explicitly and narrow C17 rather than silently expanding scope.

## M1 — Complete model-B cleanup semantics

Mechanical + Structure is the proposed two-model G2 pair.

Define cleanup/ownership for model B explicitly:

- what G2 loads or assumes already loaded;
- who owns its registration/lifecycle in the test harness;
- what state G2 is allowed to mutate;
- what must be restored;
- what must survive cleanup;
- how unload/stale simulation affects model B;
- how cleanup proves no Panel-owned residue remains for either model.

Do not implement host registration/re-registration or OQ-1 behavior.

## M2 — Classify and freeze G2 numeric thresholds

List every numeric threshold in the procedure.

For each threshold classify it as one of:

- **contract-derived** — backed by existing accepted code/spec;
- **runtime/API-derived** — backed by Viewer/API semantics;
- **calibration assumption** — provisional but explicitly bounded;
- **arbitrary/proposed** — not acceptable for implementation until corrected or frozen by owner/review.

For every threshold record:

- exact value/formula;
- units;
- source/derivation;
- checks that use it;
- whether exceeding it causes FAIL, BLOCKED, or diagnostic-only evidence.

Do not tune thresholds using future live G2 outcomes.

Freeze the corrected threshold table in the procedure before harness implementation.

If a threshold cannot be justified, define the evidence needed to calibrate it and keep the affected check non-PASS-capable rather than inventing a number.

## M3 — Define C2 title-element fallback

C2 currently has an undefined title-element fallback.

Define the exact DOM/title lookup contract:

- primary selector/source;
- accepted fallback(s), if any;
- ordering;
- uniqueness requirement;
- behavior when multiple matches exist;
- behavior when no match exists;
- PASS/FAIL evidence.

The fallback must be deterministic and testable.

Do not rely on visual/manual inspection.

## Low — Bounded repetition / sample wording

Clarify every repeated/sample-based check.

For each, state:

- exact sample/population;
- fixed repetition count, if any;
- why that count exists;
- whether the result is characterization or a gate;
- what conclusion is *not* justified beyond the tested sample.

Avoid vague wording such as "a few", "representative", or "repeat several times" unless the exact rule is defined elsewhere.

## Low — G1 vs G2 F7/F8 naming precision

The G1 and G2 artifacts use F7/F8 for different concepts.

Make the G2 procedure unambiguous.

Prefer names such as:

- `G2-Cx` / `C1–C19`
- "G1 F7 calibration"
- "G1 F8 dbId consistency"

Never write bare `F7` or `F8` where the milestone/gate could be ambiguous.

Do not import G1 evidence into unrelated G2 checks.

## D1–D7 status during remediation

Do not silently resolve owner decisions during this docs-only task.

Preserve Work's classifications:

- D1 — owner/operational: Mechanical + Structure
- D2 — owner acceptance policy: only after corrected fail-first verdict is reviewed
- D3 — technical scope: no foreign-theming seed; zero Panel theming calls
- D4 — owner execution-risk decision: bounded failure injection
- D5 — technical scope: selection/model-departure remain bridge-boundary checks
- D6 — deferred product/integration: OD-12 guard-only; no coexistence test in G2
- D7 — technical/calibration: thresholds must be corrected/frozen before implementation

After remediation, report which items still require explicit owner acceptance before G2 harness implementation.

## Internal review

After editing:

1. Run one targeted internal procedure review over:
   - H1–H5
   - M1–M3
   - Low wording corrections
   - directly affected C-checks, verdict/journal/evidence schema
2. Fix genuine Critical/High findings within this bounded scope.
3. Do not start harness implementation.
4. Update:
   - `docs/reviews/` with the remediation internal review
   - `docs/handoffs/latest.md`

The handoff must state:

- G2 procedure remediation complete;
- G2 harness implementation remains unauthorized;
- G2 live execution remains unauthorized;
- G3/H1/H2/OQ-1/host remain unauthorized;
- next action = bounded independent Work re-review, then owner decisions.

## Stop gate

Stop after procedure remediation and targeted internal review.

Do not:

- write `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- implement any G2 harness;
- run live G2;
- start G3;
- start H1/H2/OQ-1/host integration;
- modify production code;
- commit/push unless separately authorized.

## Final report

Report:

- branch / HEAD / git status;
- exact procedure sections changed;
- H1 scene-ownership correction;
- H2 verdict precedence;
- H3 authorization/journal binding;
- H4 C4 containment oracle;
- H5 C17 oracle;
- model-B cleanup semantics;
- frozen threshold table;
- C2 fallback rule;
- internal review findings/fixes;
- remaining D1–D7 owner decisions;
- explicit confirmation that no G2 harness code or live execution occurred.
