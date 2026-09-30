# For Claude — G2 Harness Implementation Only

I explicitly authorize **G2 harness implementation and offline/non-live verification only** for the Viewer Clash Panel milestone.

This is the first implementation phase after the accepted G2 procedure baseline.

It does **not** authorize:

- live G2 execution;
- any live real-Viewer failure injection;
- G3;
- H1/H2 host integration;
- OQ-1;
- production host composition;
- Core / Viewer Adapter / M4 production changes;
- unrelated Viewer Clash Panel production changes;
- any new milestone.

The authoritative baseline is the accepted and pushed G2 procedure/owner-decision closeout.

## 1. Repository baseline

Before implementation:

1. Verify the repository in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`
   - latest authoritative G2 independent review
   - latest relevant G2 internal review
   - governing Viewer Clash Panel design and implementation plan
3. Verify:
   - branch: `main`
   - `main == origin/main`
   - expected baseline HEAD: `82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0`
   - working tree clean
   - G2 procedure review cycle closed
   - D1/D2/D4/D7 accepted
   - D3/D5 technically accepted
   - D6 deferred/non-blocking
   - no live G2 authorization exists

Treat repository artifacts as authoritative.

If the baseline differs materially, stop and report before implementing.

---

# 2. Authorized implementation target

Implement the G2 harness specified by the accepted procedure.

Expected harness location:

`test/acceptance/clashpanel-viewerbridge.acceptance.mjs`

Implement only what the accepted procedure requires.

Do not redesign the procedure during implementation.

If implementation reveals a contradiction or an impossible requirement, preserve the evidence and stop for review instead of silently changing the contract.

---

# 3. Required scope

Implement the harness infrastructure necessary to support the accepted G2 checks and controls, including the procedure-defined:

- C1–C20 checks;
- negative controls N1–N8;
- two-model fixture handling;
- evidence schema;
- attempt/reservation journal;
- R1/R2/R3 closeout artifacts;
- exact-name authoritative `K` commit model;
- pre-closeout / pre-link verdict phases;
- final synchronous non-yielding gate → `fs.linkSync(Kc, K)` critical block;
- fail-closed reader;
- timeout/deadline accounting;
- crash-safe reservation semantics;
- model A / model B cleanup;
- Panel-owned vs foreign scene ownership checks;
- C20 rendering evidence plumbing;
- bounded failure-injection hooks required by D4;
- offline/static tests required by the procedure.

Use:

- `Audubon_Mechanical_clash_test.rvt`
- `Audubon_Structure_clash_test.rvt`

as the configured G2 fixture pair per D1.

Do not perform the actual live load/run in this task.

---

# 4. D4 failure-injection boundary

D4 is accepted **as a harness design technique only**.

You may implement bounded failure-injection hooks required by the procedure.

You may verify them offline with mocks/fakes where possible.

You must **not execute real-Viewer live failure injection** in this task.

Any path that requires live Viewer behavior must remain dormant until separate live-execution authorization.

---

# 5. D2 closeout implementation requirements

Implement the accepted D2 protocol exactly.

## Attempt/reservation durability

Preserve the reviewed ordering and local-POSIX assumptions.

Implement the procedure-defined:

- attempts/results directory creation;
- required directory and parent-directory `fsync`;
- atomic reservation creation;
- `AUTH_BOUND`;
- `ATTEMPT_CONSUMED`;
- consumed-attempt reuse prevention;
- crash/orphan handling.

Do not weaken any fail-closed behavior.

## Verdict phases

Operational phases are:

- `pre-closeout`
- `pre-link`

There is no operational `final` compute phase.

`closeoutComplete` is post-K only.

## R1/R2/R3

Implement the acyclic evidence chain exactly as specified.

Preserve:

- R1 frozen snapshot;
- allowed/forbidden key rules;
- byte-equal reserialization check;
- immutable downstream hashing;
- no future facts leaking into earlier artifacts.

## Authoritative K commit

Implement the final PASS commit as the accepted synchronous non-yielding block.

Requirements include:

- final eligibility gate;
- no `await`;
- no Promise boundary;
- no timer;
- no timeout wrapper;
- no callback dispatch between gate and syscall;
- synchronous `fs.linkSync(Kc, K)`;
- no async `link`;
- no `Promise.race`;
- after successful K commit, nothing may change verdict or exit code.

Preserve the dedicated macrotask/quiescence rules from the procedure.

`K` remains the sole verdict-authoritative PASS record.

---

# 6. Required static/offline safeguards

Implement the procedure-required non-live verification for the critical gate.

At minimum include tests capable of detecting:

- accidental `await` in the final gate→K block;
- Promise/timer/callback insertion into that block;
- replacement of `fs.linkSync` with async `link`;
- timeout-wrapped commit;
- post-K verdict mutation;
- illegal pre-K read of `closeoutComplete`;
- reintroduction of an operational `final` compute phase.

Implement the specified:

- AST-level whitelist/static guard;
- throwing `closeoutComplete` getter test;
- real-Node filesystem integration tests that do **not** involve APS Viewer;
- async-link negative control;
- reader truth-table tests;
- reservation/concurrency tests;
- R1 immutability tests;
- N6 property/boundary tests including:
  - `2^897` N6 domain;
  - distinct C4 `2^900` domain;
  - just-in-range;
  - just-out-of-range;
  - thin/degenerate bounds;
  - ±Infinity;
  - NaN;
  - invalid inputs cannot count as N6 detected.

These offline tests are authorized.

---

# 7. Viewer-facing implementation constraints

Implement only the harness-side adapters/wiring needed to exercise the already-existing ViewerBridge and DockingPanel behavior.

Do not change production ViewerBridge/Panel code to make the harness pass.

Preserve:

- markers-only v1;
- zero Panel theming calls;
- C7/C18 Panel-owned vs foreign scene ownership;
- guarded isolation only;
- selection/model-departure at bridge boundary;
- C2 real DockingPanel title lookup;
- C4 containment semantics;
- C17 V0–V7/N7 semantics;
- C20 positive-evidence rendering oracle;
- missing/ambiguous C20 evidence => `NOT_EVIDENCED`;
- G2 cannot PASS while C20 remains unevidenced.

If a live-only behavior cannot be validated offline, implement the harness path and mark it pending live execution; do not fabricate evidence.

---

# 8. C20 implementation

Implement C20 exactly to the accepted bounded contract.

Preserve:

- verdict-bearing positive-evidence role;
- PASS-granting rendering constants/capture budget accepted under D7;
- retained evidence sufficient for independent recomputation;
- N8 negative-control machinery;
- `NOT_EVIDENCED` fallback when rendering cannot be established.

Do not tune constants during implementation.

Do not execute C20 against the live Viewer in this task.

---

# 9. No live APS/Viewer execution

This task must not consume live G2 authorization because none exists.

Do not:

- load the G2 fixtures in Autodesk Viewer;
- run `AutodeskProduction2` / `streamingV2` live acceptance;
- perform real ViewerBridge/DockingPanel acceptance;
- execute real-Viewer failure injection;
- create live result JSON claiming G2 verdict;
- consume the exactly-one live attempt.

Offline Node/unit/static/mock tests are allowed.

If any test command would launch the live acceptance harness, do not run it.

---

# 10. Verification

Run all relevant offline/non-live tests required to review the implementation.

At minimum verify:

- syntax/module loading;
- AST/static safeguards;
- filesystem/journal integration tests;
- reader truth table;
- closeout protocol tests;
- reservation/concurrency tests;
- R1 freeze tests;
- N6 property/boundary tests;
- any existing unit/DOM tests materially affected by the harness implementation.

Do not run live G2.

Report exact commands and results.

If unrelated existing failures appear, distinguish them from G2 harness regressions.

---

# 11. Independent internal review

After implementation and offline verification:

1. Perform one focused internal implementation review.
2. Review against the accepted G2 procedure line-by-line where relevant.
3. Classify Critical / High / Medium / Low findings.
4. Fix genuine Critical/High implementation defects within the authorized harness scope.
5. Do not change production code to close harness findings.
6. Do not run live G2 after fixing them.

Persist the internal implementation review under `docs/reviews/`.

If fixes after review are substantial or touch critical D2/K semantics, note that they require independent Work review and do not self-authorize live execution.

---

# 12. Handoff

Update `docs/handoffs/latest.md` with:

- repository / branch / HEAD / working tree;
- G2 procedure baseline;
- G2 harness implementation status;
- offline verification results;
- internal review artifact;
- unresolved implementation findings;
- live execution status: not authorized / not run;
- next authorized action: none / awaiting independent Work implementation review;
- G3/H1/H2/OQ-1/host remain unauthorized.

Do not mark G2 itself PASS/PARTIAL/FAIL because no live run occurred.

---

# 13. Commit policy

Implementation and offline verification are authorized.

After the harness implementation and documentation are complete:

- do **not** commit or push unless separately authorized.

Leave the complete implementation/review/handoff state available for independent Work review.

If repository convention or governing plan explicitly requires a commit before implementation review, stop and report that requirement rather than assuming authorization.

---

# Stop gate

Stop after:

- G2 harness implementation;
- offline/non-live verification;
- internal implementation review;
- handoff update.

Do not:

- run live G2;
- execute real-Viewer failure injection;
- start G3;
- start H1/H2;
- start OQ-1;
- start host integration;
- modify unrelated production code;
- commit/push unless separately authorized.

The next gate is:

**independent ChatGPT Work review of the G2 harness implementation → owner decision on commit and live-execution authorization**

---

# Final report

Report:

- branch / HEAD;
- working-tree state;
- files created/modified;
- harness architecture;
- implementation coverage of C1–C20 and N1–N8;
- D2 journal/closeout implementation;
- final gate→`fs.linkSync` safeguards;
- offline/static/integration tests run and results;
- C20 implementation status;
- failure-injection implementation status;
- internal review findings/fixes;
- remaining verification gaps;
- exact confirmation that:
  - no live G2 execution occurred;
  - no live failure injection occurred;
  - no G3/H1/H2/OQ-1/host work started;
  - nothing was committed or pushed.
