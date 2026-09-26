# Viewer Clash Panel implementation-plan remediation — bounded independent re-review

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `6a55b5040369d07b67f09fe31153c55eadf5694f` (`origin/main` identical)
- **Plan:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
- **Scope:** the H1, H2, M1, L1 and L2 remediation only, plus directly affected cross-references
- **Owner dispositions supplied for this gate:** OD-1(a) top-level `clashpanel/`; OD-7(a) replace on new-run start, admission-first, retaining the planned confirmed-discard single-slot exception
- **Verdict:** **one bounded plan correction remains before implementation authorization**
- **Findings:** 0 Critical / 0 High / 1 Medium / 0 Low

No production code, Panel implementation, SVF2 verification, OQ-1, host integration, Core, Viewer Adapter or M4 work was started.

## Finding

### Medium — Task 27 changes the default test prerequisite but leaves the repository test instructions stale

- **Plan locations:** repository finding 8; Task 27 Files/Scope/Step 3; Task 32 README; Task 33.
- **Repository locations:** `test/README.md` “Running tests”; `test/acceptance/README.md` “First-time setup” and the acceptance-script “Not part of npm test” notes.
- **Issue:** after Task 27, `npm test` is no longer just `scripts/run-tests.mjs` and no longer browser-free. It runs the offline suite followed by the Panel DOM suite and therefore requires Playwright Chromium. `test/README.md` explicitly describes the old command path. `test/acceptance/README.md` correctly says the named live acceptance scripts are not part of `npm test`, but it does not distinguish those excluded live scripts from the new fake/injected-port Panel DOM suite that is part of `npm test`; read together with its browser setup being framed around live acceptance, the default prerequisite is ambiguous. The plan notices this and deliberately leaves both files outside its edit scope, so the checkpoint would commit an operationally stale test contract.
- **Concrete minimum correction:** add both READMEs to Task 27's Modify list and commit boundary. Update `test/README.md` to state that `npm test` is the canonical aggregate gate (`test:offline` then `test:clashpanel:dom`), requires the installed Playwright Chromium, and that `npm run test:offline` is the browser-free command. Update `test/acceptance/README.md` to preserve the statement that live acceptance scripts are excluded while explicitly distinguishing the default-gate Panel DOM suite (fake Viewer/DockingPanel, no credentials/server/network) and pointing to the same Chromium installation prerequisite. Add a simple Step 4 text check or manual inspection for these exact distinctions; update Task 33's expected documentation scope.
- **Classification:** implementation-plan documentation/operability requirement. It does not alter architecture, production behavior, SVF2 scope or test mechanics.

## Verification of the prior High finding H1

**Closed.** T11, T17 and T19 form a fail-closed chain:

- T11 `emptyStatement` emits claim/qualified-claim wording only for `claim.allowed === true` and `freshness.state === 'current'`. A missing half is pending; stale/unverifiable freshness and denied/missing claims produce non-claim wording.
- T17 withdraws a held claim synchronously when rechecking, treats freshness and claim as one check-local pair, and commits the pair only after both reads settle. Superseded/aborted pairs do not commit. A failed freshness read becomes `unverifiable`; a failed claim read becomes `NO_CLAIM`.
- T19 `claimGateOf` passes the pair to T11 only when both halves are non-null and neither pending flag is set.
- Tests cover claim-first, freshness-first, allowed+stale in both resolution orders, failed claim, failed freshness, synchronous claim withdrawal, superseded reads, and no transient `empty-claim` publication.

No clearance wording can be produced while a read is pending or when either completed result fails the conjunction. The added abort-listener cleanup also bounds the repeated-check lifecycle introduced by this remediation.

## Verification of the prior High finding H2

**Closed mechanically, subject only to the documentation finding above.** Task 27 specifies:

- `test = npm run test:offline && npm run test:clashpanel:dom`;
- `test:offline = node scripts/run-tests.mjs`;
- `test:clashpanel:dom = node scripts/run-dom-tests.mjs`.

The offline `domIsolation.test.mjs` asserts those exact edges, walks the npm-script graph from `test`, rejects a cycle, and verifies both runners spawn `process.execPath` rather than re-entering npm. T27 and every subsequent implementation checkpoint T28–T33 run the aggregate `npm test` gate. T33 repeats both targeted suites and the aggregate gate. Its negative controls require a renderer failure and a missing Chromium installation to make `npm test` exit non-zero. Tasks before T27 remain correctly offline because no DOM suite exists yet.

The plan's scratch results support snippet consistency only: the H2 wiring ran offline 5/5 then DOM 7/7; the deliberately broken DOM assertion and missing-browser controls failed the aggregate gate; a deliberate script cycle was caught. These results remain correctly labelled non-replayable and are not implementation evidence.

## G-OD adjudication

The owner's current dispositions resolve every owner decision that blocks implementation authorization:

- **OD-1(a): resolved** — use top-level `clashpanel/`, matching all T1–T33 paths and the layering guard.
- **OD-7(a): resolved** — replace previous results when a new run starts using admission-first behavior, retaining the confirmed-discard single-slot exception already specified in T9/T16/T20.
- **OD-10(a): safe reversible default** — duplicate the marker helper; no owner decision is required before authorization.
- **OD-13 Part 2(a): safe reversible default** — use “scene units”; no owner decision is required before authorization.
- **OD-12: correctly deferred** — the isolation guard remains in T24/T25; the simultaneous-use product policy is decided before H1/G2/G3 host/live work, not before T1–T33.

The plan register still describes OD-1 and OD-7 as awaiting confirmation because it predates this owner message. That is now historical wording, not an unresolved decision; the handoff and this review are the current decision record. When making the bounded README correction, the plan should also mark OD-1(a)/OD-7(a) owner-approved so the artifact is self-consistent.

## Low remediation verification

- **L1 closed:** all scratch counts are explicitly labelled snippet-consistency evidence only, not independently replayable and not implementation evidence.
- **L2 closed:** gated work now uses “planned by” / “once implemented” / “not yet implemented”; no reviewed section falsely says T1–T33 already exist.

## Gate verdict and authorization

The prior two High findings are closed and all implementation-blocking owner decisions are resolved. The plan is **not yet ready for implementation authorization** only because Task 27 must include the bounded test-documentation correction above (and should record the already-made OD-1(a)/OD-7(a) decisions at the same time). A targeted text-only check of Task 27, Task 33, the owner-decision register and their directly affected cross-references is sufficient afterward; no broad review is required.

Implementation remains unauthorized. SVF2 verification, OQ-1 and host integration also remain unauthorized.
