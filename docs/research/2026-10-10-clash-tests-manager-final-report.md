# Clash Tests Manager (session-scoped v1) — Package Final Report

Date: 2026-10-10

## 1. State
- Repository `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`; branch `main`; HEAD `ea53399` (== `origin/main`).
- Working tree: dirty, **uncommitted, unpushed** (commit/push not authorized). Modified: `clashpanel/{README.md,index.js,core/{controller,index,intents,viewModel}.js,ui/ClashDockingPanel.js}`, 4 existing test files (surface lists only), spec (Task 1 bounded lines + §26 package), handoff. New: 5 core modules, `ui/render/manager.js`, 14 new test files, 3 test support files; plus the plan/spec/review/report documents.
- Protected paths unchanged (`git diff HEAD --stat -- clashtest collision wwwroot server.js routes package.json scripts clashpanel/core/ports.js clashpanel/viewer` empty).

## 2. Authorized scope and governing authority
- Owner authorization (user instruction, 2026-10-10): implement the reviewed 13-task plan task-by-task; no CTM-7/CTM-8; no persistence/history/lifecycle/rebinding/background runs, G2/C6/C8/G3, reflected fragments, R20-1, Core/Adapter/collision; commit/push only if separately authorized.
- Governing: [spec §26](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md); [plan](../superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md) (its DRAFT banner was not edited); final plan review [0C/0H/0M/0L](../reviews/2026-10-10-clash-tests-manager-final-plan-correction-independent-work-review.md); plan report [report](2026-10-10-clash-tests-manager-implementation-plan-final-report.md).

## 3. Delivered
- Headless manager `clashpanel/core/testsManager.js` (records, sync, Open/Create/Duplicate/Delete/Reset, pending operations, divergence recovery with one token, terminal fault, `FAULT_POLICY`), `managerViewModel.js`, `testDrafts.js`, `testReadiness.js`, `testSummary.js`; additive editor seams (a) atomic `TEST_LOAD`, (b) read-only `vm.test`, (c) `CONFIRM_CANCEL`, (e) `TEST_LABEL_SCOPE`; managed renderer `ui/render/manager.js` + shell `managed` option; composition in `clashpanel/index.js` (manager default-on, `testsManager:false` = standalone); README note.
- M1 (expected-testId invariant, single recovery token): Tasks 2, 4, 7, 9. M2/CTM-11 reconciliation: Task 1 + `specReconciliation.test.mjs`.
- Fault overlay = `FAULT_POLICY`: every blocked user-facing control disabled with the fault reason; faulted result rows non-interactive (tabindex removed, capture-phase click/Enter/Space guards); mechanical equivalence tests (`FAULT_CONTROLS`).
- Per-task internal results: each of Tasks 1–12 had an independent task review (all spec ✅, 0 Critical); Task 9 needed one fix round (7 surviving mutants pinned + hardening), then a scoped re-review ADDRESSED.

## 4. Verification (exact)
- `npm test` exit 0. Offline `# tests 5605 / pass 5604 / fail 0 / todo 1` (baseline 5447/5446/0/1; +158 new tests). DOM `# tests 119 / pass 119 / fail 0` (baseline 106; +13 new). `git diff --check` clean. No sandbox denials / no EPERM waiver used.
- Final whole-branch review (opus): 0 Critical / 0 Important / 9 Minor; independently re-ran both suites at 5597 / 119 (before the two later fix waves).
- Post-review fix waves, each with failing-test-first/mutation evidence and a scoped re-review or reproduction: (1) M-a `confirm.enabled` false during recovery + §26.8 hide/show test; (2) codex-review Important: constructor listener leak (transactional registration, 5 tests).
- Codex reviews: spec/plan reviews earlier; Task 9 consult `20261010-204359-13260-20766`; Task 13 `codex-review code testsManager.js medium` `20261010-212203-51664-7361` (0 Critical, 1 Important fixed).

## 5. Disclosed deviations and rulings
- **Four** surface-enumeration lists grew (G-A1 names three): `controller.setupRun.test.mjs:34`, `core/index.test.mjs:10`, `scaffold.test.mjs` (module list, 7 entries), plus `viewModel.test.mjs` `SHAPE.top` (ruling: G-A1-equivalent, no behavioral assertion changed). No existing behavioral assertion was edited.
- Plan code deviations (all in-task, reviewed): Task 1 guard regex case-insensitive and 704 check limited to text before `*(Corrected`; Task 4 CONFIRM_CANCEL test adds `await h.settle()`; Task 7 `loadInto` plain-field reduction + `activate` try/finally + guarded name lookup; Task 9 kept those, guarded every editor read, `activateSafely` Create rollback, a stricter split (only an explicit refusal naming the active test is a plain failure; a throw/rejection/malformed answer compensates) which changed Task 7's own carry-forward test (stricter), plus extra mutant-killing tests; Task 10 static guard recognizes `editorStep` and adds a transitive GC2 test.
- Ruling: Task 9 brief's verbatim `activate` replacement would have dropped Task 7's fix — controller amended the dispatch. Ruling: Task 11 I-1 (keyboard focus falls to BODY after view switch/unlock/confirm resolution) is not spec-mandated → deferred, owner-visible.

## 6. Remaining debt / deferred (not guessed closed)
- Follow-ups (Minor): I-1 focus loss; disabled Confirm / editor New test lack a linked reason (§26.10 thin spots); fault lock overwrites an existing `aria-describedby` (should append); rejected-Create notice reads "restored"; active running row shows "open and re-run" wording; `snapshotOutgoing` after dispose; `panel.controller.dispose()` leaves shell subscribed; index-based action data-keys; identical consecutive announcements swallowed; no timeout for a never-settling editor dispatch; untested blur/Reset click/Back-to-test; label-scope/`caveatCount` fidelity nits; README does not name CTM-8.
- Gates: **CTM-7** headed SVF2 teardown/readiness verification and **CTM-8** rebuild-cost calibration (mandatory before product/performance closeout; no scalability claim, no record limit) remain not authorized/not performed. CTM-9/10 non-goals. Plan/spec banners still read "implementation not authorized" (not edited; the authorization is this session's owner instruction).

## 7. Protected boundaries confirmed unchanged
Core (`clashtest/**`), Adapter (`clashpanel/viewer/**`), collision, `ports.js`, `wwwroot/**`, server/routes/package/scripts; no persistence, G2/C6/C8/G3, reflected fragments, R20-1.

## 8. Commit/push state and next gate
- Not committed, not pushed. **Next authorized action: none — awaiting independent Work review and owner decision.** Must not begin without authorization: commit/push, CTM-7, CTM-8, follow-up remediation, persistence/history/lifecycle/rebinding/background runs, G2/C6/C8/G3, reflected fragments, R20-1, Core/Adapter/collision changes.

## 9. Accessibility remediation (Independent Work Review M1 + M2) — 2026-10-10

Authorized by the owner as one bounded remediation for [implementation Independent Work Review](../reviews/2026-10-10-clash-tests-manager-implementation-independent-work-review.md) Medium M1 and M2 only. The 8 Lows were not expanded into. No commit/push; CTM-7/CTM-8 not run.

- **M1 (disabled reasons):** `manager.confirm.disabledReason` (priority fault → recovering (`MANAGER_TEXT.RECOVERING`) → editor confirmation pending (`ANSWER_CONFIRM`); null exactly when enabled), rendered as a visible reason span linked by `aria-describedby` on the disabled Confirm. Manager-only overlay gives the managed editor's disabled New test a visible, `aria-describedby`-linked run-active reason (`manager.runActiveReason`, same text as `STOP_FIRST`; renderer cannot import core text). Skipped if the control already has a description (terminal-fault reason kept); standalone editor output unchanged.
- **M2 (repeatable announcements):** monotonic `liveSeq` (single `setLive` helper in `testsManager.js`, called at all six announcing sites) exposed as `manager.liveSeq`; the one persistent live region clears and re-inserts a fresh text node and sets `data-live-seq` when the sequence advances, even for identical text. Editor `statusLive` relay and no-churn behavior preserved.
- **Tests:** core (confirm reasons incl. custom fault text; `liveSeq` per announcing path incl. Reset/Duplicate, not on view/refused paths) and DOM (resolved reason text via `aria-describedby` + enabled companions + standalone no-overlay; M2 fixture test; real-composed-panel test deleting two same-named tests asserting two live-node mutations, identical text, `data-live-seq` N→N+1, one `aria-live` region). Two existing enumeration assertions and the DOM fixture were mechanically extended for the new keys; no behavioral assertion weakened. Implementer report (scratchpad, not durable) summarized here.
- **Verification (exact):** `npm test` exit 0 — offline **5609 total / 5608 pass / 0 fail / 1 todo** (+4 over 5605); DOM **125/125** (+6 over 119); `git diff --check` clean; protected-path diff empty.
- **Internal review (one bounded, opus):** 0 Critical / 0 Important; Minors (custom fault text, Reset/Duplicate seq assertions, real-action DOM test) fixed in a follow-up. Residual: clear-and-reinsert happens in one task; screen-reader behavior is **not verified headed** (no headed claim made).
- **Open:** Lows L1–L8 unchanged; CTM-7/CTM-8 remain mandatory later gates. **Next gate:** targeted independent Work re-review of M1/M2. No commit/push.
