# Clash Tests Manager (session-scoped v1) — Implementation Plan

> **Status: DRAFT — implementation NOT authorized.** The owner authorized **drafting this plan only** (2026-10-10), from the accepted spec §26 and the latest Independent Work Review. **No task below may be executed** until the owner separately authorizes implementation. No production code, test or spec edit was made by the planning task, and nothing was committed.
>
> **Remediation applied (2026-10-10):** the [Independent Work Review of this plan](../../reviews/2026-10-10-clash-tests-manager-implementation-plan-independent-work-review.md) (0C/2H/2M/0L — "revise before owner implementation authorization") is remediated within its minimum corrections: **H1** model-left identity (Tasks 7, 10), **H2** list/editor label scope via the owner-chosen fourth additive seam (e) `INTENT.TEST_LABEL_SCOPE` (Tasks 1, 4, 7, 10), **M1** total, exact `isLoadableDraft` (Tasks 2, 4), **M2** explicit terminal-fault intent allow-list (Task 9). Owner decisions G-A1, G-A2 (seam (e)), G-A3, G-PERF and G-PD are recorded in "Gates and open items". The bounded [Independent Work re-review](../../reviews/2026-10-10-clash-tests-manager-implementation-plan-remediation-independent-work-review.md) (0C/0H/1M/0L) closed H1, H2/G-A2 and M1 and found M2 safe at dispatch.
>
> **Second remediation (2026-10-10, owner-authorized, documents only):** that re-review's one Medium — faulted Viewer controls visibly enabled while `FAULT_POLICY` drops their intents — is corrected: the fault overlay `lockedEditorVm(editorVm, reason, FAULT_POLICY)` (Tasks 6, 9) and the managed renderer's lock (Task 11) disable, with the terminal-fault reason, every user-facing control `FAULT_POLICY` blocks (setup edits/New test, Run, Release and retry, result-row selection, Previous/Next, Focus, Isolate, Markers, Back to All), leave every allow-listed control interactive, and a mapping table `FAULT_CONTROLS` (Task 9) pins VM and DOM equivalence with the policy. `FAULT_POLICY` itself is unchanged.
>
> **Third remediation (2026-10-10, owner-authorized, documents only):** the [fault-state re-review](../../reviews/2026-10-10-clash-tests-manager-fault-state-viewmodel-ui-remediation-independent-work-review.md) (0C/0H/1M/1L) — **M1:** a faulted result row was only marked `aria-disabled` yet stayed focusable and activatable — is corrected manager-only in Task 11: `lockRow` removes the row from the tab order and gives it a disabled look, and a capture-phase guard on the editor host (`guardLockedRows`) stops click/Enter/Space before the row's `results.js` handler; a non-vacuous DOM test proves the same inputs select when not faulted and emit nothing when faulted. **L1:** Task 9 Step 2 now names the missing-`FAULT_POLICY`-export module-link failure first. No editor renderer, controller, ViewModel or `FAULT_POLICY` change. **Status: still DRAFT; implementation NOT authorized; awaiting a targeted independent Work re-review of this correction only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. If an implementer or reviewer wants a second opinion, they may ONLY use the `codex-advisor` or `codex-review` skills (never the native advisor tool), run as an explicit `run_in_background` Bash call, and `TaskStop` their own backgrounded task once answered.

**Goal:** Add a session-scoped Clash Tests manager (list, create, open/edit, duplicate, delete, reset, active test, per-test readiness / "models changed") around the existing single-test Panel controller, with no Core/Adapter/collision change and no persistence.

**Architecture:** A new headless module `clashpanel/core/testsManager.js` owns the test records, the active-test id, the session counter and its own view state, and drives the **one** existing `createPanelController` (the *editor*) for the whole Panel lifetime through four additive editor seams: an atomic `INTENT.TEST_LOAD` intent, a read-only `vm.test` snapshot, an `INTENT.CONFIRM_CANCEL` intent and (owner decision G-A2) an `INTENT.TEST_LABEL_SCOPE` intent that hands the editor's label resolver the manager's referenced-model-key scope so list and editor model labels agree. Only the active test holds results or touches the Viewer; inactive tests keep a plain draft plus their last sealed-run summary. A thin renderer (`clashpanel/ui/render/manager.js`) adds a header and a Tests list around the unchanged five editor regions.

**Tech Stack:** Node ≥ 20 ESM (repo runs v22.23.1), `node:test` + `node:assert/strict`, hand-rolled fakes (`test/clashpanel/support/*`), Playwright Chromium for `*.dom.mjs` (`scripts/run-dom-tests.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` **§26** (lines 825–990) plus its pointer edits in §§0, 5, 6, 7, 9, 18, 23, 25. Authorities read for this plan: owner brief `docs/reviews/for-claude-clash-tests-manager.md`; **Independent Work Review** `docs/reviews/2026-10-10-clash-tests-manager-spec-independent-work-review.md` (0C/0H/2M/0L; M1 and M2 are acceptance requirements of this plan); upstream package final report `docs/research/2026-10-10-clash-tests-manager-spec-final-report.md` (read-only input); prior plan `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md` (format/conventions only — not edited).

**Repository state at drafting:** branch `main`, HEAD `ea533997dc62543aac47c28628e095e62a7b90ea` (== `origin/main`); working tree dirty with the §26 design package (modified spec + handoff; untracked brief, final report, independent review). This plan file is the only file the planning task added.

---

## Plan-acceptance requirements from the Independent Work Review (mandatory)

**M1 — expected-testId invariant and single recovery token are mechanical.** This plan fixes them as follows; every item has an owning test.

| M1 item | Mechanism (exact) | Owning task / test |
|---|---|---|
| Load-intent input invariant | `{type: INTENT.TEST_LOAD, testId, draft, acknowledgeUnsaved}`. The editor accepts it only if `isLoadableDraft(draft, testId)` (deep-frozen draft in the exact canonical `draft.js` form — top-level keys exactly `basisUnit, clearance, lastRun, mode, name, revision, selfClash, setA, setB, testCounter, testId`, side keys exactly `elements, modelKeys`, `lastRun` null or keys exactly `definitionKey, revision` with `lastRun.revision === draft.revision` (≥ 1; `prepareRun` writes both together, `draft.js:195-196`), plain prototypes, data properties only (no accessors, no symbol keys), frozen sorted-unique `modelKeys` and id lists (no `-0` id), `elements` keys in `normalizeElements` order — **and** `draft.testId === testId`; the validator is **total**: any throw from a hostile accessor/proxy trap yields `false`, never an exception; Work plan review M1); otherwise `{ok:false, reason:'invalid-test-id'|'invalid-draft'}` with **zero** mutation and **no** notification. A successful load returns `{ok:true, testId}` where `testId === draft.testId` by construction. A refusal returns the test id the editor **still holds**. | Task 2 (`isLoadableDraft`), Task 4 (`controller.loadTest.test.mjs`) |
| "Unknown id" split | **Manager-side** record-existence check (`m.records.get(targetTestId)` and `record.draft.testId === record.testId`) before any dispatch → `{outcome:'failed', reason:'unknown-test'}`; the editor never sees a manager registry. **Editor-side** check is only the draft/`testId` invariant above. | Task 7, Task 9 |
| One recovery state/token | `m.recovery = null | {token, cause, state:'scheduled'|'loading'}` created only by `beginRecovery()`, which is a no-op while `m.recovery !== null` or `m.fault !== null`. `compensate(m, token)` runs only if `m.recovery.token === token && state === 'scheduled'`. A notification-detected divergence during an in-flight activation is **not** scheduled (the activation compensates once when its load settles); outside an activation it is scheduled once on a microtask. | Task 9 |
| Recovery evaluated against the committed source | While `m.recovery !== null` or `m.fault !== null`, `syncFrom()` returns before touching any record; compensation loads `m.activeTestId`'s snapshotted draft and succeeds only if `result.ok && result.testId === activeTestId && editor.getViewModel().test.testId === activeTestId`. | Task 9 |
| Required tests | notification-first, result-first, duplicate mismatch signals, compensation success, compensation failure → fault, Create rollback, no sync by a disagreeing id, spontaneous divergence, late same-target notification (no false divergence), dispose during activation. | Task 9 |

**M2 — CTM-11 authority.** For this package, **§23/§23.7 is authoritative for Soft** (Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run blocked until a basis is chosen) and **§7.5/AC-P4 is authoritative for row verification** (no `getPairStatus`/`getElementStatus` on any path; per-row "not fully verified" is the cached `caveated` filter mask). The stale fail-closed statements (§6.1 rows lines 215–216, §14.4 line 589, §16 line 641, PR-BASIS line 676, §18 line 691, §21 line 742) and §19 item 8 (line 704) are reconciled by the bounded documentation task **Task 1**, which changes no Soft math, no Core API, no code and no manager architecture. The prior Panel plan's Global Constraint 10 ("Soft fails closed") is **historical** and does not govern this package (that accepted plan is not edited).

---

## Global Constraints

Every task's requirements implicitly include these:

1. **Edit scope.** Implementation may create/modify only: `clashpanel/**`, `test/clashpanel/**`, the bounded spec lines named in Task 1, `clashpanel/README.md`, and at closeout `docs/research/2026-10-10-clash-tests-manager-final-report.md` and `docs/handoffs/latest.md` (Task 13). **Never modified:** `clashtest/**` (incl. `clashtest/viewer/**`), `collision/**`, `wwwroot/**`, `server.js`, `routes/**`, `package.json`, `scripts/**`, `test/clashtest/**`, `test/fixtures/**`, any other spec or plan, the upstream final report and the independent review. A task that seems to need such an edit **stops** and records a plan contradiction.
2. **Ports not widened.** `clashpanel/core/ports.js` is unchanged; `narrowEnginePort` stays exactly as is (spec §26.2). The manager reads **only** `port.registry.bindingFor`, `catalog.list/displayNameFor/onChange`, `catalog.keyOfModel` (solely to resolve a model-left event's `model` to its key — the editor's existing identity read, `controller.js:1083`; the `Model` is never retained, Work plan review H1), `bridge.onModelLeft`; it never calls `startRun`, `releaseResultSet`, `retainResultSet`, `getPersistenceState`, `getFreshness`, `assessNoClashClaim`, `derivations.*`, `validateTest`, `bridge.present/clear/dispose` (static guard, Task 10).
3. **Editor seam is additive only (§26.2 (a)–(d), CTM-1, plus the owner-authorized fourth seam (e), G-A2).** Allowed controller changes: `INTENT.TEST_LOAD` handler, `INTENT.CONFIRM_CANCEL` handler, `vm.test` (via `viewInput`/`buildViewModel`), seam (e) — the `INTENT.TEST_LABEL_SCOPE` handler, the `c.labelScope` field (initially `[]`, so the standalone editor is unchanged) and `...c.labelScope` appended to the label resolver's existing `knownModelKeys` callback (`controller.js:70`) — the `c.lastSealed` field — captured at the end of `onRunDone` and cleared by the load and by the existing `newTest()` path (one added line, `c.lastSealed = null;`, so a fresh standalone test never reports the previous test's run; part of the (b) snapshot seam, no observable change to existing ViewModel fields) — and the disposed-load result in `dispatch()`. **No** change to `retireDisplayed`, `startRun`, `dispose`, `residency.js`, `labels.js`, or any existing intent's semantics. If one of (a)–(c) or (e) proves impossible without such a change, stop and record a gate (no port widening, no silent re-architecture).
4. **One held set (§7.6, §26.3).** At most one displayed/leased set, always the active test's; non-active records hold no set, lease, index, cache or freshness read.
5. **Layering (AC-P10, `test/clashpanel/support/layering.mjs`, unchanged).** New core modules import only `clashpanel/core/*.js` siblings. `clashpanel/ui/**` imports only `ui/*`, `ui/render/*`, `core/constants.js`, `core/intents.js` — hence `MANAGER_INTENT` lives in `core/intents.js`. `clashpanel/index.js` imports only `core/index.js`, `viewer/*.js`, `ui/*.js` (not `ui/render/*`) — hence the shell, not `index.js`, selects the managed renderer.
6. **Untrusted text (AC-P13).** Test names and model names reach the DOM only through `textContent`/`setAttribute` (`ui/dom.js` `el`). No `innerHTML`-family API (static ban already enforced).
7. **No persistence (§26.1).** No `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, cookie or file write anywhere in the manager path; all state is lost on reload/dispose. Copy never says "saved"; destructive copy says "for this session".
8. **Copy rules.** Manager readiness copy never contains the word "ready" (`/\bready\b/i`) and never "ready to run" (AC-M10); a summary count reads "`<n>` clashes reported" (0 included) and never "No clashes" (PD-12); default names are `Clash test <N>` (`draft.js:39`).
9. **Soft authority (M2).** §23/§23.7 governs Soft; §7.5/AC-P4 governs per-row verification. Rows never label a basis `verified`.
10. **Determinism.** Injected `mintId` and `scheduler`; no wall-clock assertion; fake scheduler + `settle()` (`test/clashpanel/support/settle.mjs`).
11. **Green at every checkpoint.** Tasks 1–10: `npm run test:offline` (= `node scripts/run-tests.mjs`) passes. Tasks 11–13: `npm test` (= offline suite then `scripts/run-dom-tests.mjs`) passes. "Passes" (and every `ℹ fail 0` expectation below) means **zero failures, except** this single waiver: if — and only if — Task 1 Step 1 recorded, in the task log, that the same environment fails exactly the known local-port `EPERM` tests of `test/performance/m4/spike-server.test.mjs` (test names listed), a later run whose failures are exactly that same named set still passes; any other failure, or any change to that set, fails the gate.
12. **Baseline (handoff, at `ea53399`):** offline **5,447 total / 5,446 pass / 0 fail / 1 existing todo**; DOM **106/106**. Re-measure in Task 1 Step 1 and use that figure (with the waiver evidence of item 11 if applicable).
13. **Existing tests (AC-M13).** No existing behavioral assertion is edited. Exactly three **surface-enumeration** lists grow, each disclosed (gate G-A1): `test/clashpanel/core/controller.setupRun.test.mjs:34` (ViewModel top-level keys gain `test`), `test/clashpanel/core/index.test.mjs:10` (core barrel gains `createTestsManager`), `test/clashpanel/scaffold.test.mjs` (module list, the established growth pattern).
14. **Commits** only if the owner's implementation authorization includes per-task commits; then Conventional Commits `feat(clashpanel): …` / `docs(spec): …`, ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and **no** `Claude-Session:` trailer (user's global rule). Otherwise each "Checkpoint" step records `git status --short` in the task log and does not commit.

## Review Focus

The six failure modes most likely to bite a user that the spec implies but no AC names directly; each has a pinning test in the owning task:

1. **Double activation from a double click** (two `OPEN`/`DELETE`/`CONFIRM` in one tick) must start exactly one operation — the single `pending` object blocks the second. → Task 8, test "double click …".
2. **Hostile or very long test/model names** (`<img onerror>`, 10,000 characters without spaces) must render inert and wrap inside the list without widening the panel. → Task 11, test "hostile and unbroken names …".
3. **A model unloads while the list is shown** (model-left event before or without a catalog change) must flip referencing rows to `models-missing` / "Models changed since this run" with no engine read — the event alone, with the catalog and binding unchanged (Work plan review H1). → Task 7, tests "H1 / AC-M10 …", and Task 10, test "AC-M10 …".
4. **An ordinary late editor notification with the target id** (e.g. the async `clearViewer` outcome) arriving between the load result and the commit must **not** be treated as a divergence. → Task 9, test "late same-target notification …".
5. **Panel disposed while an activation is in flight** must not commit, notify or throw after dispose. → Task 9, test "dispose during activation …".
6. **A faulted Panel showing a control enabled that dispatch silently drops** (Work plan re-review M1): every user-facing control whose intent `FAULT_POLICY` blocks must be disabled with the terminal-fault reason, every allowed one must stay interactive, and a policy change must fail until UI and policy agree. A non-native control (a result row) must also be genuinely inert — out of the tab order, visibly disabled, and click/Enter/Space never reach its handler (fault-state re-review M1). → Task 9, tests "re-review M1 guard / (VM) / (wiring)"; Task 11, tests "Review Focus 6 / re-review M1 (DOM) …" and "fault-state re-review M1 (DOM): a faulted result row …".

---

## File structure

| Path | New/Modified | Responsibility |
|---|---|---|
| `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` | Modify (Task 1, bounded lines only) | M2 documentation reconciliation |
| `test/clashpanel/specReconciliation.test.mjs` | Create (Task 1) | M2 guard: stale lines carry the §23 pointer; §19 item 8 corrected; §26.2 (d) records seam (e) (G-A2) |
| `clashpanel/core/intents.js` | Modify (Tasks 2, 4) | `MANAGER_INTENT` vocabulary; `INTENT.TEST_LOAD`, `INTENT.CONFIRM_CANCEL`, `INTENT.TEST_LABEL_SCOPE` |
| `clashpanel/core/testDrafts.js` | Create (Task 2) | `isLoadableDraft`, `duplicateDraft`, `duplicateName` (pure) |
| `clashpanel/core/testSummary.js` | Create (Task 3) | `sealSummary` (editor-side, at seal), `summaryStatusText` (pure) |
| `clashpanel/core/controller.js` | Modify (Tasks 3, 4) | seams (a)–(c) and (e); `c.lastSealed`; `c.labelScope`; `vm.test` input |
| `clashpanel/core/viewModel.js` | Modify (Tasks 3, 6) | `test` region passthrough; export `describeScope` |
| `clashpanel/core/testReadiness.js` | Create (Task 5) | `readinessOf`, `modelsChangedOf`, `referencedModelKeys` (pure) |
| `clashpanel/core/managerViewModel.js` | Create (Task 6) | `buildManagerViewModel`, `actionGate`, `MANAGER_TEXT` (pure) |
| `clashpanel/core/testsManager.js` | Create (Tasks 7–9) | `createTestsManager`: records, sync, pending ops, activation, recovery/fault |
| `clashpanel/core/index.js` | Modify (Task 7) | export `createTestsManager` |
| `clashpanel/ui/render/manager.js` | Create (Task 11) | `renderManagedPanel`: header, Tests list, editor host |
| `clashpanel/ui/ClashDockingPanel.js` | Modify (Task 11) | `createPanelShell({ managed })` selects the renderer |
| `clashpanel/index.js` | Modify (Task 12) | compose the manager by default (`testsManager:false` = standalone) |
| `clashpanel/README.md` | Modify (Task 12) | host-facing note: manager, session-only, no new port |
| `test/clashpanel/support/fakeEditor.mjs` | Create (Task 7) | scriptable editor double + `makeManagerHarness` |
| `test/clashpanel/core/*.test.mjs` (new files per task) | Create | unit/integration tests |
| `test/clashpanel/dom/support/managerFixtures.mjs`, `test/clashpanel/dom/manager.dom.mjs`, `test/clashpanel/dom/managerComposition.dom.mjs` | Create (Tasks 11–12) | DOM + end-to-end tests |
| `test/clashpanel/scaffold.test.mjs`, `test/clashpanel/core/index.test.mjs`, `test/clashpanel/core/controller.setupRun.test.mjs:34` | Modify (surface lists only) | Global Constraint 13 |

Task dependency: `1` independent → `2 → 3 → 4` (editor seam) → `5 → 6` (pure manager parts) → `7 → 8 → 9` (manager) → `10` (integration) → `11 → 12` (UI/composition) → `13` (gate). Tasks 1 and 5 may run in parallel with 2–4.

---

## Tasks

### Task 1: M2 documentation reconciliation (bounded) + baseline measurement

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` lines 215, 216, 589, 641, 676, 691, 704, 742, 988 (M2) and 838 (§26.2 (d): bounded record of the owner-authorized seam (e), G-A2 — the spec text "(d) Nothing else" otherwise contradicts the fourth seam) — text appended/replaced exactly as below; nothing else
- Create: `test/clashpanel/specReconciliation.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the authority record used by every later task (Global Constraint 9).

- [ ] **Step 1: Measure the baseline and verify the authorization**

Run: `git rev-parse HEAD && git status --short && npm run test:offline 2>&1 | tail -8 && npm run test:clashpanel:dom 2>&1 | tail -8`
Expected: HEAD is `ea53399…` or a descendant the owner named; offline `ℹ fail 0` with total ≈ 5,447 (record the exact numbers in the task log; if the only failures are the known `spike-server.test.mjs` `EPERM` tests, record their exact names — the Global Constraint 11 waiver set); DOM `ℹ fail 0`, 106 tests. Confirm in `docs/handoffs/latest.md` (or the owner's message) that implementation is authorized after a clean bounded independent Work re-review of this plan; if not, STOP. (Gates G-A1, G-A2, G-A3, G-PERF and G-PD were decided by the owner on 2026-10-10 and are recorded in "Gates and open items"; re-check only that no later owner message changed them.)

- [ ] **Step 2: Write the failing guard test**

```js
// test/clashpanel/specReconciliation.test.mjs — independent Work review M2 (2026-10-10): the Panel spec's stale
// pre-§23 Soft statements and §19 item 8 are reconciled so no later task or test can select the stale branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SPEC = readFileSync(new URL('../../docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md', import.meta.url), 'utf8').split('\n');
const lineWith = (marker) => SPEC.find((l) => l.includes(marker));

const STALE_SOFT_MARKERS = [
  'Soft is offered only when the common-measurement-basis rule',
  'shown only while Soft is available (§6.2)',
  'a "why Soft is unavailable" line replaces the clearance field',
  'anything else → Soft unavailable',
  'Without it Soft is unavailable (fail closed)',
  'Soft mode for multi-model tests without a verified common measurement basis (fail closed until PR-BASIS/PG-5)',
  'Soft is unavailable for any multi-model test',
];

test('M2: every stale fail-closed Soft statement carries the §23 supersession pointer', () => {
  for (const marker of STALE_SOFT_MARKERS) {
    const line = lineWith(marker);
    assert.ok(line, `marker not found: ${marker}`);
    assert.match(line, /superseded by §23 \(2026-10-07\)/, marker);
  }
});

test('M2: §19 item 8 routes per-row "not fully verified" through the caveated mask, never getPairStatus', () => {
  const line = lineWith('8. **`caveated` facet**');
  assert.ok(line);
  assert.match(line, /cached `caveated` filter mask/);
  assert.doesNotMatch(line, /therefore uses `getPairStatus`/);
});

test('M2: CTM-11 is recorded as reconciled with §23/§23.7 and §7.5/AC-P4 authoritative', () => {
  const row = lineWith('| CTM-11 |');
  assert.ok(row);
  assert.match(row, /reconciled/);
  assert.match(row, /§23\/§23\.7/);
  assert.match(row, /§7\.5\/AC-P4/);
});

test('G-A2: §26.2 (d) records the owner-authorized fourth additive seam (e) INTENT.TEST_LABEL_SCOPE', () => {
  const line = lineWith('(d) Nothing else');
  assert.ok(line);
  assert.match(line, /seam \(e\), `INTENT\.TEST_LABEL_SCOPE`/);
  assert.match(line, /owner decision G-A2/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/clashpanel/specReconciliation.test.mjs`
Expected: FAIL — 4 tests, `ℹ fail 4` (`superseded by §23` not found; `therefore uses getPairStatus` still present; CTM-11 not "reconciled"; §26.2 (d) does not name seam (e)).

- [ ] **Step 4: Apply the bounded spec edits**

Use exact-string edits; each stale table cell / paragraph keeps its text and gains the pointer *inside* its last cell (before the trailing ` |` for table rows). The pointer text, identical everywhere:

`*(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)*`

| Line | Old fragment (unique) | Edit |
|---|---|---|
| 215 | `otherwise the Soft option is disabled with an explanation and Hard stays available (PD-17). |` | insert ` ` + pointer before the final ` |` |
| 216 | `This is the reference's "tolerance" **only** for Soft mode. |` | insert ` ` + pointer before the final ` |` |
| 589 | `— never worded as "approximate" |` | insert ` ` + pointer before the final ` |` |
| 641 | `Which host evidence suffices is PR-BASIS / PG-5. |` | insert ` ` + pointer before the final ` |` |
| 676 | `Without it Soft is unavailable (fail closed) |` | replace with `Without it Soft is unavailable (fail closed) ` + pointer + ` |` |
| 691 | `Soft mode for multi-model tests without a verified common measurement basis (fail closed until PR-BASIS/PG-5)` | append ` ` + pointer immediately after this item (before ` · any model registration`) |
| 742 | `Delivering Soft in v1 depends on that host evidence.` | append ` ` + pointer |
| 704 | whole line | replace with: ``8. **`caveated` facet** is true only for `covered-caveated`; per-row "not fully verified" uses the cached `caveated` filter mask (§7.5, AC-P4) — `getPairStatus`/`getElementStatus` are never called on any interactive path. *(Corrected 2026-10-10, independent Work review M2; the earlier wording "therefore uses `getPairStatus`" was stale.)*`` |
| 838 | `(d) Nothing else — no new engine call,` | replace with ``(d) Nothing else *(amended 2026-10-10, owner decision G-A2 on the independent Work plan review H2: plus one fourth additive seam (e), `INTENT.TEST_LABEL_SCOPE` `{modelKeys}`, which supplies the editor's label resolver with the manager's referenced-model-key scope so the same `modelKey` has the same label in the Tests list and the editor, CTM-2)* — no new engine call,`` |
| 988 | last cell `deferred to owner / adjudication |` | replace with `reconciled by the Clash Tests Manager implementation plan Task 1 (independent Work review M2): §23/§23.7 authoritative for Soft, §7.5/AC-P4 authoritative for row verification; no Soft math, Core API or manager-architecture change |` |

- [ ] **Step 5: Run the guard and the offline suite**

Run: `node --test test/clashpanel/specReconciliation.test.mjs && npm run test:offline 2>&1 | tail -6 && git diff --check`
Expected: guard `ℹ pass 4`, `ℹ fail 0`; offline `ℹ fail 0` (total = baseline + 4); `git diff --check` prints nothing.

- [ ] **Step 6: Checkpoint**

```bash
git add docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md test/clashpanel/specReconciliation.test.mjs
git commit -m "docs(spec): reconcile stale pre-§23 Soft wording and §19 item 8 (Work review M2); record seam (e) in §26.2 (d) (G-A2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(Only if per-task commits are authorized — Global Constraint 14.)

---

### Task 2: Manager intent vocabulary and pure test-draft helpers

**Files:**
- Modify: `clashpanel/core/intents.js` (append one export)
- Create: `clashpanel/core/testDrafts.js`
- Modify: `test/clashpanel/scaffold.test.mjs` (add `'core/testDrafts.js'` to `EXPECTED_MODULES` after `'core/draft.js'`)
- Test: `test/clashpanel/core/testDrafts.test.mjs`

**Interfaces:**
- Consumes: `createDraft`, `draftReduce`, `prepareRun` (`draft.js`); `isBasisChoice` (`measurementBasis.js`).
- Produces:
  - `MANAGER_INTENT` — frozen `{VIEW_LIST:'manager/viewList', VIEW_EDITOR:'manager/viewEditor', OPEN:'manager/open', CREATE:'manager/create', DUPLICATE:'manager/duplicate', RESET:'manager/reset', DELETE:'manager/delete', CONFIRM:'manager/confirm', CANCEL:'manager/cancel'}`. Payloads: `OPEN/DUPLICATE/RESET/DELETE {testId}`, `CONFIRM/CANCEL {operationId}`, others none.
  - `isLoadableDraft(draft, testId) → boolean` — total (never throws, never mutates its input) and exact (the canonical `draft.js` field sets and revision relationship; Work plan review M1)
  - `duplicateDraft(source, {testId, name}) → frozen draft` (revision 1, `lastRun:null`, setup copied incl. `basisUnit`)
  - `duplicateName(name, existingNames: string[]) → string`

`INTENT.TEST_LOAD`/`CONFIRM_CANCEL` are **not** added here: the existing "every INTENT value is handled by the dispatch table" test (`controller.navigation.test.mjs:457`) requires their handlers, which land in Task 4.

- [ ] **Step 1: Write the failing tests**

```js
// test/clashpanel/core/testDrafts.test.mjs — spec §26.2 (a) load invariant (Work review M1) and §26.4 Duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftReduce, prepareRun } from '../../../clashpanel/core/draft.js';
import { isLoadableDraft, duplicateDraft, duplicateName } from '../../../clashpanel/core/testDrafts.js';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';

const reduce = (d, ...actions) => actions.reduce(draftReduce, d);
const softAB = () => reduce(createDraft({ testId: 'T-1', testNumber: 4 }),
  { type: 'name', value: 'Walls vs ducts' }, { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.05' },
  { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'setElements', side: 'B', elements: { mB: [3, 1] } },
  { type: 'basisUnit', value: 'mm' });

test('isLoadableDraft accepts exactly a frozen draft.js draft for the supplied testId (M1 invariant)', () => {
  const d = softAB();
  assert.equal(isLoadableDraft(d, 'T-1'), true);
  assert.equal(isLoadableDraft(prepareRun(d, { verifiedBasis: false }).draft, 'T-1'), true, 'a run draft (lastRun set)');
  assert.equal(isLoadableDraft(d, 'T-2'), false, 'draft.testId !== testId');
  assert.equal(isLoadableDraft(d, ''), false);
  assert.equal(isLoadableDraft(d, undefined), false);
  assert.equal(isLoadableDraft(null, 'T-1'), false);
  assert.equal(isLoadableDraft({ ...d }, 'T-1'), false, 'not frozen');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, revision: 0 }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, mode: 'clearance' }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, basisUnit: 'furlong' }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, setA: { modelKeys: ['mA'], elements: {} } }), 'T-1'), false, 'unfrozen side');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, lastRun: Object.freeze({ definitionKey: 7, revision: 1 }) }), 'T-1'), false);
  assert.equal(isLoadableDraft(Object.freeze({ ...d, lastRun: { definitionKey: 'k', revision: 1 } }), 'T-1'), false, 'unfrozen lastRun');
});

test('isLoadableDraft requires the DEEP-frozen canonical draft.js form (Codex plan review C3)', () => {
  const d = softAB();
  const side = (modelKeys, elements) => Object.freeze({ modelKeys: Object.freeze(modelKeys), elements: Object.freeze(elements) });
  const withB = (b) => Object.freeze({ ...d, setB: b });
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([1, 3]) })), 'T-1'), true, 'the canonical shape itself');
  assert.equal(isLoadableDraft(withB(side([], { mB: [1, 3] })), 'T-1'), false, 'mutable id array: a later push would bypass the editor');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([3, 1]) })), 'T-1'), false, 'unsorted ids');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([1, 1]) })), 'T-1'), false, 'duplicate ids');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([]) })), 'T-1'), false, 'empty id list (draft.js drops it)');
  assert.equal(isLoadableDraft(withB(side(['mB', 'mA'], {})), 'T-1'), false, 'unsorted model keys');
  assert.equal(isLoadableDraft(withB(side(['mA', 'mA'], {})), 'T-1'), false, 'duplicate model keys');
  assert.equal(isLoadableDraft(withB(side([], { mB: Object.freeze([-1]) })), 'T-1'), false, 'negative id');
});

test('isLoadableDraft enforces the EXACT canonical field sets and the lastRun/revision relationship (Work plan review M1)', () => {
  const d = softAB();
  const run = prepareRun(d, { verifiedBasis: false }).draft;
  assert.equal(run.lastRun.revision, run.revision, 'draft.js writes both together');
  const side = (extra = {}) => Object.freeze({ modelKeys: Object.freeze(['mA']), elements: Object.freeze({}), ...extra });
  assert.equal(isLoadableDraft(Object.freeze({ ...d, extra: 1 }), 'T-1'), false, 'extra top-level field');
  const { testCounter, ...noCounter } = d;
  void testCounter;
  assert.equal(isLoadableDraft(Object.freeze(noCounter), 'T-1'), false, 'missing top-level field');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, setA: side({ note: 'x' }) }), 'T-1'), false, 'extra side field');
  assert.equal(isLoadableDraft(Object.freeze({ ...run, lastRun: Object.freeze({ ...run.lastRun, at: 1 }) }), 'T-1'), false, 'extra lastRun field');
  assert.equal(isLoadableDraft(Object.freeze({ ...run, lastRun: Object.freeze({ revision: run.revision }) }), 'T-1'), false, 'missing definitionKey');
  for (const revision of [0, -1, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isLoadableDraft(Object.freeze({ ...run, revision, lastRun: Object.freeze({ ...run.lastRun, revision }) }), 'T-1'), false, `revision ${String(revision)}`);
  }
  assert.equal(isLoadableDraft(Object.freeze({ ...run, lastRun: Object.freeze({ ...run.lastRun, revision: run.revision + 1 }) }), 'T-1'), false, 'lastRun.revision !== draft.revision');
  assert.equal(isLoadableDraft(Object.freeze({ ...run, revision: run.revision + 1 }), 'T-1'), false, 'draft.revision bumped without its lastRun');
  assert.equal(isLoadableDraft(Object.freeze(Object.assign(Object.create(null), d)), 'T-1'), false, 'non-plain prototype');
  assert.equal(isLoadableDraft(Object.freeze({ ...d, [Symbol('x')]: 1 }), 'T-1'), false, 'symbol key');
  const withElements = (elements) => Object.freeze({ ...d, setB: Object.freeze({ modelKeys: Object.freeze([]), elements: Object.freeze(elements) }) });
  assert.equal(isLoadableDraft(withElements({ mB: Object.freeze([1]), mC: Object.freeze([2]) }), 'T-1'), true, 'canonical key order');
  assert.equal(isLoadableDraft(withElements({ mC: Object.freeze([2]), mB: Object.freeze([1]) }), 'T-1'), false, 'element keys out of normalizeElements order');
  assert.equal(isLoadableDraft(withElements({ mB: Object.freeze([-0]) }), 'T-1'), false, '-0 id (draft.js normalizes it to 0)');
});

test('isLoadableDraft is TOTAL: hostile accessors and proxies resolve to false, never an exception, and nothing is mutated', () => {
  const d = softAB();
  const boom = () => { throw new Error('hostile'); };
  const accessor = Object.freeze(Object.defineProperty({ ...d }, 'name', { get: boom, enumerable: true }));
  const stable = Object.freeze(Object.defineProperty({ ...d }, 'name', { get: () => 'Walls vs ducts', enumerable: true }));
  const sideAccessor = Object.freeze({ ...d, setA: Object.freeze(Object.defineProperty({ elements: Object.freeze({}) }, 'modelKeys', { get: boom, enumerable: true })) });
  const traps = ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor', 'get', 'isExtensible'];   // every trap the validator exercises
  const hostile = [accessor, stable, sideAccessor, ...traps.map((trap) => new Proxy(d, { [trap]: boom }))];
  for (const draft of hostile) {
    assert.doesNotThrow(() => isLoadableDraft(draft, 'T-1'));
    assert.equal(isLoadableDraft(draft, 'T-1'), false);
  }
  const before = JSON.stringify(d);
  isLoadableDraft(d, 'T-1');
  isLoadableDraft(Object.freeze({ ...d, extra: 1 }), 'T-1');
  assert.equal(JSON.stringify(d), before, 'the validator never mutates');
});

test('duplicateDraft copies the whole setup incl. the basis attestation; new testId, revision 1, no lastRun (§26.4, AC-M7)', () => {
  const first = prepareRun(softAB(), { verifiedBasis: false }).draft;
  const src = prepareRun(reduce(first, { type: 'name', value: 'Walls v2' }), { verifiedBasis: false }).draft;
  assert.equal(src.revision, 2);
  const copy = duplicateDraft(src, { testId: 'T-9', name: 'Walls v2 copy' });
  assert.equal(copy.testId, 'T-9');
  assert.equal(copy.revision, 1);
  assert.equal(copy.lastRun, null);
  assert.equal(copy.name, 'Walls v2 copy');
  for (const k of ['mode', 'clearance', 'selfClash', 'basisUnit']) assert.equal(copy[k], src[k], k);
  assert.equal(copy.basisUnit, 'mm', 'attestation copied (CTM-3 default), still never `verified`');
  assert.deepEqual(copy.setA, src.setA);
  assert.deepEqual(copy.setB, src.setB);
  assert.equal(isLoadableDraft(copy, 'T-9'), true);
  assert.equal(src.testId, 'T-1', 'source untouched');
});

test('duplicateDraft keeps self-clash and a hidden Set B', () => {
  const src = reduce(createDraft({ testId: 'T-1' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' },
    { type: 'toggleModel', side: 'B', modelKey: 'mB' }, { type: 'selfClash', value: true });
  const copy = duplicateDraft(src, { testId: 'T-2', name: 'x' });
  assert.equal(copy.selfClash, true);
  assert.deepEqual(copy.setB.modelKeys, ['mB']);
});

test('duplicateName: "<name> copy", then "copy 2", "copy 3"; truncated to the 256-character Core bound', () => {
  assert.equal(duplicateName('A', ['A']), 'A copy');
  assert.equal(duplicateName('A', ['A', 'A copy']), 'A copy 2');
  assert.equal(duplicateName('A', ['A', 'A copy', 'A copy 2']), 'A copy 3');
  const long = 'x'.repeat(256);
  const n1 = duplicateName(long, [long]);
  assert.equal(n1.length, 256);
  assert.ok(n1.endsWith(' copy'));
  const n2 = duplicateName(long, [long, n1]);
  assert.equal(n2.length, 256);
  assert.ok(n2.endsWith(' copy 2'));
});

test('MANAGER_INTENT is a separate frozen vocabulary that never collides with the editor INTENT values', () => {
  assert.ok(Object.isFrozen(MANAGER_INTENT));
  assert.deepEqual(Object.keys(MANAGER_INTENT).sort(),
    ['CANCEL', 'CONFIRM', 'CREATE', 'DELETE', 'DUPLICATE', 'OPEN', 'RESET', 'VIEW_EDITOR', 'VIEW_LIST']);
  const editor = new Set(Object.values(INTENT));
  for (const v of Object.values(MANAGER_INTENT)) assert.equal(editor.has(v), false, v);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashpanel/core/testDrafts.test.mjs`
Expected: FAIL — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/clashpanel/core/testDrafts.js'`.

- [ ] **Step 3: Implement**

Append to `clashpanel/core/intents.js` (after the `INTENT` export; the header comment gains one line: `MANAGER_INTENT: the Clash Tests manager's own vocabulary (spec §26.9); dispatched to the manager, never to the editor.`):

```js
// Spec §26.2a/§26.9: the Clash Tests manager's vocabulary. Payloads: OPEN/DUPLICATE/RESET/DELETE {testId};
// CONFIRM/CANCEL {operationId}; VIEW_LIST/VIEW_EDITOR/CREATE none. Values never collide with INTENT's.
export const MANAGER_INTENT = Object.freeze({
  VIEW_LIST: 'manager/viewList', VIEW_EDITOR: 'manager/viewEditor',
  OPEN: 'manager/open', CREATE: 'manager/create', DUPLICATE: 'manager/duplicate',
  RESET: 'manager/reset', DELETE: 'manager/delete',
  CONFIRM: 'manager/confirm', CANCEL: 'manager/cancel',
});
```

Create `clashpanel/core/testDrafts.js`:

```js
// clashpanel/core/testDrafts.js
// Spec §26.2 (a) / §26.4 and independent Work review M1: pure helpers over draft.js drafts for the Clash Tests
// manager. No clock, no id source, no global. `isLoadableDraft` is THE load-intent input invariant: a frozen draft in
// the EXACT canonical draft.js form whose testId is exactly the supplied testId. It is TOTAL (Work plan review M1):
// any exception from a hostile accessor or proxy trap is caught and the draft is refused — never thrown to the editor.
import { createDraft, draftReduce } from './draft.js';
import { isBasisChoice } from './measurementBasis.js';

const MAX_NAME = 256;   // Core schema bound for `name` (same value as draft.js MAX_NAME; §26.4 truncation)

// The canonical field sets (draft.js createDraft/freezeDraft/prepareRun). Sorted, compared as sets.
const DRAFT_KEYS = Object.freeze(['basisUnit', 'clearance', 'lastRun', 'mode', 'name', 'revision', 'selfClash', 'setA', 'setB', 'testCounter', 'testId']);
const SIDE_KEYS = Object.freeze(['elements', 'modelKeys']);
const LAST_RUN_KEYS = Object.freeze(['definitionKey', 'revision']);

const isDataProp = (obj, key) => {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') && d.enumerable === true;
};
/** A frozen object with Object.prototype whose own keys are exactly `keys` (strings only), each a plain data property. */
function isExactRecord(v, keys) {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype || !Object.isFrozen(v)) return false;
  const own = Reflect.ownKeys(v);
  return own.length === keys.length && keys.every((k) => isDataProp(v, k));
}
/** A frozen plain array of data-property elements and nothing else. */
function isExactArray(v) {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || !Object.isFrozen(v)) return false;
  if (Reflect.ownKeys(v).length !== v.length + 1) return false;                         // indices + `length` only
  for (let i = 0; i < v.length; i += 1) if (!isDataProp(v, String(i))) return false;
  return true;
}
const strictlyAscending = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] < x);   // sorted AND unique (draft.js canonical form)

/** A side exactly as draft.js freezes it: frozen side, frozen sorted-unique modelKeys, frozen non-empty sorted-unique id lists. */
function isSide(side) {
  if (!isExactRecord(side, SIDE_KEYS)) return false;
  const { modelKeys, elements } = side;
  if (!isExactArray(modelKeys) || !modelKeys.every((k) => typeof k === 'string' && k.length > 0) || !strictlyAscending(modelKeys)) return false;
  if (elements === null || typeof elements !== 'object' || Array.isArray(elements) || Object.getPrototypeOf(elements) !== Object.prototype || !Object.isFrozen(elements)) return false;
  const keys = Reflect.ownKeys(elements);
  // Any string key draft.js's setElements can produce (normalizeElements keeps every key with ≥ 1 valid id) …
  if (!keys.every((key) => typeof key === 'string' && isDataProp(elements, key))) return false;
  // … in exactly the own-key order normalizeElements yields (keys defined in sorted order), and ids as normalizeIds
  // yields them: safe integers ≥ 0, never -0 (draft.js maps -0 to 0), sorted and unique.
  if (keys.join('\u0000') !== canonicalKeyOrder(keys).join('\u0000')) return false;
  return keys.every((key) => {
    const ids = elements[key];
    return isExactArray(ids) && ids.length > 0 && ids.every((id) => Number.isSafeInteger(id) && id >= 0 && !Object.is(id, -0)) && strictlyAscending(ids);
  });
}

/** The own-key order of an object whose keys were defined in sorted order (integer-like keys enumerate first). */
function canonicalKeyOrder(keys) {
  const probe = {};
  for (const key of [...keys].sort()) Object.defineProperty(probe, key, { value: 0, enumerable: true });
  return Reflect.ownKeys(probe);
}

function isLoadableDraftUnsafe(draft, testId) {
  if (typeof testId !== 'string' || testId.length === 0) return false;
  if (!isExactRecord(draft, DRAFT_KEYS) || draft.testId !== testId) return false;
  const revision = draft.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return false;
  if (typeof draft.name !== 'string' || (draft.mode !== 'hard' && draft.mode !== 'soft')) return false;
  if (typeof draft.clearance !== 'string' || typeof draft.selfClash !== 'boolean' || !isBasisChoice(draft.basisUnit)) return false;
  if (!Number.isSafeInteger(draft.testCounter) || draft.testCounter < 1) return false;
  if (!isSide(draft.setA) || !isSide(draft.setB)) return false;
  const lastRun = draft.lastRun;
  if (lastRun === null) return true;
  // prepareRun (draft.js:195-196) writes lastRun.revision and draft.revision together; no reducer changes either.
  return isExactRecord(lastRun, LAST_RUN_KEYS) && typeof lastRun.definitionKey === 'string' && lastRun.definitionKey.length > 0
    && lastRun.revision === revision;
}

/**
 * Every value is read through ordinary property access exactly as the editor will later read it, so a throwing `get`
 * trap is exercised here. On a frozen target a proxy cannot report a different value for a non-writable,
 * non-configurable data property (Proxy invariants), so an accepted draft reads the same values afterwards.
 */
export function isLoadableDraft(draft, testId) {
  try {
    return isLoadableDraftUnsafe(draft, testId) === true;
  } catch {
    return false;
  }
}

/**
 * §26.4 Duplicate: a NEW draft (new testId, revision 1, lastRun null) with a copy of the setup — mode, clearance
 * text, self-clash, Set A, Set B and the basis attestation (applied LAST: the reducer drops an attestation whenever
 * the participant set changes, so it must be set after the sets). Built only through draft.js's public reducer.
 */
export function duplicateDraft(source, { testId, name }) {
  let d = createDraft({ testId, testNumber: source.testCounter });
  d = draftReduce(d, { type: 'name', value: name });
  d = draftReduce(d, { type: 'mode', value: source.mode });
  d = draftReduce(d, { type: 'clearance', value: source.clearance });
  d = draftReduce(d, { type: 'selfClash', value: source.selfClash });
  for (const [side, key] of [['A', 'setA'], ['B', 'setB']]) {
    for (const modelKey of source[key].modelKeys) d = draftReduce(d, { type: 'toggleModel', side, modelKey });
    d = draftReduce(d, { type: 'setElements', side, elements: source[key].elements });
  }
  if (source.basisUnit !== '') d = draftReduce(d, { type: 'basisUnit', value: source.basisUnit });
  return d;
}

/** `<name> copy`, else `<name> copy 2`, `copy 3`, … — the first not in `existingNames`; ≤ 256 characters. */
export function duplicateName(name, existingNames) {
  const taken = new Set(existingNames);
  const fit = (suffix) => `${name.length + suffix.length > MAX_NAME ? name.slice(0, MAX_NAME - suffix.length) : name}${suffix}`;
  let candidate = fit(' copy');
  for (let n = 2; taken.has(candidate); n += 1) candidate = fit(` copy ${n}`);
  return candidate;
}
```

Add `'core/testDrafts.js',` to `EXPECTED_MODULES` in `test/clashpanel/scaffold.test.mjs` directly after `'core/draft.js',`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/clashpanel/core/testDrafts.test.mjs test/clashpanel/scaffold.test.mjs test/clashpanel/layering.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 5: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6`
Expected: `ℹ fail 0`.

```bash
git add clashpanel/core/intents.js clashpanel/core/testDrafts.js test/clashpanel/core/testDrafts.test.mjs test/clashpanel/scaffold.test.mjs
git commit -m "feat(clashpanel): manager intent vocabulary and test-draft helpers (load invariant, duplicate)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Seal summary and the read-only `vm.test` snapshot (editor seam (b))

**Files:**
- Create: `clashpanel/core/testSummary.js`
- Modify: `clashpanel/core/controller.js` (state field `lastSealed`; one line in `onRunDone` before `touch(c)`; one line in `newTest`; `viewInput` gains `test: testInput(c)`; new `testInput`)
- Modify: `clashpanel/core/viewModel.js` (`buildViewModel` gains `test: buildTestSnapshot(input)`; header comment documents `test`)
- Modify: `test/clashpanel/core/controller.setupRun.test.mjs:34` (keys list gains `'test'` — Global Constraint 13 / gate G-A1)
- Modify: `test/clashpanel/scaffold.test.mjs` (add `'core/testSummary.js'` after `'core/testDrafts.js'`)
- Test: `test/clashpanel/core/testSummary.test.mjs`, `test/clashpanel/core/controller.testSnapshot.test.mjs`

**Interfaces:**
- Consumes: `runHeadline`, `STATEMENTS` (`runReport.js`); RunSummary `{runId, status, resultSet|null, persistence}`; RunState `{startedAtMs, progress:{caveatCount}}`.
- Produces:
  - `sealSummary({summary, runState, draft, sealedAt}) → frozen Summary` where Summary = `{runId, status, resultCount|null, coverage|null, integrity|null, freshnessAtSeal|null, caveatCount|null, models: frozen [{modelKey, bindingGeneration, modelVersion}], definitionKey|null, startedAt|null, sealedAt|null}` (§26.4 table; `resultsHeld` is derived later, never stored).
  - `summaryStatusText(summary) → string`.
  - Editor ViewModel `vm.test = {testId, draft (frozen, identity), runActive, heldUnsaved, pendingConfirm, lastRun: Summary|null}`; `lastRun` is set at seal and reset by the standalone `newTest()` path (this task) and by `TEST_LOAD` (Task 4) — it always describes the CURRENT draft's last run.

- [ ] **Step 1: Write the failing tests**

```js
// test/clashpanel/core/testSummary.test.mjs — spec §26.4 summary record and AC-M17 null-set runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealSummary, summaryStatusText } from '../../../clashpanel/core/testSummary.js';
import { STATEMENTS } from '../../../clashpanel/core/runReport.js';
import { makeSet, hardResults } from '../support/controllerHarness.mjs';

test('sealSummary captures the §26.4 fields from a sealed set; provenance is reduced to identity triples', () => {
  const set = makeSet({ runId: 'run-1', results: hardResults(3), coverage: 'partial', integrity: 'clean', freshness: 'current' });
  const s = sealSummary({
    summary: { runId: 'run-1', status: 'completed', resultSet: set },
    runState: { startedAtMs: 10, progress: { caveatCount: 2 } },
    draft: { lastRun: { definitionKey: 'K', revision: 1 } }, sealedAt: 25,
  });
  assert.deepEqual(s, {
    runId: 'run-1', status: 'completed', resultCount: 3, coverage: 'partial', integrity: 'clean', freshnessAtSeal: 'current', caveatCount: 2,
    models: [{ modelKey: 'mA', bindingGeneration: 1, modelVersion: 'v1' }, { modelKey: 'mB', bindingGeneration: 1, modelVersion: 'v1' }],
    definitionKey: 'K', startedAt: 10, sealedAt: 25,
  });
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.models) && Object.isFrozen(s.models[0]));
  assert.equal('results' in s, false, 'no results[], ledger or provenance beyond identity is retained');
});

test('AC-M17: a planning-stage cancel or failure (no set) has null counts/axes, models [] and keeps status, timing, definitionKey', () => {
  for (const status of ['cancelled', 'failed']) {
    const s = sealSummary({ summary: { runId: 'run-2', status, resultSet: null }, runState: { startedAtMs: 1, progress: null },
      draft: { lastRun: { definitionKey: 'K2', revision: 3 } }, sealedAt: 9 });
    assert.deepEqual(s, { runId: 'run-2', status, resultCount: null, coverage: null, integrity: null, freshnessAtSeal: null,
      caveatCount: null, models: [], definitionKey: 'K2', startedAt: 1, sealedAt: 9 });
  }
});

test('summaryStatusText: "<n> clashes reported" (0 included, never "No clashes"); a null set reads the §7.3 headline', () => {
  assert.equal(summaryStatusText({ status: 'completed', resultCount: 0, coverage: 'full' }), 'Completed — 0 clashes reported');
  assert.equal(summaryStatusText({ status: 'completed', resultCount: 1, coverage: 'full' }), 'Completed — 1 clash reported');
  assert.equal(summaryStatusText({ status: 'completed', resultCount: 12, coverage: 'partial' }), 'Completed — 12 clashes reported (partial coverage)');
  assert.equal(summaryStatusText({ status: 'cancelled', resultCount: 4, coverage: 'partial' }), 'Stopped — 4 clashes reported (partial coverage)');
  assert.equal(summaryStatusText({ status: 'cancelled', resultCount: null, coverage: null }), 'Stopped before any results');
  assert.equal(summaryStatusText({ status: 'failed', resultCount: null, coverage: null }), STATEMENTS.NO_RESULT_SET);
  assert.equal(summaryStatusText({ status: 'invalidated', resultCount: null, coverage: null }), STATEMENTS.MODEL_CHANGED);
  for (const n of [0, 3]) assert.doesNotMatch(summaryStatusText({ status: 'completed', resultCount: n, coverage: 'full' }), /no clashes/i);
});
```

```js
// test/clashpanel/core/controller.testSnapshot.test.mjs — spec §26.2 (b): the editor's read-only vm.test snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { INTENT } from '../../../clashpanel/core/intents.js';

const PENDING = { state: 'pending', timedOut: true, attempt: 1 };

test('vm.test mirrors the editor: testId, frozen draft (identity), runActive, heldUnsaved, pendingConfirm, lastRun', async () => {
  const h = makeHarness();
  const t0 = h.vm().test;
  assert.deepEqual(Object.keys(t0).sort(), ['draft', 'heldUnsaved', 'lastRun', 'pendingConfirm', 'runActive', 'testId']);
  assert.equal(t0.testId, 'test-1');
  assert.equal(t0.draft.testId, 'test-1');
  assert.equal(t0.lastRun, null);
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Walls' });
  assert.equal(h.vm().test.draft.name, 'Walls');
  assert.ok(Object.isFrozen(h.vm().test.draft));
  await h.readyHard();
  const handle = await h.start();
  assert.equal(h.vm().test.runActive, true);
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(2) }), persistence: PENDING });
  await h.settle();
  const t = h.vm().test;
  assert.equal(t.runActive, false);
  assert.equal(t.heldUnsaved, true);
  assert.equal(t.lastRun.runId, handle.runId);
  assert.equal(t.lastRun.status, 'completed');
  assert.equal(t.lastRun.resultCount, 2);
  assert.equal(t.lastRun.definitionKey, t.draft.lastRun.definitionKey);
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().test.pendingConfirm, true);
});

test('the seal notification itself already carries lastRun (captured before any retirement, §26.2a step 2)', async () => {
  const h = makeHarness();
  await h.readyHard();
  const seen = [];
  h.controller.subscribe((vm) => { if (vm.run.state === 'done') seen.push(vm.test.lastRun); });
  const handle = await h.start();
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(1) }) });
  await h.settle();
  assert.ok(seen.length >= 1);
  assert.equal(seen[0].runId, handle.runId);
});

test('standalone New test clears lastRun: a fresh testId never reports the previous test\'s run (Codex plan review C2)', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(2) }), { status: 'completed' });
  assert.notEqual(h.vm().test.lastRun, null);
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().test.testId, 'test-2');
  assert.equal(h.vm().test.lastRun, null);
});

test('lastRun survives Clear results and an admission failure (summary kept, §26.4/§26.7)', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(2) }), { status: 'completed' });
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().test.lastRun.runId, handle.runId);
  h.engine.failNextStart(new Error('admission refused'));
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.vm().test.lastRun.runId, handle.runId);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/clashpanel/core/testSummary.test.mjs test/clashpanel/core/controller.testSnapshot.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `testSummary.js`; the snapshot test fails with `TypeError: Cannot read properties of undefined (reading 'testId')` (no `vm.test`).

- [ ] **Step 3: Implement `testSummary.js`**

```js
// clashpanel/core/testSummary.js
// Spec §26.4: the per-test summary of the LAST sealed run, captured once at seal by the editor, and its row wording.
// Pure. Nothing of the set is retained beyond counts/axes and the provenance identity triples (no results[], no
// ledger). A count is always "reported" — a summary never makes a no-clash claim (PD-12; the claim needs a held set).
import { runHeadline } from './runReport.js';

const num = (v) => (Number.isFinite(v) ? v : null);

export function sealSummary({ summary, runState, draft, sealedAt }) {
  const set = summary?.resultSet ?? null;
  const rows = set === null || !Array.isArray(set.provenance?.models) ? [] : set.provenance.models;
  const models = rows
    .filter((m) => m !== null && typeof m === 'object' && typeof m.modelKey === 'string')
    .map((m) => Object.freeze({ modelKey: m.modelKey, bindingGeneration: m.bindingGeneration, modelVersion: m.modelVersion }));
  return Object.freeze({
    runId: typeof summary?.runId === 'string' ? summary.runId : null,
    status: typeof summary?.status === 'string' ? summary.status : null,
    resultCount: set === null ? null : (Array.isArray(set.results) ? set.results.length : null),
    coverage: set === null ? null : (set.outcome?.coverage ?? null),
    integrity: set === null ? null : (set.outcome?.integrity ?? null),
    freshnessAtSeal: set === null ? null : (set.outcome?.freshness ?? null),
    caveatCount: set === null ? null : num(runState?.progress?.caveatCount),
    models: Object.freeze(models),
    definitionKey: typeof draft?.lastRun?.definitionKey === 'string' ? draft.lastRun.definitionKey : null,
    startedAt: num(runState?.startedAtMs),
    sealedAt: num(sealedAt),
  });
}

const RUN_LABEL = Object.freeze({ completed: 'Completed', cancelled: 'Stopped', failed: 'Failed', invalidated: 'Model changed during the run' });

export function summaryStatusText(summary) {
  const status = summary?.status;
  if (summary?.resultCount === null || summary?.resultCount === undefined) {
    return status === 'cancelled' || status === 'failed' || status === 'invalidated'
      ? runHeadline({ status, total: 0, coverage: null, resultSet: null })
      : 'The run ended without a result set.';
  }
  const n = summary.resultCount;
  return `${RUN_LABEL[status] ?? 'Ended'} — ${n === 1 ? '1 clash' : `${n} clashes`} reported${summary.coverage === 'partial' ? ' (partial coverage)' : ''}`;
}
```

- [ ] **Step 4: Implement the controller and ViewModel changes**

In `clashpanel/core/controller.js`:
1. Add `import { sealSummary } from './testSummary.js';` after the `buildViewModel` import.
2. In the state object `c`, after `runRecord: null,` add: `lastSealed: null,                      // §26.4 summary of the last sealed run of THIS draft (vm.test.lastRun)`.
3. In `onRunDone`, directly after the line `c.displayed = { runId: summary.runId, … };` add:
   ```js
   c.lastSealed = sealSummary({ summary, runState: c.run, draft: c.draft, sealedAt: c.scheduler.now() });   // §26.2 (b)
   ```
   and in `newTest(c, acknowledgeUnsaved)`, directly after `c.draft = draftReduce(c.draft, { type: 'newTest', testId: c.mintId() });`, add:
   ```js
   c.lastSealed = null;                                            // §26.2 (b): the new draft has no run yet
   ```
4. In `viewInput(c)`, add `test: testInput(c),` after `selected: selectedInput(c),` and add after `selectedInput`:
   ```js
   /** §26.2 (b): read-only snapshot for the Clash Tests manager. `draft` is the frozen draft itself (identity). */
   function testInput(c) {
     return { testId: c.draft.testId, draft: c.draft, runActive: isActive(c), heldUnsaved: heldUnsaved(c), pendingConfirm: c.confirm !== null, lastRun: c.lastSealed };
   }
   ```

In `clashpanel/core/viewModel.js`, add before `buildViewModel`:

```js
// ── test snapshot (spec §26.2 (b)) ──────────────────────────────────────────────────────────────────────────────

function buildTestSnapshot(input) {
  const t = input.test;
  if (t === undefined || t === null) return null;
  return {
    testId: t.testId, draft: t.draft, runActive: t.runActive === true, heldUnsaved: t.heldUnsaved === true,
    pendingConfirm: t.pendingConfirm === true, lastRun: t.lastRun ?? null,
  };
}
```

and in `buildViewModel` add `test: buildTestSnapshot(input),` after `selected: buildSelectedRegion(input),`. Add one line to the ViewInput header comment: `//     test:      { testId, draft, runActive, heldUnsaved, pendingConfirm, lastRun|null }  (spec §26.2 (b); manager seam)`.

In `test/clashpanel/core/controller.setupRun.test.mjs` line 34 change the expected list to `['filters', 'results', 'run', 'selected', 'setup', 'test', 'version']`. Add `'core/testSummary.js',` to the scaffold list after `'core/testDrafts.js',`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/clashpanel/core/testSummary.test.mjs test/clashpanel/core/controller.testSnapshot.test.mjs test/clashpanel/core/controller.setupRun.test.mjs test/clashpanel/core/viewModel.test.mjs test/clashpanel/scaffold.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 6: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/testSummary.js clashpanel/core/controller.js clashpanel/core/viewModel.js test/clashpanel/core/testSummary.test.mjs test/clashpanel/core/controller.testSnapshot.test.mjs test/clashpanel/core/controller.setupRun.test.mjs test/clashpanel/scaffold.test.mjs
git commit -m "feat(clashpanel): seal summary and read-only vm.test editor snapshot (spec §26.2 (b))

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Atomic `TEST_LOAD`, `CONFIRM_CANCEL` and `TEST_LABEL_SCOPE` intents (editor seams (a), (c), (e))

**Files:**
- Modify: `clashpanel/core/intents.js` (three `INTENT` entries + header comment lines)
- Modify: `clashpanel/core/controller.js` (import `isLoadableDraft`; `LOAD_REASON`, `loadRefusal`, `onTestLoad`, `onConfirmCancel`, `onTestLabelScope`; state field `labelScope`; the `knownModelKeys` callback at `controller.js:70` gains `...c.labelScope`; three `DISPATCH` entries; disposed branch in `dispatch()`)
- Test: `test/clashpanel/core/controller.loadTest.test.mjs`

**Interfaces:**
- Consumes: `isLoadableDraft` (Task 2); existing private `retireDisplayed`, `revalidate`, `heldUnsaved`, `isActive`, `touch`.
- Produces:
  - `INTENT.TEST_LOAD = 'test/load'` — payload `{testId, draft, acknowledgeUnsaved?: boolean}`; `dispatch` resolves `LoadResult = {ok:true, testId, version, releaseStuck}` or `{ok:false, testId: <id the editor still holds>, version, releaseStuck, reason: 'invalid-test-id'|'invalid-draft'|'run-active'|'unsaved-results'|'disposed'}`. Refusals mutate nothing and notify nobody.
  - `INTENT.CONFIRM_CANCEL = 'confirm/cancel'` — no payload; clears `c.confirm` (one notification) and nothing else; a no-op without a pending confirmation.
  - **Seam (e), owner decision G-A2:** `INTENT.TEST_LABEL_SCOPE = 'test/labelScope'` — payload `{modelKeys: string[]}` (the manager's complete referenced-model-key scope: every key in any record's Set A/Set B `modelKeys`, Set A/Set B `elements` keys and `summary.models`). The editor stores it as `c.labelScope` (frozen, sorted, unique, non-empty strings; initially `[]`), and its label resolver's `knownModelKeys` becomes `displayed-run keys ∪ c.labelScope`, so `labels.modelName` disambiguates over exactly the same key set as the manager rows (`catalog.list()` keys ∪ that scope). A changed scope calls `c.labels.invalidateNames()` and notifies once; an identical scope or a non-array payload is a no-op with no notification. Resolves `undefined`. Never touches the draft, run, results, Viewer or engine.

- [ ] **Step 1: Write the failing tests**

```js
// test/clashpanel/core/controller.loadTest.test.mjs — spec §26.2 (a)/(c), CTM-1, Work review M1 (editor half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';

const SAVED = { state: 'saved', timedOut: false, attempt: 1 };
const PENDING = { state: 'pending', timedOut: true, attempt: 1 };
const otherAB = (id = 'T-other') => [
  { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' },
].reduce(draftReduce, createDraft({ testId: id, testNumber: 7 }));

async function sealed(h, persistence = SAVED) {
  await h.readyHard();
  const handle = await h.start();
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(2) }), persistence });
  await h.settle();
  return handle;
}
function watch(h) { const ids = []; h.controller.subscribe((vm) => ids.push(vm.test.testId)); return ids; }
const clears = (h) => h.bridge.calls.filter((c) => c.op === 'clear').length;

test('TEST_LOAD adopts the supplied draft, retires the displayed set, forces Soft re-evaluation, notifies once', async () => {
  const h = makeHarness();
  await sealed(h);
  const ids = watch(h);
  const clearsBefore = clears(h);
  const basisBefore = h.catalog.calls.measurementBasis.length;
  const d = otherAB();
  const pending = h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: d, acknowledgeUnsaved: false });
  assert.deepEqual(ids, ['T-other'], 'one SYNCHRONOUS notification, only with the supplied testId');
  const loadedVersion = h.vm().version;
  assert.equal(h.catalog.calls.measurementBasis.length, basisBefore + 1, 'same participants, still re-evaluated (reEvaluateSoft)');
  const out = await pending;
  assert.deepEqual(out, { ok: true, testId: 'T-other', version: loadedVersion, releaseStuck: false });
  assert.equal(h.vm().test.draft, d, 'the supplied frozen draft itself');
  assert.equal(clears(h), clearsBefore + 1);
  assert.equal(h.engine.resident.size, 0, 'outgoing saved set released');
  assert.equal(h.vm().test.lastRun, null);
  assert.equal(h.vm().run.state, 'idle');
  await h.settle();
  assert.ok(ids.every((id) => id === 'T-other'), 'later async notifications (Soft verdict) carry the same testId');
});

for (const [label, intent, reason] of [
  ['empty testId', { testId: '', draft: otherAB() }, 'invalid-test-id'],
  ['missing testId', { draft: otherAB() }, 'invalid-test-id'],
  ['draft for another testId', { testId: 'T-x', draft: otherAB('T-y') }, 'invalid-draft'],
  ['unfrozen draft', { testId: 'T-other', draft: { ...otherAB() } }, 'invalid-draft'],
  ['no draft', { testId: 'T-other' }, 'invalid-draft'],
  // Work plan review M1: exact canonical form and a total validator — still zero mutation and no notification.
  ['draft with an extra field', { testId: 'T-other', draft: Object.freeze({ ...otherAB(), extra: 1 }) }, 'invalid-draft'],
  ['lastRun.revision differing from revision', { testId: 'T-other', draft: Object.freeze({ ...otherAB(), lastRun: Object.freeze({ definitionKey: 'k', revision: 2 }) }) }, 'invalid-draft'],
  ['draft with a throwing accessor', { testId: 'T-other', draft: Object.freeze(Object.defineProperty({ ...otherAB() }, 'name', { get() { throw new Error('hostile'); }, enumerable: true })) }, 'invalid-draft'],
  ['proxy draft with a throwing trap', { testId: 'T-other', draft: new Proxy(otherAB(), { ownKeys() { throw new Error('hostile'); } }) }, 'invalid-draft'],
]) {
  test(`TEST_LOAD rejects ${label} atomically: zero mutation, no notification, no Viewer call`, async () => {
    const h = makeHarness();
    await sealed(h);
    const before = h.vm();
    const ids = watch(h);
    const clearsBefore = clears(h);
    const out = await h.controller.dispatch({ type: INTENT.TEST_LOAD, ...intent });
    assert.deepEqual(out, { ok: false, testId: 'test-1', version: before.version, releaseStuck: false, reason });
    assert.equal(h.vm(), before, 'same frozen ViewModel object: nothing changed');
    assert.deepEqual(ids, []);
    assert.equal(clears(h), clearsBefore);
    assert.equal(h.engine.resident.size, 1, 'held set untouched');
  });
}

test('TEST_LOAD is refused while a run is active, and for unsaved results without acknowledgeUnsaved', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.start();
  const running = h.vm();
  assert.equal((await h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() })).reason, 'run-active');
  assert.equal(h.vm(), running);

  const u = makeHarness();
  await sealed(u, PENDING);
  const before = u.vm();
  assert.equal((await u.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() })).reason, 'unsaved-results');
  assert.equal(u.vm(), before);
  const ok = await u.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB(), acknowledgeUnsaved: true });
  assert.equal(ok.ok, true);
  assert.equal(u.engine.resident.size, 0, 'unsaved set released only with the acknowledgement');
});

test('TEST_LOAD on a disposed editor resolves {ok:false, reason:"disposed"}', async () => {
  const h = makeHarness();
  await h.controller.dispose();
  const out = await h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'disposed');
});

test('a stuck release still loads, reports releaseStuck, keeps the release-error banner and the retry list', async () => {
  const h = makeHarness();
  await sealed(h);
  h.engine.setReleaseFailure(new Error('store down'));
  const out = await h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() });
  assert.equal(out.ok, true);
  assert.equal(out.releaseStuck, true);
  assert.ok(h.vm().run.banners.some((b) => b.id === 'release-error'), 'existing release-error banner (viewModel.js controllerBanners)');
  h.engine.setReleaseFailure(null);
});

test('CONFIRM_CANCEL clears the editor confirmation and does nothing else; a no-op without one (§26.2 (c))', async () => {
  const h = makeHarness();
  const idle = h.vm();
  await h.dispatch({ type: INTENT.CONFIRM_CANCEL });
  assert.equal(h.vm(), idle, 'no confirmation pending: nothing happens');
  await sealed(h, PENDING);
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().test.pendingConfirm, true);
  await h.dispatch({ type: INTENT.CONFIRM_CANCEL });
  assert.equal(h.vm().test.pendingConfirm, false);
  assert.equal(h.engine.resident.size, 1, 'results still held');
  assert.equal(h.vm().run.state, 'done');
});

test('standalone New test keeps the §23.5 in-place semantics (AC-M13)', async () => {
  const h = makeHarness();
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().test.testId, 'test-2');
  assert.equal(h.vm().test.draft.name, 'Clash test 2');
});

test('seam (e) TEST_LABEL_SCOPE: the editor disambiguates over the supplied scope; identical scope and bad payloads are no-ops (G-A2)', async () => {
  const h = makeHarness({ displayNames: { mA: 'Arch', mB: 'Arch' } });
  h.catalog.removeModel('mB');                                     // mB unloaded: only a referenced scope still knows it
  h.catalog.fire();
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  assert.equal(h.vm().setup.scope.A, 'Arch', 'standalone editor (empty scope): unchanged behavior');
  const viewerCalls = h.bridge.calls.length;
  const ids = watch(h);
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: ['mB', 'mA', 'mB'] });
  assert.equal(ids.length, 1, 'one notification for a changed scope');
  assert.equal(h.vm().setup.scope.A, 'Arch · …mA');
  assert.equal(h.vm().setup.models.find((m) => m.modelKey === 'mA').displayName, 'Arch · …mA');
  const same = h.vm();
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: ['mA', 'mB'] });
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: 'mB' });
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE });
  assert.equal(h.vm(), same, 'identical scope / non-array payload: no change, no notification');
  assert.equal(ids.length, 1);
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: [] });
  assert.equal(h.vm().setup.scope.A, 'Arch', 'shrinking the scope invalidates the names again');
  assert.equal(h.bridge.calls.length, viewerCalls, 'never touches the Viewer');
  assert.equal(h.engine.startCalls.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashpanel/core/controller.loadTest.test.mjs`
Expected: FAIL — `TypeError: unknown intent: undefined` (the `INTENT.TEST_LOAD` key does not exist yet).

- [ ] **Step 3: Implement**

`clashpanel/core/intents.js` — inside `INTENT`, after `DIAGNOSTICS_COPY: 'diagnostics/copy',` add:

```js
  TEST_LOAD: 'test/load',          // spec §26.2 (a): manager-only seam; resolves a LoadResult
  CONFIRM_CANCEL: 'confirm/cancel', // spec §26.2 (c): drops the editor's pending one-time confirmation
  TEST_LABEL_SCOPE: 'test/labelScope', // seam (e), owner decision G-A2: manager-only; the referenced-model-key label scope
```

and add to the header comment: `TEST_LOAD: {testId, draft, acknowledgeUnsaved?} — resolves {ok, testId, version, releaseStuck, reason?} (the second intent that resolves a value); CONFIRM_CANCEL: no payload; TEST_LABEL_SCOPE: {modelKeys: string[]} — model keys that count as KNOWN for model-name disambiguation (seam (e)).`

`clashpanel/core/controller.js`:
1. `import { isLoadableDraft } from './testDrafts.js';`
1a. Seam (e): in the state object `c`, after `runRecord: null,` add `labelScope: Object.freeze([]),          // seam (e), G-A2: manager's referenced-model-key scope ([] standalone)`; and in the `createLabelResolver` call change the `knownModelKeys` callback (`controller.js:70`) to:
   ```js
    // Models known only from the displayed run (e.g. unloaded since) still count for name disambiguation (RF-2), plus
    // — seam (e), G-A2 — every key the Clash Tests manager's records reference, so list and editor labels agree.
    knownModelKeys: () => [...(c.displayed?.resultSet?.provenance?.models ?? []).map((m) => m.modelKey), ...c.labelScope],
   ```
2. After `onSetupToggleCollapsed`, add:

```js
// ── Clash Tests manager seam (spec §26.2 (a)/(c); additive, unused by the standalone editor) ───────────────────

const LOAD_REASON = Object.freeze({
  INVALID_ID: 'invalid-test-id', INVALID_DRAFT: 'invalid-draft', RUN_ACTIVE: 'run-active', UNSAVED: 'unsaved-results', DISPOSED: 'disposed',
});

/** A refused load: nothing changed; `testId` is the test the editor STILL holds. */
function loadRefusal(c, reason) {
  return Object.freeze({ ok: false, testId: c.draft.testId, version: c.version, releaseStuck: c.releaseStuck, reason });
}

/**
 * Atomic load (Work review M1): every precondition is checked BEFORE any mutation; a refusal mutates nothing and
 * notifies nobody. On success it runs exactly the `newTest` path with the SUPPLIED draft (retireDisplayed → adopt →
 * reset run bookkeeping → forced Soft re-evaluation) and notifies once, with that draft's testId.
 */
function onTestLoad(c, intent) {
  if (c.disposed) return loadRefusal(c, LOAD_REASON.DISPOSED);
  const { testId, draft } = intent;
  if (typeof testId !== 'string' || testId.length === 0) return loadRefusal(c, LOAD_REASON.INVALID_ID);
  if (!isLoadableDraft(draft, testId)) return loadRefusal(c, LOAD_REASON.INVALID_DRAFT);
  if (isActive(c)) return loadRefusal(c, LOAD_REASON.RUN_ACTIVE);
  const acknowledgeUnsaved = intent.acknowledgeUnsaved === true;
  if (!acknowledgeUnsaved && heldUnsaved(c)) return loadRefusal(c, LOAD_REASON.UNSAVED);
  c.confirm = null;
  retireDisplayed(c, { acknowledgeUnsaved });
  c.draft = draft;
  c.lastSealed = null;
  c.hasRun = false;
  c.setupChanged = false;
  c.setupCollapsed = false;
  c.admission = null;
  revalidate(c, { reEvaluateSoft: true });
  touch(c);
  return Object.freeze({ ok: true, testId: c.draft.testId, version: c.version, releaseStuck: c.releaseStuck });
}

function onConfirmCancel(c) {
  if (c.confirm === null) return;
  c.confirm = null;
  touch(c);
}

/**
 * Seam (e), owner decision G-A2 (Work plan review H2): the manager's referenced-model-key scope joins the label
 * resolver's known keys, so `labels.modelName` disambiguates over the same key set as the manager rows. A changed scope
 * invalidates the cached names and notifies once; an identical scope or a non-array payload changes nothing.
 */
function onTestLabelScope(c, intent) {
  if (!Array.isArray(intent.modelKeys)) return;
  const next = [...new Set(intent.modelKeys.filter((k) => typeof k === 'string' && k.length > 0))].sort();
  if (next.join('\u0000') === c.labelScope.join('\u0000')) return;
  c.labelScope = Object.freeze(next);
  c.labels.invalidateNames();
  touch(c);
}
```

3. In `DISPATCH` add `[INTENT.TEST_LOAD]: onTestLoad,`, `[INTENT.CONFIRM_CANCEL]: onConfirmCancel,` and `[INTENT.TEST_LABEL_SCOPE]: onTestLabelScope,`.
4. In `dispatch()`, replace `if (c.disposed) return Promise.resolve(undefined);` with:

```js
  if (c.disposed) return Promise.resolve(intent.type === INTENT.TEST_LOAD ? loadRefusal(c, LOAD_REASON.DISPOSED) : undefined);
```

and update the doc comment above `dispatch` to: `known intents resolve after their effect (with undefined, except DIAGNOSTICS_COPY — the diagnostics string — and TEST_LOAD — its LoadResult).`

- [ ] **Step 4: Run the tests**

Run: `node --test test/clashpanel/core/controller.loadTest.test.mjs test/clashpanel/core/controller.navigation.test.mjs test/clashpanel/core/controller.setupRun.test.mjs`
Expected: PASS — `ℹ fail 0` (the existing "every INTENT value is handled" test now dispatches `TEST_LOAD` with `value:false` and receives a refusal, and `CONFIRM_CANCEL` and `TEST_LABEL_SCOPE` (no `modelKeys` array) as no-ops).

- [ ] **Step 5: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/intents.js clashpanel/core/controller.js test/clashpanel/core/controller.loadTest.test.mjs
git commit -m "feat(clashpanel): atomic TEST_LOAD, CONFIRM_CANCEL and TEST_LABEL_SCOPE editor seams (spec §26.2 (a)/(c), seam (e) G-A2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Per-test readiness and "models changed" (pure)

**Files:**
- Create: `clashpanel/core/testReadiness.js`
- Modify: `test/clashpanel/scaffold.test.mjs` (add `'core/testReadiness.js'` after `'core/testSummary.js'`)
- Test: `test/clashpanel/core/testReadiness.test.mjs`

**Interfaces:**
- Consumes: `buildDefinition`, `participantKeysOf` (`draft.js`); `resolveSide` (`resolve.js`).
- Produces:
  - `READINESS = {COMPLETE:'setup-complete', LOADING:'models-loading', MISSING:'models-missing', INCOMPLETE:'incomplete'}`, `READINESS_TEXT`.
  - `referencedModelKeys(draft) → string[]` (Set A, plus Set B unless self-clash; sorted).
  - `readinessOf({draft, entries, bindingFor, modelName}) → {state, text, models:[{modelKey, name, state:'loaded'|'loading'|'missing'}]}`. Precedence (plan decision P-6): `models-missing` > `models-loading` > `incomplete` > `setup-complete`. `incomplete` = a `buildDefinition(draft, {verifiedBasis:true})` problem on `setA`/`setB`/`clearance` (basis never evaluated, AC-M19).
  - `modelsChangedOf({summary, bindingFor, catalog}) → boolean` — the §9.1 check (`resolveSide`) per `summary.models` row; `false` for a null summary or `models: []`.

- [ ] **Step 1: Write the failing tests**

```js
// test/clashpanel/core/testReadiness.test.mjs — spec §26.6 readiness / "models changed", AC-M10, AC-M17, AC-M19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';
import { readinessOf, modelsChangedOf, READINESS } from '../../../clashpanel/core/testReadiness.js';

const reduce = (d, ...a) => a.reduce(draftReduce, d);
const MA = { id: 'A' };
const MB = { id: 'B' };
const NAMES = { mA: 'Architecture', mB: 'Structure' };
const modelName = (k) => NAMES[k] ?? `Model ${k}`;
const binding = (model, over = {}) => ({ model, bindingGeneration: 1, modelVersion: 'v1', ...over });
function world({ entries = [{ modelKey: 'mA', model: MA, loaded: true }, { modelKey: 'mB', model: MB, loaded: true }], bindings = { mA: binding(MA), mB: binding(MB) } } = {}) {
  return { entries, bindingFor: (k) => bindings[k] ?? null, catalog: { list: () => entries } };
}
const ab = () => reduce(createDraft({ testId: 'T' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
const read = (draft, w = world()) => readinessOf({ draft, entries: w.entries, bindingFor: w.bindingFor, modelName });

test('setup-complete: both sides set, every referenced model listed, loaded and bound; the copy never says "ready"', () => {
  const r = read(ab());
  assert.equal(r.state, READINESS.COMPLETE);
  assert.equal(r.text, 'Setup complete — readiness to run is checked when opened');
  assert.doesNotMatch(r.text, /\bready\b/i);
  assert.deepEqual(r.models, [{ modelKey: 'mA', name: 'Architecture', state: 'loaded' }, { modelKey: 'mB', name: 'Structure', state: 'loaded' }]);
});

test('incomplete: an empty side, or Soft without a clearance', () => {
  assert.equal(read(createDraft({ testId: 'T' })).state, READINESS.INCOMPLETE);
  assert.equal(read(reduce(createDraft({ testId: 'T' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' })).state, READINESS.INCOMPLETE);
  assert.equal(read(reduce(ab(), { type: 'mode', value: 'soft' })).state, READINESS.INCOMPLETE);
  assert.equal(read(reduce(ab(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.1' })).state, READINESS.COMPLETE);
});

test('AC-M19: a multi-model Soft test without a basis attestation reads setup-complete (rows never evaluate the basis)', () => {
  const soft = reduce(ab(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.1' });
  assert.equal(soft.basisUnit, '');
  assert.equal(read(soft).state, READINESS.COMPLETE);
});

test('models-missing: absent from the catalog or unbound — one "<model> is not loaded" per model', () => {
  const r = read(ab(), world({ entries: [{ modelKey: 'mA', model: MA, loaded: true }] }));
  assert.equal(r.state, READINESS.MISSING);
  assert.equal(r.text, 'Structure is not loaded');
  assert.equal(read(ab(), world({ bindings: { mA: binding(MA) } })).state, READINESS.MISSING);
  assert.equal(read(ab(), world({ entries: [], bindings: {} })).text, 'Architecture is not loaded; Structure is not loaded');
});

test('models-loading: listed and bound but not load-complete; precedence missing > loading > incomplete', () => {
  const loading = world({ entries: [{ modelKey: 'mA', model: MA, loaded: false }, { modelKey: 'mB', model: MB, loaded: true }] });
  assert.equal(read(ab(), loading).state, READINESS.LOADING);
  assert.equal(read(ab(), world({ entries: [{ modelKey: 'mA', model: MA, loaded: false }] })).state, READINESS.MISSING);
  assert.equal(read(reduce(ab(), { type: 'mode', value: 'soft' }), loading).state, READINESS.LOADING);
});

test('self-clash references Set A only', () => {
  const d = reduce(createDraft({ testId: 'T' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' },
    { type: 'toggleModel', side: 'B', modelKey: 'mGone' }, { type: 'selfClash', value: true });
  assert.equal(read(d).state, READINESS.COMPLETE);
});

test('modelsChangedOf: the §9.1 identity check per summary model; a null summary or models [] never marks a row', () => {
  const w = world();
  const summary = { models: [{ modelKey: 'mA', bindingGeneration: 1, modelVersion: 'v1' }, { modelKey: 'mB', bindingGeneration: 1, modelVersion: 'v1' }] };
  const changed = (x, s = summary) => modelsChangedOf({ summary: s, bindingFor: x.bindingFor, catalog: x.catalog });
  assert.equal(changed(w, null), false);
  assert.equal(changed(w, { models: [] }), false);
  assert.equal(changed(w), false);
  assert.equal(changed(world({ bindings: { mA: binding(MA, { bindingGeneration: 2 }), mB: binding(MB) } })), true, 'rebound');
  assert.equal(changed(world({ bindings: { mA: binding(MA), mB: binding(MB, { modelVersion: 'v2' }) } })), true, 'new version');
  assert.equal(changed(world({ entries: [{ modelKey: 'mA', model: MA, loaded: true }] })), true, 'not in the scene');
  assert.equal(changed(world({ bindings: { mA: binding(MA) } })), true, 'binding gone');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashpanel/core/testReadiness.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `testReadiness.js`.

- [ ] **Step 3: Implement**

```js
// clashpanel/core/testReadiness.js
// Spec §26.6: per-record readiness and "models changed since this run", computed for EVERY record from data the
// Panel already has — the catalog snapshot and registry.bindingFor — with no engine call that needs a held set.
// Readiness is advisory: the editor's validateSetup remains the only Run gate, and the Soft basis is NOT evaluated
// here (it is async and host-supplied; the editor evaluates it on activation, §23). "Models changed" is a Panel-local
// liveness fact (the §9.1 check), never Core freshness. Pure.
import { buildDefinition, participantKeysOf } from './draft.js';
import { resolveSide } from './resolve.js';

export const READINESS = Object.freeze({ COMPLETE: 'setup-complete', LOADING: 'models-loading', MISSING: 'models-missing', INCOMPLETE: 'incomplete' });
export const READINESS_TEXT = Object.freeze({
  'setup-complete': 'Setup complete — readiness to run is checked when opened',
  'models-loading': 'Models are still loading',
  incomplete: 'Setup incomplete',
});
const INCOMPLETE_CONTROLS = new Set(['setA', 'setB', 'clearance']);

export function referencedModelKeys(draft) {
  return participantKeysOf(draft);
}

export function readinessOf({ draft, entries, bindingFor, modelName }) {
  const byKey = new Map();
  for (const e of Array.isArray(entries) ? entries : []) if (typeof e?.modelKey === 'string') byKey.set(e.modelKey, e);
  const models = referencedModelKeys(draft).map((modelKey) => {
    const entry = byKey.get(modelKey);
    let binding = null;
    try { binding = bindingFor(modelKey) ?? null; } catch { binding = null; }
    const state = entry === undefined || binding === null ? 'missing' : entry.loaded === true ? 'loaded' : 'loading';
    return { modelKey, name: modelName(modelKey), state };
  });
  const { problems } = buildDefinition(draft, { verifiedBasis: true });
  const incomplete = problems.some((p) => INCOMPLETE_CONTROLS.has(p.control));
  const missing = models.filter((m) => m.state === 'missing');
  let state = READINESS.COMPLETE;
  if (missing.length > 0) state = READINESS.MISSING;
  else if (models.some((m) => m.state === 'loading')) state = READINESS.LOADING;
  else if (incomplete) state = READINESS.INCOMPLETE;
  const text = state === READINESS.MISSING ? missing.map((m) => `${m.name} is not loaded`).join('; ') : READINESS_TEXT[state];
  return { state, text, models };
}

export function modelsChangedOf({ summary, bindingFor, catalog }) {
  const rows = Array.isArray(summary?.models) ? summary.models : [];
  if (rows.length === 0) return false;
  const provenance = { models: rows };
  const engine = { registry: { bindingFor } };
  return rows.some((row) => resolveSide({ ref: { modelKey: row.modelKey, dbId: 0 }, provenance, engine, catalog }).state !== 'live');
}
```

Add `'core/testReadiness.js',` to the scaffold list after `'core/testSummary.js',`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/clashpanel/core/testReadiness.test.mjs test/clashpanel/scaffold.test.mjs test/clashpanel/layering.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 5: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/testReadiness.js test/clashpanel/core/testReadiness.test.mjs test/clashpanel/scaffold.test.mjs
git commit -m "feat(clashpanel): per-test readiness and models-changed checks (spec §26.6)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Manager ViewModel builder and the single action-gate rule (pure)

**Files:**
- Create: `clashpanel/core/managerViewModel.js`
- Modify: `clashpanel/core/viewModel.js` (`function describeScope` → `export function describeScope`; no behavior change)
- Modify: `test/clashpanel/scaffold.test.mjs` (add `'core/managerViewModel.js'` after `'core/testReadiness.js'`)
- Test: `test/clashpanel/core/managerViewModel.test.mjs`

**Interfaces:**
- Consumes: `describeScope`, `DISCARD_TEXT` (`viewModel.js`); `buildDefinition`, `definitionKey` (`draft.js`); `summaryStatusText` (Task 3); `BASIS_RAW` (`constants.js`).
- Produces — **GateState** (the one state shape shared by the builder and the manager's handlers):
  `{view, activeTestId, records:[{testId, draft, summary}], editorVm:{version, test, run}, pending: null|{operationId, kind, sourceTestId, targetTestId, state:'awaiting'|'executing', discardsUnsaved}, fault: null|{text}, busy: boolean, notice, live, scopeName(modelKey)→string, readiness: Map<testId, Readiness>, modelsChanged: Map<testId, boolean>}`.
  - `actionGate(state, action: 'create'|'open'|'duplicate'|'reset'|'delete', testId?) → {enabled, reason}`.
  - `lockedEditorVm(editorVm, reason, policy) → deep-frozen copy` — THE fault overlay (used by Task 9 while faulted, with `policy = FAULT_POLICY`; Work plan re-review M1). The fixed control families below are locked unconditionally — they are exactly `FAULT_POLICY`'s blocked user-facing intents, an equality pinned by the Task 9/11 `FAULT_CONTROLS` equivalence tests (a policy change fails them until the overlay is updated) — and only banner actions, whose intent is data, consult `policy`. Every user-facing control whose intent the policy blocks reports the existing `{enabled:false, reason}` gate shape (`viewModel.js` `buildSelectedRegion`): `setup.locked` and `setup.newTest` = gate, `setup.useSelectionEnabled:false`; `run.canRun:false`, `run.locked` = gate; each `run.banners[i].action` whose `intent.type` is not `'allow'` in `policy` (fail closed) gains `enabled:false, reason`; `results.select` = gate (result-row selection), `results.nav` gets `canPrev:false, canNext:false, locked` = gate; `selected.actions.{focus, isolate, markers, backToAll}` get `enabled:false, reason` (Isolate/Markers keep `checked`). Nothing else changes: `filters`, `results.page`/`rows`, `selected.actions.focusOnSelect`, `run.canStop`, allow-listed banner actions, `test` and `version` are carried over by reference; an absent region stays absent. The input is never written (copy/overlay only).
  - `resultsHeldFor(editorVm, summary) → boolean`.
  - `buildManagerViewModel(state) → deep-frozen ManagerVM` = `{view, activeTestId, activeName, count, create, pending: null|{operationId, kind, sourceTestId, targetTestId|null}, confirm: null|{operationId, text, confirmLabel, cancelLabel, enabled}, notice, fault: null|{text}, editorLock: null|{enabled:false, reason}, live, tests:[Row]}`; Row = `{testId, name, active, modeText, setA, setB, status:{kind, text}, resultCount, resultsText, setupChangedSinceRun, readiness, modelsChanged, modelsChangedText, actions:{open, duplicate, reset, delete}}` (§26.9; `modelsChangedText` and `confirm.enabled` are plan additions P-10 so all strings/enablement live in core).
  - `MANAGER_TEXT` (all manager copy; functions for interpolated strings).

- [ ] **Step 1: Write the failing tests**

```js
// test/clashpanel/core/managerViewModel.test.mjs — spec §26.9 ViewModel, §26.3/§26.7 gates, §26.10 copy, AC-M3/M5/M18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftReduce, buildDefinition, definitionKey } from '../../../clashpanel/core/draft.js';
import { buildManagerViewModel, actionGate, lockedEditorVm, MANAGER_TEXT } from '../../../clashpanel/core/managerViewModel.js';
import { DISCARD_TEXT } from '../../../clashpanel/core/viewModel.js';
import { INTENT } from '../../../clashpanel/core/intents.js';

const reduce = (d, ...a) => a.reduce(draftReduce, d);
const abDraft = (id, n = 1) => reduce(createDraft({ testId: id, testNumber: n }),
  { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
const keyOf = (d) => definitionKey(buildDefinition(d, { verifiedBasis: true }).definition);
const summaryOf = (d, over = {}) => ({ runId: 'run-1', status: 'completed', resultCount: 3, coverage: 'full', integrity: 'clean',
  freshnessAtSeal: 'current', caveatCount: 0, models: [], definitionKey: keyOf(d), startedAt: 0, sealedAt: 1, ...over });
const COMPLETE = { state: 'setup-complete', text: 'Setup complete — readiness to run is checked when opened', models: [] };
const ALLOW = { enabled: true, reason: null };

function state({ records, activeTestId = records[0].testId, test = {}, run = { state: 'idle', progress: null }, ...over }) {
  const active = records.find((r) => r.testId === activeTestId);
  return {
    view: 'list', activeTestId, records,
    editorVm: { version: 1, test: { testId: activeTestId, draft: active.draft, runActive: false, heldUnsaved: false, pendingConfirm: false, lastRun: null, ...test }, run },
    pending: null, fault: null, busy: false, notice: null, live: '',
    scopeName: (k) => ({ mA: 'Architecture', mB: 'Structure' })[k] ?? `Model ${k} (not loaded)`,
    readiness: new Map(records.map((r) => [r.testId, COMPLETE])),
    modelsChanged: new Map(records.map((r) => [r.testId, false])),
    ...over,
  };
}
const X = () => ({ testId: 'X', draft: abDraft('X'), summary: null });
const Y = () => ({ testId: 'Y', draft: abDraft('Y', 2), summary: null });

test('row shape (§26.9): one deep-frozen row per record in creation order, the active row marked', () => {
  const vm = buildManagerViewModel(state({ records: [X(), Y()] }));
  assert.ok(Object.isFrozen(vm) && Object.isFrozen(vm.tests[0]) && Object.isFrozen(vm.tests[0].actions.open));
  assert.deepEqual(vm.tests.map((t) => [t.testId, t.active]), [['X', true], ['Y', false]]);
  assert.deepEqual(Object.keys(vm.tests[0]).sort(), ['actions', 'active', 'modeText', 'modelsChanged', 'modelsChangedText', 'name',
    'readiness', 'resultCount', 'resultsText', 'setA', 'setB', 'setupChangedSinceRun', 'status', 'testId']);
  assert.equal(vm.count, 2);
  assert.equal(vm.activeName, 'Clash test 1');
  assert.deepEqual(vm.tests[1].status, { kind: 'not-run', text: 'Not run' });
  assert.equal(vm.tests[0].setA, 'Architecture');
  assert.equal(vm.tests[0].setB, 'Structure');
});

test('modeText: Hard; Soft with the clearance text and the §23 basis label — never "verified"', () => {
  const soft = (basisUnit) => ({ testId: 'X', summary: null, draft: reduce(abDraft('X'), { type: 'mode', value: 'soft' },
    { type: 'clearance', value: '0.05' }, ...(basisUnit ? [{ type: 'basisUnit', value: basisUnit }] : [])) });
  const textOf = (rec) => buildManagerViewModel(state({ records: [rec] })).tests[0].modeText;
  assert.equal(textOf(X()), 'Hard');
  assert.equal(textOf(soft('')), 'Soft (clearance 0.05)');
  assert.equal(textOf(soft('mm')), 'Soft (clearance 0.05 mm, user-supplied, not verified)');
  assert.equal(textOf(soft('raw')), 'Soft (clearance 0.05, raw model units, not verified)');
  for (const u of ['', 'mm', 'raw']) assert.doesNotMatch(textOf(soft(u)), /(?<!not )verified/);
});

test('AC-M5: a summary row reads "<n> clashes reported" + "Results not held"; the active displayed run does not', () => {
  const x = { ...X(), summary: summaryOf(abDraft('X'), { resultCount: 0 }) };
  const y = { ...Y(), summary: summaryOf(abDraft('Y', 2), { runId: 'run-2' }) };
  const vm = buildManagerViewModel(state({ records: [x, y], run: { state: 'done', progress: null }, test: { lastRun: x.summary } }));
  assert.deepEqual(vm.tests[0].status, { kind: 'completed', text: 'Completed — 0 clashes reported' });
  assert.equal(vm.tests[0].resultsText, null);
  assert.equal(vm.tests[0].resultCount, 0);
  assert.equal(vm.tests[1].resultsText, MANAGER_TEXT.RESULTS_NOT_HELD);
  assert.equal(vm.tests[1].resultCount, 3);
  const cleared = buildManagerViewModel(state({ records: [x, y], test: { lastRun: x.summary } }));
  assert.equal(cleared.tests[0].resultsText, MANAGER_TEXT.RESULTS_NOT_HELD, 'after Clear results the summary stays');
  assert.doesNotMatch(JSON.stringify(vm), /no clashes/i);
});

test('the active running row reads the editor live status; "Stopping…" while stopping', () => {
  const running = buildManagerViewModel(state({ records: [X()], test: { runActive: true }, run: { state: 'running', progress: { resultsFound: 7 } } }));
  assert.deepEqual(running.tests[0].status, { kind: 'running', text: 'Running — 7 found' });
  const stopping = buildManagerViewModel(state({ records: [X()], test: { runActive: true }, run: { state: 'stopping', progress: null } }));
  assert.deepEqual(stopping.tests[0].status, { kind: 'stopping', text: 'Stopping…' });
});

test('setupChangedSinceRun compares the current definition key with the summary key (name included)', () => {
  const d = abDraft('X');
  assert.equal(buildManagerViewModel(state({ records: [{ testId: 'X', draft: d, summary: summaryOf(d) }] })).tests[0].setupChangedSinceRun, false);
  const renamed = reduce(d, { type: 'name', value: 'Renamed' });
  assert.equal(buildManagerViewModel(state({ records: [{ testId: 'X', draft: renamed, summary: summaryOf(d) }] })).tests[0].setupChangedSinceRun, true);
});

test('AC-M3 gates: during a run Create/Open-other/Delete-active/Reset-active are refused; Duplicate and non-active Delete/Reset are allowed', () => {
  const x = { ...X(), summary: summaryOf(abDraft('X')) };
  const y = { ...Y(), summary: summaryOf(abDraft('Y', 2)) };
  const s = state({ records: [x, y], test: { runActive: true }, run: { state: 'running', progress: null } });
  const vm = buildManagerViewModel(s);
  const STOP = { enabled: false, reason: MANAGER_TEXT.STOP_FIRST };
  assert.deepEqual(vm.create, STOP);
  assert.deepEqual(vm.tests[0].actions.delete, STOP);
  assert.deepEqual(vm.tests[0].actions.reset, STOP);
  assert.deepEqual(vm.tests[1].actions.open, STOP);
  assert.deepEqual(vm.tests[0].actions.open, ALLOW, 'opening the active test is a view switch');
  assert.deepEqual(vm.tests[0].actions.duplicate, ALLOW);
  assert.deepEqual(vm.tests[1].actions.delete, ALLOW);
  assert.deepEqual(vm.tests[1].actions.reset, ALLOW);
  assert.deepEqual(actionGate(s, 'open', 'Y'), STOP);
  assert.deepEqual(actionGate(s, 'open', 'nope'), { enabled: false, reason: MANAGER_TEXT.UNKNOWN });
});

test('a pending operation, the editor confirmation, a busy activation and the fault each disable every manager action with a reason', () => {
  const recs = [X(), Y()];
  const pending = { operationId: 'op-1', kind: 'delete', sourceTestId: 'Y', targetTestId: null, state: 'awaiting', discardsUnsaved: false };
  const pend = buildManagerViewModel(state({ records: recs, busy: true, pending }));
  assert.deepEqual(pend.create, { enabled: false, reason: MANAGER_TEXT.PENDING });
  assert.ok(pend.tests.every((t) => Object.values(t.actions).every((a) => a.enabled === false && a.reason === MANAGER_TEXT.PENDING)));
  assert.deepEqual(buildManagerViewModel(state({ records: recs, test: { pendingConfirm: true } })).tests[1].actions.open,
    { enabled: false, reason: MANAGER_TEXT.ANSWER_CONFIRM });
  const fault = buildManagerViewModel(state({ records: recs, fault: { text: MANAGER_TEXT.FAULT } }));
  assert.deepEqual(fault.create, { enabled: false, reason: MANAGER_TEXT.FAULT });
  assert.deepEqual(fault.fault, { text: MANAGER_TEXT.FAULT });
  assert.deepEqual(fault.editorLock, { enabled: false, reason: MANAGER_TEXT.FAULT });
  assert.equal(buildManagerViewModel(state({ records: recs })).editorLock, null);
  assert.deepEqual(buildManagerViewModel(state({ records: recs, busy: true })).create, { enabled: false, reason: MANAGER_TEXT.BUSY });
});

test('Reset is enabled only with a summary or held results', () => {
  assert.deepEqual(buildManagerViewModel(state({ records: [X(), Y()] })).tests[1].actions.reset, { enabled: false, reason: MANAGER_TEXT.NOTHING_TO_RESET });
});

test('confirm is derived from the awaiting pending operation; its buttons carry the operationId (§26.2a, §26.7)', () => {
  const recs = [X(), { ...Y(), draft: reduce(abDraft('Y', 2), { type: 'name', value: 'Ducts' }) }];
  const at = (kind, over = {}) => buildManagerViewModel(state({ records: recs, busy: true,
    pending: { operationId: 'op-7', kind, sourceTestId: 'X', targetTestId: 'Y', state: 'awaiting', discardsUnsaved: true, ...over } })).confirm;
  assert.deepEqual(at('switch'), { operationId: 'op-7', enabled: true, cancelLabel: 'Cancel', confirmLabel: 'Discard and open',
    text: 'The results of “Clash test 1” are held in memory only. Opening another test discards them — discard and open?' });
  assert.equal(at('create').text, DISCARD_TEXT.newTest, '§23.5 New-test confirmation reused unchanged');
  assert.equal(at('create').confirmLabel, 'Discard unsaved results');
  assert.equal(at('delete', { sourceTestId: 'Y', discardsUnsaved: false }).text,
    'Delete “Ducts”? Its setup and results are discarded for this session and can\'t be recovered.');
  assert.equal(at('delete').text,
    'Delete “Clash test 1”? Its setup and results are discarded for this session and can\'t be recovered. Its unsaved results are discarded too.');
  assert.equal(at('delete').confirmLabel, 'Delete test');
  assert.equal(at('reset', { targetTestId: null }).text, 'The results of “Clash test 1” are held in memory only. Resetting discards them — discard?');
  const executing = buildManagerViewModel(state({ records: recs, busy: true,
    pending: { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y', state: 'executing', discardsUnsaved: false } }));
  assert.equal(executing.confirm, null);
  assert.deepEqual(executing.pending, { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y' });
  const blocked = buildManagerViewModel(state({ records: recs, busy: true, test: { pendingConfirm: true },
    pending: { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y', state: 'awaiting', discardsUnsaved: true } }));
  assert.equal(blocked.confirm.enabled, false, 'disabled while the editor asks');
});

test('lockedEditorVm: every policy-blocked editor control reports {enabled:false, reason}; allowed ones and other regions are untouched (§26.9, Work plan re-review M1)', () => {
  const deepFrozen = (v) => { if (v !== null && typeof v === 'object') { Object.values(v).forEach(deepFrozen); Object.freeze(v); } return v; };
  const retry = { label: 'Release previous results and retry', intent: { type: INTENT.RUN_RELEASE_AND_RETRY } };
  const clear = { label: 'Clear results', intent: { type: INTENT.RESULTS_CLEAR } };
  const ed = deepFrozen({
    version: 3, test: { testId: 'X' },
    run: { state: 'done', canRun: true, canStop: false, banners: [{ id: 'a', action: retry }, { id: 'b', action: clear }, { id: 'c' }] },
    setup: { newTest: { enabled: true }, useSelectionEnabled: true },
    filters: { text: '' },
    results: { page: { index: 0 }, rows: [], nav: { canPrev: true, canNext: true, label: 'Clash 2 of 3', scoped: false } },
    selected: { resultId: 'r1', actions: { focus: { enabled: true, reason: null }, isolate: { enabled: true, checked: true, reason: null },
      markers: { enabled: true, checked: false, reason: null }, focusOnSelect: { checked: true }, backToAll: { enabled: true } } },
  });
  const before = JSON.stringify(ed);
  const policy = { [INTENT.RUN_RELEASE_AND_RETRY]: 'block', [INTENT.RESULTS_CLEAR]: 'allow' };
  const OFF = { enabled: false, reason: 'fault!' };
  const locked = lockedEditorVm(ed, 'fault!', policy);
  assert.equal(locked.run.canRun, false);
  assert.deepEqual(locked.run.locked, OFF);
  assert.deepEqual(locked.setup.newTest, OFF);
  assert.equal(locked.setup.useSelectionEnabled, false);
  assert.deepEqual(locked.setup.locked, OFF);
  assert.deepEqual(locked.run.banners[0].action, { ...retry, ...OFF }, 'Release and retry (blocked) is disabled with the reason');
  assert.equal(locked.run.banners[1], ed.run.banners[1], 'an allow-listed banner action (Clear results) is untouched');
  assert.equal(locked.run.banners[2], ed.run.banners[2]);
  assert.equal(lockedEditorVm(ed, 'fault!', {}).run.banners[1].action.enabled, false, 'an intent missing from the policy is locked (fail closed)');
  assert.deepEqual(locked.results.select, OFF, 'result-row selection');
  assert.deepEqual(locked.results.nav, { canPrev: false, canNext: false, label: 'Clash 2 of 3', scoped: false, locked: OFF });
  assert.deepEqual(locked.selected.actions.focus, OFF);
  assert.deepEqual(locked.selected.actions.isolate, { enabled: false, checked: true, reason: 'fault!' });
  assert.deepEqual(locked.selected.actions.markers, { enabled: false, checked: false, reason: 'fault!' });
  assert.deepEqual(locked.selected.actions.backToAll, OFF);
  assert.equal(locked.selected.actions.focusOnSelect, ed.selected.actions.focusOnSelect, 'Focus on select stays (allow-listed)');
  for (const k of ['filters', 'test']) assert.equal(locked[k], ed[k], `${k} carried over by reference`);
  assert.equal(locked.results.page, ed.results.page);
  assert.equal(locked.run.canStop, false, 'Stop keeps its own state');
  assert.equal(JSON.stringify(ed), before, 'the editor\'s own ViewModel is untouched (copy/overlay only)');
  assert.ok(Object.isFrozen(locked.run) && Object.isFrozen(locked.setup) && Object.isFrozen(locked.results.nav) && Object.isFrozen(locked.selected.actions.focus));
  const bare = lockedEditorVm(Object.freeze({ version: 1, run: Object.freeze({ state: 'idle', canRun: true }) }), 'x', policy);
  assert.deepEqual(Object.keys(bare).sort(), ['run', 'version'], 'absent regions stay absent');
  assert.equal('banners' in bare.run, false);
});

test('copy: no manager string claims persistence ("saved") or readiness ("ready")', () => {
  const vm = buildManagerViewModel(state({ records: [X(), Y()] }));
  const text = JSON.stringify(vm) + JSON.stringify(MANAGER_TEXT, (k, v) => (typeof v === 'function' ? v('n', 'm', 'run-active') : v));
  assert.doesNotMatch(text, /\bsaved\b/i);
  assert.doesNotMatch(text, /\bready\b/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashpanel/core/managerViewModel.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `managerViewModel.js`.

- [ ] **Step 3: Implement**

In `clashpanel/core/viewModel.js` change `function describeScope(side, modelName) {` to `export function describeScope(side, modelName) {`.

Create `clashpanel/core/managerViewModel.js`:

```js
// clashpanel/core/managerViewModel.js
// PURE builder of the Clash Tests manager ViewModel (spec §26.9) and THE action-gate rule (§26.2a, §26.3, §26.7) used
// by both this builder and the manager's intent handlers, so an enabled button and an accepted intent can never
// disagree. All strings are built here; names stay raw text for textContent (AC-P13). Copy never claims persistence
// or readiness (§26.6, §26.10) and a count is always "reported" (PD-12).
import { describeScope, DISCARD_TEXT } from './viewModel.js';
import { buildDefinition, definitionKey } from './draft.js';
import { summaryStatusText } from './testSummary.js';
import { BASIS_RAW } from './constants.js';

const REASON_TEXT = Object.freeze({
  'run-active': 'stop the running test first.',
  'unsaved-results': 'its unsaved results were not confirmed for discarding.',
  'invalid-test-id': 'the test could not be loaded.',
  'invalid-draft': 'the test could not be loaded.',
  'unknown-test': 'that test no longer exists.',
  disposed: 'the panel is closing.',
});

export const MANAGER_TEXT = Object.freeze({
  STOP_FIRST: 'Stop the running test first.',
  PENDING: 'Confirm or cancel the pending action first.',
  BUSY: 'Another test action is in progress.',
  ANSWER_CONFIRM: 'Answer the pending confirmation in the test editor first.',
  UNKNOWN: 'This test no longer exists.',
  NOTHING_TO_RESET: 'This test has no results to reset.',
  NOT_RUN: 'Not run',
  RESULTS_NOT_HELD: 'Results not held — open and re-run to view',
  MODELS_CHANGED: 'Models changed since this run',
  FAULT: 'The tests list lost track of the test editor. Results can still be cleared; close the panel to start over (tests are kept for this session only).',
  RECHECKED: 'The test changed while you were confirming — please confirm again.',
  REFUSED_CHANGED: 'The test changed while you were confirming, so nothing was done.',
  NO_ID: 'A new test id could not be created; nothing was changed.',
  confirmSwitch: (name) => `The results of “${name}” are held in memory only. Opening another test discards them — discard and open?`,
  confirmDelete: (name, unsaved) => `Delete “${name}”? Its setup and results are discarded for this session and can't be recovered.${unsaved ? ' Its unsaved results are discarded too.' : ''}`,
  confirmReset: (name) => `The results of “${name}” are held in memory only. Resetting discards them — discard?`,
  opened: (name) => `Opened “${name}”.`,
  created: (name) => `Created “${name}”.`,
  duplicated: (source, name) => `Duplicated “${source}” as “${name}”.`,
  deleted: (name) => `Deleted “${name}” for this session.`,
  reset: (name) => `Reset the results of “${name}”.`,
  restored: (name) => `The test editor was restored to “${name}”.`,
  failed: (verb, name, reason) => `Could not ${verb} “${name}”: ${REASON_TEXT[reason] ?? 'the test could not be loaded.'}`,
});

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const ALLOW = Object.freeze({ enabled: true, reason: null });
const deny = (reason) => Object.freeze({ enabled: false, reason });

/** True only for the active test while the editor displays THAT summary's run with a sealed set. */
export function resultsHeldFor(editorVm, summary) {
  return editorVm?.run?.state === 'done' && summary !== null && summary !== undefined && summary.resultCount !== null
    && editorVm?.test?.lastRun?.runId === summary.runId;
}

export function actionGate(s, action, testId = null) {
  if (s.fault !== null && s.fault !== undefined) return deny(s.fault.text);
  if (s.busy === true) return deny(s.pending?.state === 'awaiting' ? MANAGER_TEXT.PENDING : MANAGER_TEXT.BUSY);
  const t = s.editorVm?.test ?? null;
  if (t?.pendingConfirm === true) return deny(MANAGER_TEXT.ANSWER_CONFIRM);
  const runActive = t?.runActive === true;
  if (action === 'create') return runActive ? deny(MANAGER_TEXT.STOP_FIRST) : ALLOW;
  const record = s.records.find((r) => r.testId === testId);
  if (record === undefined) return deny(MANAGER_TEXT.UNKNOWN);
  const active = testId === s.activeTestId;
  switch (action) {
    case 'duplicate': return ALLOW;
    case 'open': return runActive && !active ? deny(MANAGER_TEXT.STOP_FIRST) : ALLOW;
    case 'delete': return runActive && active ? deny(MANAGER_TEXT.STOP_FIRST) : ALLOW;
    case 'reset': {
      if (runActive && active) return deny(MANAGER_TEXT.STOP_FIRST);
      const held = active && resultsHeldFor(s.editorVm, record.summary);
      return record.summary !== null || held ? ALLOW : deny(MANAGER_TEXT.NOTHING_TO_RESET);
    }
    default: return deny(MANAGER_TEXT.UNKNOWN);
  }
}

function modeTextOf(draft) {
  if (draft.mode !== 'soft') return 'Hard';
  const clearance = draft.clearance.trim() === '' ? 'not set' : draft.clearance.trim();
  if (draft.basisUnit === BASIS_RAW) return `Soft (clearance ${clearance}, raw model units, not verified)`;
  if (draft.basisUnit !== '') return `Soft (clearance ${clearance} ${draft.basisUnit}, user-supplied, not verified)`;
  return `Soft (clearance ${clearance})`;
}

// Drafts are deep-frozen and immutable, so a definition key per draft object can be memoized safely (Q1 cost).
const KEY_OF_DRAFT = new WeakMap();

function currentKey(draft) {
  if (KEY_OF_DRAFT.has(draft)) return KEY_OF_DRAFT.get(draft);
  const { definition } = buildDefinition(draft, { verifiedBasis: true });
  const key = definition === null ? null : definitionKey(definition);
  KEY_OF_DRAFT.set(draft, key);
  return key;
}

function statusOf(s, record, active) {
  const t = s.editorVm?.test ?? null;
  if (active && t?.runActive === true) {
    return s.editorVm?.run?.state === 'stopping'
      ? { kind: 'stopping', text: 'Stopping…' }
      : { kind: 'running', text: `Running — ${s.editorVm?.run?.progress?.resultsFound ?? 0} found` };
  }
  if (record.summary === null) return { kind: 'not-run', text: MANAGER_TEXT.NOT_RUN };
  return { kind: record.summary.status, text: summaryStatusText(record.summary) };
}

function buildRow(s, record) {
  const active = record.testId === s.activeTestId;
  const summary = record.summary;
  const held = active && resultsHeldFor(s.editorVm, summary);
  const modelsChanged = s.modelsChanged.get(record.testId) === true;
  return {
    testId: record.testId,
    name: record.draft.name,
    active,
    modeText: modeTextOf(record.draft),
    setA: describeScope(record.draft.setA, s.scopeName),
    setB: record.draft.selfClash ? 'Same as Set A' : describeScope(record.draft.setB, s.scopeName),
    status: statusOf(s, record, active),
    resultCount: summary?.resultCount ?? null,
    resultsText: summary !== null && summary.resultCount !== null && !held ? MANAGER_TEXT.RESULTS_NOT_HELD : null,
    setupChangedSinceRun: summary !== null && currentKey(record.draft) !== summary.definitionKey,
    readiness: s.readiness.get(record.testId) ?? null,
    modelsChanged,
    modelsChangedText: modelsChanged ? MANAGER_TEXT.MODELS_CHANGED : null,
    actions: {
      open: actionGate(s, 'open', record.testId),
      duplicate: actionGate(s, 'duplicate', record.testId),
      reset: actionGate(s, 'reset', record.testId),
      delete: actionGate(s, 'delete', record.testId),
    },
  };
}

function confirmOf(s, nameOf) {
  const p = s.pending;
  if (p === null || p === undefined || p.state !== 'awaiting') return null;
  const base = { operationId: p.operationId, cancelLabel: 'Cancel', enabled: s.fault === null && s.editorVm?.test?.pendingConfirm !== true };
  switch (p.kind) {
    case 'switch': return { ...base, text: MANAGER_TEXT.confirmSwitch(nameOf(p.sourceTestId)), confirmLabel: 'Discard and open' };
    case 'create': return { ...base, text: DISCARD_TEXT.newTest, confirmLabel: 'Discard unsaved results' };
    case 'delete': return { ...base, text: MANAGER_TEXT.confirmDelete(nameOf(p.sourceTestId), p.discardsUnsaved === true), confirmLabel: 'Delete test' };
    case 'reset': return { ...base, text: MANAGER_TEXT.confirmReset(nameOf(p.sourceTestId)), confirmLabel: 'Discard and reset' };
    default: return null;
  }
}

export function buildManagerViewModel(s) {
  const nameOf = (testId) => s.records.find((r) => r.testId === testId)?.draft.name ?? '';
  const p = s.pending;
  return deepFreeze({
    view: s.view,
    activeTestId: s.activeTestId,
    activeName: nameOf(s.activeTestId),
    count: s.records.length,
    create: actionGate(s, 'create'),
    pending: p === null || p === undefined ? null : { operationId: p.operationId, kind: p.kind, sourceTestId: p.sourceTestId, targetTestId: p.targetTestId ?? null },
    confirm: confirmOf(s, nameOf),
    notice: s.notice ?? null,
    fault: s.fault === null || s.fault === undefined ? null : { text: s.fault.text },
    // §26.9: while faulted every policy-blocked editor control is disabled with the fault text (core-derived; Task 9
    // overlays the editor ViewModel with lockedEditorVm; the Task 11 renderer reads this lock to describe them).
    editorLock: s.fault === null || s.fault === undefined ? null : { enabled: false, reason: s.fault.text },
    live: s.live ?? '',
    tests: s.records.map((record) => buildRow(s, record)),
  });
}

/**
 * §26.9/§26.10 headless fault contract (Codex plan review I1; Work plan re-review M1): while the manager is faulted
 * the composite `editor` ViewModel reports EVERY user-facing control whose intent `policy` (Task 9's FAULT_POLICY)
 * blocks as `{enabled:false, reason}` — the editor's existing disabled-reason shape — so a headless consumer and the
 * DOM never show enabled a control whose intent dispatch drops. Setup edits/New test, Run, result-row selection,
 * Prev/Next, Focus/Isolate/Markers/Back to All are fixed controls locked unconditionally (= FAULT_POLICY's blocked
 * user-facing intents, pinned by the FAULT_CONTROLS equivalence tests, Tasks 9/11); only banner actions, which carry
 * their intent as data, consult `policy` and are locked unless it allows the intent (fail closed, like dispatch). Allow-listed controls (filters, group, sort, page,
 * Focus on select, Stop, Clear + confirmation, Copy diagnostics, collapse) are carried over unchanged. Returns a NEW
 * deep-frozen object; the input (the editor's own, deep-frozen ViewModel) is never written.
 */
export function lockedEditorVm(editorVm, reason, policy) {
  const gate = { enabled: false, reason };
  const blocked = (intent) => policy?.[intent?.type] !== 'allow';
  const run = editorVm.run;
  const out = {
    ...editorVm,
    run: {
      ...run, canRun: false, locked: gate,
      ...(Array.isArray(run.banners)
        ? { banners: run.banners.map((b) => (b?.action && blocked(b.action.intent) ? { ...b, action: { ...b.action, ...gate } } : b)) }
        : {}),
    },
  };
  if (editorVm.setup) out.setup = { ...editorVm.setup, newTest: gate, useSelectionEnabled: false, locked: gate };
  if (editorVm.results) {
    out.results = { ...editorVm.results, select: gate, nav: { ...editorVm.results.nav, canPrev: false, canNext: false, locked: gate } };
  }
  if (editorVm.selected) {
    const a = editorVm.selected.actions;
    out.selected = { ...editorVm.selected, actions: { ...a, focus: { ...a.focus, ...gate }, isolate: { ...a.isolate, ...gate },
      markers: { ...a.markers, ...gate }, backToAll: { ...a.backToAll, ...gate } } };
  }
  return deepFreeze(out);
}
```

Add `'core/managerViewModel.js',` to the scaffold list after `'core/testReadiness.js',`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/clashpanel/core/managerViewModel.test.mjs test/clashpanel/core/viewModel.test.mjs test/clashpanel/scaffold.test.mjs test/clashpanel/layering.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 5: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/managerViewModel.js clashpanel/core/viewModel.js test/clashpanel/core/managerViewModel.test.mjs test/clashpanel/scaffold.test.mjs
git commit -m "feat(clashpanel): Clash Tests manager ViewModel and action gates (spec §26.9)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Tests manager core — records, sync, views, Open/Create/Duplicate, routing, dispose

**Files:**
- Create: `clashpanel/core/testsManager.js`
- Modify: `clashpanel/core/index.js` (add `export { createTestsManager } from './testsManager.js';`)
- Modify: `test/clashpanel/core/index.test.mjs:10` (barrel list gains `'createTestsManager'` — Global Constraint 13 / G-A1)
- Modify: `test/clashpanel/scaffold.test.mjs` (add `'core/testsManager.js'` after `'core/managerViewModel.js'`)
- Create: `test/clashpanel/support/fakeEditor.mjs`
- Test: `test/clashpanel/core/testsManager.core.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–6 exports; `narrowEnginePort`, `assertCatalogPort` (`ports.js`); `disambiguatedNames`, `fallbackModelName` (`labels.js`); `createDraft` (`draft.js`).
- Produces:
  - `createTestsManager({editor, engine, catalog, bridge, scheduler, mintId?}) → Object.freeze({getViewModel, subscribe, dispatch, dispose})`. `getViewModel()` → frozen `{manager: ManagerVM, editor: EditorVM}`, identity-stable between changes. `dispatch(intent)`: `MANAGER_INTENT.*` → manager (resolves after the operation settles); `INTENT.SETUP_NEW_TEST` → Create (§26.8); `INTENT.TEST_LOAD` and `INTENT.TEST_LABEL_SCOPE` → dropped (manager-only seams); everything else → `editor.dispatch(intent)` unchanged. `dispose()` is synchronous and touches only the manager's own state/listeners.
  - **Model-left identity (Work plan review H1).** `bridge.onModelLeft((event) => onModelLeft(m, event))` resolves `event.model` through the existing `catalog.keyOfModel` contract (as the editor does, `controller.js:1080-1096`), keeps **only the key** — never the `Model` — in `m.departed: Set<modelKey>` when the catalog still lists that key, and recomputes. A departed key is treated as absent **at once** by readiness, "models changed" and "(not loaded)" (its binding reads as `null`, its catalog entry is filtered out). It is reconciled **only** by `onCatalogChange`, when an authoritative catalog notification no longer lists the key (removal observed); afterwards a same-key catalog entry is ordinary re-entry. A catalog notification that still lists the key reconciles nothing; an event whose model has no key attributes nothing and only recomputes.
  - **Label scope (seam (e), G-A2).** `labelScopeOf(m)` = every key any record references (sides' `modelKeys` and `elements` keys, `summary.models`), sorted. The row names use `catalog.list()` keys ∪ that scope; `pushLabelScope(m)` dispatches `{type: INTENT.TEST_LABEL_SCOPE, modelKeys: labelScopeOf(m)}` to the editor whenever the scope changes (checked once per `recordsVersion`, at the end of `changed()` and at construction), so the editor's resolver uses the identical key set.
  - Internal (used by Tasks 8–9; names fixed): `m` state `{records: Map, seq, counter, activeTestId, view, pending, activation, recovery, fault, notice, live, opSeq, recoverySeq, editorVm, departed, labelScopeSig, labelScopeVersion, …}`; functions `changed`, `invalidate`, `onModelLeft`, `onCatalogChange`, `listedKeys`, `labelScopeOf`, `pushLabelScope`, `gateState`, `onEditorNotification`, `syncFrom`, `reduceSummary`, `snapshotOutgoing`, `loadInto`, `activate`, `request`, `execute`, `RUN`, `HANDLERS`, `nameOf`.
  - `test/clashpanel/support/fakeEditor.mjs`: `createFakeEditor({testId})` (records `TEST_LABEL_SCOPE` payloads in `editor.labelScopes`, **not** in `editor.dispatched`, so existing dispatch-count assertions are unaffected), `defaultLoad(intent, editor)`, `lastRunOf(runId, resultCount, over)`, `makeManagerHarness({editor})` → `{scheduler, catalog, engine, bridge, editor, manager, modelA, modelB, ports, vm(), row(testId), dispatch(intent), settle()}`.

- [ ] **Step 1: Write the support double**

```js
// test/clashpanel/support/fakeEditor.mjs
// Scriptable double of the editor surface the Clash Tests manager consumes (spec §26.11): getViewModel / subscribe /
// dispatch, with INTENT.TEST_LOAD answered by a per-call script (default: the real controller's contract). Notifications
// are SYNCHRONOUS, like the controller's touch(). The ViewModel carries only what the manager reads: {version, test, run}.
import { INTENT } from '../../../clashpanel/core/intents.js';
import { createDraft } from '../../../clashpanel/core/draft.js';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { createFakeScheduler } from './fakeScheduler.mjs';
import { createFakeCatalog } from './fakeCatalog.mjs';
import { createScriptedEngine, createRecordingBridge, makeFakeModel } from './controllerHarness.mjs';
import { settle } from './settle.mjs';

/** The real controller's TEST_LOAD contract (controller.js onTestLoad), for scripts that want the normal path. */
export function defaultLoad(intent, editor) {
  const t = editor.test;
  const refuse = (reason) => ({ ok: false, testId: t.testId, version: editor.getViewModel().version, releaseStuck: false, reason });
  if (t.runActive) return refuse('run-active');
  if (t.heldUnsaved && intent.acknowledgeUnsaved !== true) return refuse('unsaved-results');
  editor.set({ testId: intent.testId, draft: intent.draft, lastRun: null, heldUnsaved: false, pendingConfirm: false }, { runPatch: { state: 'idle', progress: null } });
  return { ok: true, testId: intent.testId, version: editor.getViewModel().version, releaseStuck: false };
}

export const lastRunOf = (runId, resultCount, over = {}) => Object.freeze({
  runId, status: 'completed', resultCount, coverage: 'full', integrity: 'clean', freshnessAtSeal: 'current', caveatCount: 0,
  models: Object.freeze([]), definitionKey: null, startedAt: 0, sealedAt: 1, ...over,
});

export function createFakeEditor({ testId = 'test-1' } = {}) {
  const subscribers = new Set();
  const dispatched = [];
  const labelScopes = [];                        // seam (e) payloads, kept apart from `dispatched`
  const loadScript = [];
  let version = 0;
  let test = { testId, draft: createDraft({ testId, testNumber: 1 }), runActive: false, heldUnsaved: false, pendingConfirm: false, lastRun: null };
  let run = { state: 'idle', progress: null };
  const build = () => Object.freeze({ version, test: Object.freeze({ ...test }), run: Object.freeze({ ...run }) });
  let vm = build();
  const editor = {
    dispatched,
    labelScopes,
    get test() { return vm.test; },
    subscriberCount: () => subscribers.size,
    /** Change the snapshot; `notify:false` models a change the manager has not observed yet. */
    set(patch = {}, { runPatch = null, notify = true } = {}) {
      test = { ...test, ...patch };
      if (runPatch) run = { ...run, ...runPatch };
      version += 1;
      vm = build();
      if (notify) for (const cb of [...subscribers]) cb(vm);
    },
    /** Queue the behaviour of the NEXT TEST_LOAD: (intent, editor) => LoadResult | Promise<LoadResult>. */
    scriptLoad(fn) { loadScript.push(fn); },
    getViewModel: () => vm,
    subscribe(cb) { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
    dispatch(intent) {
      if (intent.type === INTENT.TEST_LABEL_SCOPE) { labelScopes.push([...intent.modelKeys]); return Promise.resolve(undefined); }
      dispatched.push(intent);
      switch (intent.type) {
        case INTENT.TEST_LOAD: return Promise.resolve((loadScript.shift() ?? defaultLoad)(intent, editor));
        case INTENT.CONFIRM_CANCEL: if (test.pendingConfirm) editor.set({ pendingConfirm: false }); return Promise.resolve(undefined);
        case INTENT.RESULTS_CLEAR:
          if (test.heldUnsaved) editor.set({ pendingConfirm: true }); else editor.set({}, { runPatch: { state: 'idle' } });
          return Promise.resolve(undefined);
        case INTENT.RESULTS_CLEAR_CONFIRMED:
          editor.set({ pendingConfirm: false, heldUnsaved: false }, { runPatch: { state: 'idle' } });
          return Promise.resolve(undefined);
        default: return Promise.resolve(undefined);
      }
    },
  };
  return editor;
}

export function makeManagerHarness({ editor = createFakeEditor(), mintId = null } = {}) {
  const scheduler = createFakeScheduler();
  const modelA = makeFakeModel('A');
  const modelB = makeFakeModel('B');
  const catalog = createFakeCatalog({ models: [
    { modelKey: 'mA', displayName: 'Architecture', model: modelA, loaded: true },
    { modelKey: 'mB', displayName: 'Structure', model: modelB, loaded: true },
  ] });
  const engine = createScriptedEngine({ bindings: {
    mA: { modelKey: 'mA', model: modelA, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
    mB: { modelKey: 'mB', model: modelB, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
  } });
  const bridge = createRecordingBridge();
  let ids = 0;
  const ports = { editor, engine, catalog, bridge, scheduler, mintId: mintId ?? (() => { ids += 1; return `new-${ids}`; }) };
  const manager = createTestsManager(ports);
  return {
    scheduler, catalog, engine, bridge, editor, manager, modelA, modelB, ports,
    vm: () => manager.getViewModel().manager,
    row: (testId) => manager.getViewModel().manager.tests.find((t) => t.testId === testId),
    dispatch: (intent) => manager.dispatch(intent),
    settle: (rounds) => settle(scheduler, rounds),
  };
}
```

- [ ] **Step 2: Write the failing tests**

```js
// test/clashpanel/core/testsManager.core.test.mjs — spec §26.2/§26.2a/§26.4/§26.8 with a scriptable editor (§26.11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { draftReduce } from '../../../clashpanel/core/draft.js';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { makeManagerHarness, lastRunOf } from '../support/fakeEditor.mjs';

const loads = (h) => h.editor.dispatched.filter((i) => i.type === INTENT.TEST_LOAD);
const MODELS_AB = Object.freeze([{ modelKey: 'mA', bindingGeneration: 1, modelVersion: 'v1' }, { modelKey: 'mB', bindingGeneration: 1, modelVersion: 'v1' }]);
/** The active record references mA (Set A) and mB (Set B) and has a sealed summary over both. */
function referencingAB(h) {
  const draft = [{ type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' }].reduce(draftReduce, h.editor.test.draft);
  h.editor.set({ draft, lastRun: lastRunOf('run-1', 2, { models: MODELS_AB }) });
  assert.equal(h.row('test-1').readiness.state, 'setup-complete');
  assert.equal(h.row('test-1').modelsChanged, false);
}

test('construction asserts the editor surface, the ports and the editor test snapshot', () => {
  const h = makeManagerHarness();
  assert.throws(() => createTestsManager({ ...h.ports, editor: {} }), /editor\.getViewModel is required/);
  assert.throws(() => createTestsManager({ ...h.ports, bridge: {} }), /bridge\.onModelLeft is required/);
  assert.throws(() => createTestsManager({ ...h.ports, editor: { ...h.editor, getViewModel: () => ({ version: 0 }) } }), /no valid `test` snapshot/);
});

test('the initial record is the editor test ("Clash test 1"), active, in the editor view', () => {
  const h = makeManagerHarness();
  const vm = h.vm();
  assert.equal(vm.view, 'editor');
  assert.equal(vm.activeTestId, 'test-1');
  assert.deepEqual(vm.tests.map((t) => [t.testId, t.name, t.active]), [['test-1', 'Clash test 1', true]]);
  assert.equal(h.manager.getViewModel().editor, h.editor.getViewModel());
  assert.equal(h.manager.getViewModel(), h.manager.getViewModel(), 'identity-stable between changes');
});

test('draft sync by identity and summary reduction once per runId; Clear results keeps the summary (§26.2a)', () => {
  const h = makeManagerHarness();
  h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value: 'Walls' }) });
  assert.equal(h.row('test-1').name, 'Walls');
  h.editor.set({ lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported');
  assert.equal(h.row('test-1').resultsText, null);
  h.editor.set({}, { runPatch: { state: 'idle' } });
  assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported');
  assert.equal(h.row('test-1').resultsText, 'Results not held — open and re-run to view');
});

test('AC-M1: Create mints a testId and the next "Clash test <N>", loads it and commits on the exact testId', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  const [load] = loads(h);
  assert.equal(load.testId, 'new-1');
  assert.equal(load.draft.testId, 'new-1');
  assert.equal(load.draft.name, 'Clash test 2');
  assert.equal(load.acknowledgeUnsaved, false);
  const vm = h.vm();
  assert.equal(vm.activeTestId, 'new-1');
  assert.equal(vm.view, 'editor');
  assert.equal(vm.count, 2);
  assert.equal(vm.live, 'Created “Clash test 2”.');
  assert.equal(h.row('test-1').active, false);
});

test('Create is refused while a run is active: no load is dispatched', async () => {
  const h = makeManagerHarness();
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: { resultsFound: 0 } } });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 0);
  assert.deepEqual(h.vm().create, { enabled: false, reason: 'Stop the running test first.' });
});

test('Open loads the record\'s exact draft and testId; opening the active test only switches the view (§26.8)', async () => {
  const h = makeManagerHarness();
  const initial = h.editor.test.draft;
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });
  const before = h.editor.dispatched.length;
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  assert.equal(h.editor.dispatched.length, before, 'nothing reaches the editor');
  assert.equal(h.vm().view, 'editor');
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'test-1' });
  const load = loads(h).at(-1);
  assert.equal(load.testId, 'test-1');
  assert.equal(load.draft, initial, 'the snapshotted frozen draft itself');
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.vm().live, 'Opened “Clash test 1”.');
});

test('AC-M16: a refused Create leaves activeTestId unchanged, removes the new record and shows a notice', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 1, releaseStuck: false, reason: 'run-active' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().notice, 'Could not create “Clash test 2”: stop the running test first.');
});

test('AC-M7: Duplicate adds "<name> copy"/"copy 2" with new testIds, keeps the active test, and is allowed while running', async () => {
  const h = makeManagerHarness();
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  const vm = h.vm();
  assert.deepEqual(vm.tests.map((t) => [t.testId, t.name]), [['test-1', 'Clash test 1'], ['new-1', 'Clash test 1 copy'], ['new-2', 'Clash test 1 copy 2']]);
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(loads(h).length, 0);
  assert.deepEqual(h.row('new-1').status, { kind: 'not-run', text: 'Not run' });
  assert.equal(vm.live, 'Duplicated “Clash test 1” as “Clash test 1 copy 2”.');
});

test('duplicating the active test reads its CURRENT draft even before the notification was observed', async () => {
  const h = makeManagerHarness();
  h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value: 'Unseen edit' }) }, { notify: false });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  assert.equal(h.row('new-1').name, 'Unseen edit copy');
});

test('§26.8 routing: SETUP_NEW_TEST performs Create; a UI TEST_LOAD is dropped; other intents reach the editor unchanged', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().count, 2);
  assert.equal(h.editor.dispatched.some((i) => i.type === INTENT.SETUP_NEW_TEST), false);
  const n = h.editor.dispatched.length;
  await h.dispatch({ type: INTENT.TEST_LOAD, testId: 'test-1', draft: h.editor.test.draft });
  assert.equal(h.editor.dispatched.length, n);
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'x' });
  assert.deepEqual(h.editor.dispatched.at(-1), { type: INTENT.SETUP_NAME, value: 'x' });
  assert.throws(() => h.manager.dispatch(null), { name: 'TypeError' });
});

test('§26.3: with unsaved held results Open creates an awaiting pending operation and dispatches nothing', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  h.editor.set({ heldUnsaved: true, lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  assert.equal(loads(h).length, 0);
  const vm = h.vm();
  assert.deepEqual(vm.pending, { operationId: 'op-1', kind: 'switch', sourceTestId: 'test-1', targetTestId: 'new-1' });
  assert.match(vm.confirm.text, /Opening another test discards them/);
  assert.equal(vm.tests[1].actions.duplicate.enabled, false);
});

test('a colliding, empty or throwing minted id is refused before any record mutation (Codex plan review I3)', async () => {
  for (const bad of [() => 'test-1', () => '', () => { throw new Error('no entropy'); }]) {
    const h = makeManagerHarness({ mintId: bad });
    await h.dispatch({ type: MANAGER_INTENT.CREATE });
    await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
    const vm = h.vm();
    assert.equal(vm.count, 1);
    assert.equal(vm.tests[0].name, 'Clash test 1', 'the existing record is never overwritten');
    assert.equal(loads(h).length, 0);
    assert.equal(vm.notice, 'A new test id could not be created; nothing was changed.');
  }
});

test('run-progress notifications that change no record do not recompute names/readiness (Codex plan review Q1)', () => {
  const h = makeManagerHarness();
  h.manager.getViewModel();
  const listCalls = h.catalog.calls.list;
  for (let i = 1; i <= 50; i += 1) {
    h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: { resultsFound: i } } });
    h.manager.getViewModel();
  }
  assert.equal(h.catalog.calls.list, listCalls, 'derived rows reused');
  assert.equal(h.row('test-1').status.text, 'Running — 50 found', 'the live status still follows the editor');
  h.catalog.fire();
  h.manager.getViewModel();
  assert.ok(h.catalog.calls.list > listCalls, 'a §26.6 trigger recomputes');
});

test('catalog changes and model-left events rebuild the ViewModel without any engine run call', () => {
  const h = makeManagerHarness();
  const v1 = h.manager.getViewModel();
  h.catalog.fire();
  const v2 = h.manager.getViewModel();
  assert.notEqual(v2, v1);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  assert.notEqual(h.manager.getViewModel(), v2);
  assert.equal(h.engine.startCalls.length, 0);
});

test('H1 / AC-M10: a model-left event ALONE — catalog and binding snapshot unchanged — marks referencing rows missing and changed at once', () => {
  const h = makeManagerHarness();
  referencingAB(h);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  assert.deepEqual(h.catalog.list().map((e) => e.modelKey), ['mA', 'mB'], 'the catalog still lists mB (BEFORE_MODEL_UNLOAD precedes any catalog change)');
  assert.notEqual(h.engine.registry.bindingFor('mB'), null, 'and its binding is still readable');
  const row = h.row('test-1');
  assert.equal(row.readiness.state, 'models-missing');
  assert.equal(row.readiness.text, 'Structure is not loaded');
  assert.equal(row.modelsChanged, true);
  assert.equal(row.modelsChangedText, 'Models changed since this run');
  assert.equal(row.setB, 'Structure (not loaded)');
  h.catalog.fire();                                                // a catalog notification that STILL lists mB reconciles nothing
  assert.equal(h.row('test-1').readiness.state, 'models-missing');
  assert.equal(h.row('test-1').modelsChanged, true);
  h.bridge.fireModelLeft({ model: { unknown: true }, reason: 'removed' });   // a model without a key attributes nothing
  assert.equal(h.row('test-1').readiness.text, 'Structure is not loaded');
  assert.equal(h.engine.startCalls.length, 0);
});

test('H1: removal — the catalog drops the model after (or without) the event; the row stays missing and changed', () => {
  const h = makeManagerHarness();
  referencingAB(h);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  h.catalog.removeModel('mB');
  h.catalog.fire();
  assert.equal(h.row('test-1').readiness.state, 'models-missing');
  assert.equal(h.row('test-1').modelsChanged, true);
  const g = makeManagerHarness();                                   // removal with no model-left event at all
  referencingAB(g);
  g.catalog.removeModel('mB');
  g.catalog.fire();
  assert.equal(g.row('test-1').readiness.state, 'models-missing');
  assert.equal(g.row('test-1').modelsChanged, true);
});

test('H1: same-key re-entry after an observed removal recomputes to setup-complete, in either event/catalog order', () => {
  for (const eventFirst of [true, false]) {
    const h = makeManagerHarness();
    referencingAB(h);
    if (eventFirst) h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
    h.catalog.removeModel('mB');
    h.catalog.fire();
    if (!eventFirst) h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });   // the catalog already dropped it: nothing to mark
    assert.equal(h.row('test-1').readiness.state, 'models-missing');
    h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: h.modelB, loaded: true });   // showModel: same key + Model
    h.catalog.fire();
    assert.equal(h.row('test-1').readiness.state, 'setup-complete', `eventFirst=${eventFirst}`);
    assert.equal(h.row('test-1').modelsChanged, false);
    assert.equal(h.row('test-1').setB, 'Structure');
  }
});

test('seam (e): the manager pushes its complete referenced-key scope to the editor once per change; a UI copy is dropped (G-A2)', async () => {
  const h = makeManagerHarness();
  assert.deepEqual(h.editor.labelScopes, [], 'the editor starts with the empty scope; nothing to push');
  referencingAB(h);
  assert.deepEqual(h.editor.labelScopes.at(-1), ['mA', 'mB']);
  const n = h.editor.labelScopes.length;
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: { resultsFound: 1 } } });
  assert.equal(h.editor.labelScopes.length, n, 'no push while the scope is unchanged');
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  assert.equal(h.editor.labelScopes.length, n, 'the duplicate references the same keys');
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: ['forged'] });
  assert.equal(h.editor.labelScopes.length, n, 'a UI-sent TEST_LABEL_SCOPE never reaches the editor');
});

test('AC-M12: dispose drops every record and removes the editor, catalog and model-left listeners', async () => {
  const h = makeManagerHarness();
  const cat = h.catalog.listenerCount();
  const left = h.bridge.listenerCount();
  assert.equal(h.editor.subscriberCount(), 1);
  h.manager.dispose();
  assert.equal(h.editor.subscriberCount(), 0);
  assert.equal(h.catalog.listenerCount(), cat - 1);
  assert.equal(h.bridge.listenerCount(), left - 1);
  assert.equal(h.vm().count, 0);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().count, 0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/clashpanel/core/testsManager.core.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashpanel/core/testsManager.js` (imported by `fakeEditor.mjs`).

- [ ] **Step 4: Implement `testsManager.js`**

```js
// clashpanel/core/testsManager.js
// Spec §26: the session-scoped Clash Tests manager (headless; same layering as the controller, AC-P10). It owns the
// test RECORDS, the active-test id, the session counter and its own view state, and drives exactly ONE editor — the
// existing Panel controller — through its public surface and the four additive seams: TEST_LOAD, vm.test,
// CONFIRM_CANCEL (§26.2 (a)–(c)) and TEST_LABEL_SCOPE (seam (e), owner decision G-A2). It never calls the engine's
// run/residency/derivation methods (it reads only registry.bindingFor), never calls the ViewerBridge's present/clear
// (it only subscribes to onModelLeft), holds no Model (a model-left event's Model is reduced to its catalog key at
// once), persists nothing.
import { INTENT, MANAGER_INTENT } from './intents.js';
import { narrowEnginePort, assertCatalogPort } from './ports.js';
import { createDraft } from './draft.js';
import { duplicateDraft, duplicateName } from './testDrafts.js';
import { readinessOf, modelsChangedOf } from './testReadiness.js';
import { disambiguatedNames, fallbackModelName } from './labels.js';
import { buildManagerViewModel, actionGate, MANAGER_TEXT } from './managerViewModel.js';

const MANAGER_TYPES = new Set(Object.values(MANAGER_INTENT));

export function createTestsManager({ editor, engine, catalog, bridge, scheduler, mintId = () => globalThis.crypto.randomUUID() } = {}) {
  for (const name of ['getViewModel', 'subscribe', 'dispatch']) {
    if (typeof editor?.[name] !== 'function') throw new TypeError(`createTestsManager: editor.${name} is required`);
  }
  const port = narrowEnginePort(engine);
  assertCatalogPort(catalog);
  if (typeof bridge?.onModelLeft !== 'function') throw new TypeError('createTestsManager: bridge.onModelLeft is required');
  if (typeof scheduler?.now !== 'function') throw new TypeError('createTestsManager: scheduler.now is required');
  const first = editor.getViewModel();
  if (typeof first?.test?.testId !== 'string' || first.test.draft?.testId !== first.test.testId) {
    throw new TypeError('createTestsManager: the editor ViewModel has no valid `test` snapshot (spec §26.2 (b))');
  }
  const m = {
    editor, catalog, scheduler, mintId,
    bindingFor: (modelKey) => port.registry.bindingFor(modelKey),
    records: new Map(), seq: 0, counter: first.test.draft.testCounter,
    activeTestId: first.test.testId, view: 'editor',
    pending: null, activation: null, recovery: null, fault: null, notice: null, live: '',
    opSeq: 0, recoverySeq: 0,
    catalogEpoch: 0, recordsVersion: 0, derived: null,              // derived-row cache (Codex plan review Q1; CTM-8)
    departed: new Set(),                                            // H1: modelKeys (strings only) left but still listed
    labelScopeSig: '', labelScopeVersion: -1,                       // seam (e): last scope pushed ('' = the editor's initial [])
    editorVm: first, version: 0, vmCache: null, subscribers: new Set(), disposers: [], disposed: false,
  };
  addRecord(m, first.test.draft);                                   // the initial "Clash test 1" minted by the editor (§6.1)
  reduceSummary(m.records.get(m.activeTestId), first.test.lastRun);
  m.disposers.push(editor.subscribe((vm) => onEditorNotification(m, vm)));
  m.disposers.push(catalog.onChange(() => onCatalogChange(m)));
  m.disposers.push(bridge.onModelLeft((event) => onModelLeft(m, event)));
  pushLabelScope(m);
  return Object.freeze({
    getViewModel: () => viewModelOf(m),
    subscribe(cb) {
      if (typeof cb !== 'function') throw new TypeError('subscribe: callback must be a function');
      if (m.disposed) return () => {};
      m.subscribers.add(cb);
      return () => { m.subscribers.delete(cb); };
    },
    dispatch: (intent) => dispatch(m, intent),
    dispose: () => dispose(m),
  });
}

// ── state container ─────────────────────────────────────────────────────────────────────────────────────────────

/** Any change of record membership, a record's draft or its summary invalidates the derived-row cache. */
const recordsChanged = (m) => { m.recordsVersion += 1; };

function addRecord(m, draft) {
  m.seq += 1;
  const record = { testId: draft.testId, draft, summary: null, lastReducedRunId: null, createdAt: m.scheduler.now(), seq: m.seq };
  m.records.set(record.testId, record);
  recordsChanged(m);
  return record;
}

function removeRecord(m, testId) {
  if (m.records.delete(testId)) recordsChanged(m);
}

/** Codex plan review I3: an injected id must be a non-empty string no record uses; otherwise the action is refused. */
function mintFresh(m) {
  let id = null;
  try { id = m.mintId(); } catch { id = null; }
  return typeof id === 'string' && id.length > 0 && !m.records.has(id) ? id : null;
}

function refuseNoId(m) {
  m.notice = MANAGER_TEXT.NO_ID;
  changed(m);
  return undefined;
}

const nameOf = (m, testId) => m.records.get(testId)?.draft.name ?? '';
const isBusy = (m) => m.pending !== null || m.activation !== null || m.recovery !== null;

function changed(m) {
  m.version += 1;
  m.vmCache = null;
  if (m.subscribers.size > 0) {
    const vm = viewModelOf(m);
    for (const cb of [...m.subscribers]) {
      try { cb(vm); } catch { /* a subscriber failure never breaks the manager */ }
    }
  }
  pushLabelScope(m);                                                // last: the editor's notification re-enters changed()
}

/** §26.6 triggers: catalog.onChange and bridge.onModelLeft — the only events that refresh readiness / models changed / names. */
function invalidate(m) {
  if (m.disposed) return;
  m.catalogEpoch += 1;
  changed(m);
}

/** The modelKeys the catalog lists right now (strings only; a throwing catalog lists nothing). */
function listedKeys(m) {
  let entries = [];
  try { entries = m.catalog.list() ?? []; } catch { entries = []; }
  return new Set((Array.isArray(entries) ? entries : []).map((e) => e?.modelKey).filter((k) => typeof k === 'string'));
}

/**
 * §26.6 / AC-M10, Work plan review H1: the model-left event is itself a recomputation trigger. Its Model is resolved
 * through the existing catalog identity read (the editor's contract, controller.js onModelLeft) and dropped at once;
 * only the KEY is kept. A key the catalog still lists (BEFORE_MODEL_UNLOAD precedes the catalog change) is "departed":
 * absent for readiness / models changed / "(not loaded)" until the catalog confirms the removal. A model without a key
 * attributes nothing (no row can be named) and only recomputes.
 */
function onModelLeft(m, event) {
  if (m.disposed) return;
  let key = null;
  try { key = m.catalog.keyOfModel(event?.model); } catch { key = null; }
  if (typeof key === 'string' && key.length > 0 && listedKeys(m).has(key)) m.departed.add(key);
  invalidate(m);
}

/**
 * The ONLY reconciliation of a departed key: an authoritative catalog notification that no longer lists it (removal
 * observed). From then on a same-key entry is ordinary re-entry. A notification that still lists it reconciles nothing.
 */
function onCatalogChange(m) {
  if (m.disposed) return;
  if (m.departed.size > 0) {
    const listed = listedKeys(m);
    for (const key of [...m.departed]) if (!listed.has(key)) m.departed.delete(key);
  }
  invalidate(m);
}

/** CTM-2 / seam (e): every modelKey any record references — Set A/B model keys and element keys, summary models. Sorted. */
function labelScopeOf(m) {
  const keys = new Set();
  for (const r of m.records.values()) {
    for (const side of [r.draft.setA, r.draft.setB]) {
      for (const k of side.modelKeys) keys.add(k);
      for (const k of Object.keys(side.elements)) keys.add(k);
    }
    for (const row of r.summary?.models ?? []) if (typeof row?.modelKey === 'string') keys.add(row.modelKey);
  }
  return [...keys].sort();
}

/**
 * Seam (e), owner decision G-A2 (Work plan review H2): hand the editor's label resolver the SAME referenced-key scope the
 * rows use, so a modelKey has one label in the list and the editor. Checked once per recordsVersion; dispatched only when
 * the scope changed. The editor's synchronous notification re-enters changed(), which finds the version already handled.
 */
function pushLabelScope(m) {
  if (m.disposed || m.labelScopeVersion === m.recordsVersion) return;
  m.labelScopeVersion = m.recordsVersion;
  const modelKeys = labelScopeOf(m);
  const sig = modelKeys.join('\u0000');
  if (sig === m.labelScopeSig) return;
  m.labelScopeSig = sig;
  try {
    void Promise.resolve(m.editor.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys })).catch(() => {});
  } catch { /* an editor failure never breaks the manager */ }
}

function gateState(m) {
  return { fault: m.fault, busy: isBusy(m), pending: m.pending, editorVm: m.editorVm, activeTestId: m.activeTestId, records: [...m.records.values()] };
}

// ── editor synchronization (spec §26.2a) ────────────────────────────────────────────────────────────────────────

function onEditorNotification(m, vm) {
  if (m.disposed) return;
  m.editorVm = vm;
  syncFrom(m, vm);
  changed(m);
}

/** Steps 1–2 of §26.2a for the record the editor is expected to hold. Task 9 replaces the mismatch branch. */
function syncFrom(m, vm) {
  const t = vm?.test ?? null;
  if (t === null) return;
  const expected = t.testId === m.activeTestId || (m.activation !== null && t.testId === m.activation.targetTestId);
  const record = expected ? m.records.get(t.testId) : undefined;
  if (record === undefined) return;
  let dirty = false;
  if (t.draft !== record.draft) { record.draft = t.draft; dirty = true; }   // step 1: draft sync by identity
  if (reduceSummary(record, t.lastRun)) dirty = true;                       // step 2: summary reduction
  if (dirty) recordsChanged(m);
}

/** A sealed run is reduced ONCE (by runId); a Reset keeps lastReducedRunId so that run is never re-reduced. */
function reduceSummary(record, lastRun) {
  if (record === undefined || lastRun === null || lastRun === undefined || typeof lastRun.runId !== 'string') return false;
  if (lastRun.runId === record.lastReducedRunId) return false;
  record.summary = lastRun;
  record.lastReducedRunId = lastRun.runId;
  return true;
}

/** §26.2a second guard: re-read the editor synchronously and sync before the manager retires anything itself. */
function snapshotOutgoing(m) {
  m.editorVm = m.editor.getViewModel();
  syncFrom(m, m.editorVm);
}

async function loadInto(m, record, acknowledgeUnsaved) {
  try {
    return await m.editor.dispatch({ type: INTENT.TEST_LOAD, testId: record.testId, draft: record.draft, acknowledgeUnsaved: acknowledgeUnsaved === true });
  } catch {
    return null;
  }
}

/**
 * §26.2a activation: snapshot → load → commit activeTestId ONLY on {ok, testId === targetTestId} with the editor
 * agreeing. Task 9 replaces this function to add divergence recovery.
 */
async function activate(m, targetTestId, acknowledgeUnsaved) {
  snapshotOutgoing(m);
  const record = m.records.get(targetTestId);
  if (record === undefined || record.draft?.testId !== record.testId) return { outcome: 'failed', reason: 'unknown-test' };   // manager-side existence check (M1)
  m.activation = { targetTestId };
  const result = await loadInto(m, record, acknowledgeUnsaved);
  const now = m.disposed ? null : m.editor.getViewModel();
  m.activation = null;
  if (m.disposed) return { outcome: 'failed', reason: 'disposed' };
  m.editorVm = now;
  if (result?.ok === true && result.testId === targetTestId && now?.test?.testId === targetTestId) {
    m.activeTestId = targetTestId;
    syncFrom(m, now);
    return { outcome: 'committed', releaseStuck: result.releaseStuck === true };
  }
  return { outcome: 'failed', reason: typeof result?.reason === 'string' ? result.reason : 'refused' };
}

// ── operations (spec §26.2a pending operation) ──────────────────────────────────────────────────────────────────

/** Creates THE single pending operation; executes at once when no confirmation is needed. */
function request(m, kind, { sourceTestId, targetTestId = null, createsSuccessor = false, alwaysPrompt = false }) {
  snapshotOutgoing(m);
  if (m.recovery !== null || m.fault !== null) { changed(m); return undefined; }
  const t = m.editorVm.test;
  const discardsUnsaved = sourceTestId === m.activeTestId && t.heldUnsaved === true;
  m.opSeq += 1;
  m.pending = {
    operationId: `op-${m.opSeq}`, kind, sourceTestId, targetTestId, createsSuccessor, discardsUnsaved,
    expectedEditorVersion: m.editorVm.version,
    observed: { runActive: t.runActive === true, heldUnsaved: t.heldUnsaved === true, testId: t.testId },
    state: alwaysPrompt || discardsUnsaved ? 'awaiting' : 'executing',
  };
  changed(m);
  return m.pending.state === 'executing' ? execute(m, m.pending.operationId) : undefined;
}

async function execute(m, operationId) {
  const p = m.pending;
  if (p === null || p.operationId !== operationId) return;
  p.state = 'executing';
  m.notice = null;
  changed(m);
  try {
    await RUN[p.kind](m, p);
  } finally {
    if (m.pending === p) m.pending = null;
    if (!m.disposed) changed(m);
  }
}

async function runSwitch(m, p) {
  const r = await activate(m, p.targetTestId, p.discardsUnsaved);
  if (r.outcome === 'committed') { m.view = 'editor'; m.live = MANAGER_TEXT.opened(nameOf(m, p.targetTestId)); }
  else if (r.outcome === 'failed') m.notice = MANAGER_TEXT.failed('open', nameOf(m, p.targetTestId), r.reason);
}

async function runCreate(m, p) {
  m.counter += 1;                                                 // never decremented, never reused (§26.4)
  const record = addRecord(m, createDraft({ testId: p.targetTestId, testNumber: m.counter }));
  const name = record.draft.name;
  const r = await activate(m, record.testId, p.discardsUnsaved);
  if (r.outcome === 'committed') { m.view = 'editor'; m.live = MANAGER_TEXT.created(name); return; }
  removeRecord(m, record.testId);                                  // AC-M16: a failed Create leaves no record
  if (r.outcome === 'failed') m.notice = MANAGER_TEXT.failed('create', name, r.reason);
}

const RUN = { switch: runSwitch, create: runCreate };

// ── intents ─────────────────────────────────────────────────────────────────────────────────────────────────────

function setView(m, view) {
  if (m.view !== view) { m.view = view; changed(m); }
  return undefined;
}

function onOpen(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'open', testId).enabled) return undefined;
  if (testId === m.activeTestId) return setView(m, 'editor');     // §26.8: changes nothing else
  return request(m, 'switch', { sourceTestId: m.activeTestId, targetTestId: testId });
}

function onCreate(m) {
  if (!actionGate(gateState(m), 'create').enabled) return undefined;
  const targetTestId = mintFresh(m);
  if (targetTestId === null) return refuseNoId(m);
  return request(m, 'create', { sourceTestId: m.activeTestId, targetTestId });
}

function onDuplicate(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'duplicate', testId).enabled) return undefined;
  if (testId === m.activeTestId) snapshotOutgoing(m);             // §26.4: the active test's CURRENT draft
  const source = m.records.get(testId)?.draft;
  if (source === undefined) return undefined;
  const newId = mintFresh(m);
  if (newId === null) return refuseNoId(m);
  const name = duplicateName(source.name, [...m.records.values()].map((r) => r.draft.name));
  addRecord(m, duplicateDraft(source, { testId: newId, name }));
  m.live = MANAGER_TEXT.duplicated(source.name, name);
  changed(m);
  return undefined;
}

const HANDLERS = {
  [MANAGER_INTENT.VIEW_LIST]: (m) => setView(m, 'list'),
  [MANAGER_INTENT.VIEW_EDITOR]: (m) => setView(m, 'editor'),
  [MANAGER_INTENT.OPEN]: onOpen,
  [MANAGER_INTENT.CREATE]: onCreate,
  [MANAGER_INTENT.DUPLICATE]: onDuplicate,
};

function dispatch(m, intent) {
  if (intent === null || typeof intent !== 'object' || typeof intent.type !== 'string') {
    throw new TypeError('unknown intent: an intent must be an object with a string `type`');
  }
  if (m.disposed) return Promise.resolve(undefined);
  if (MANAGER_TYPES.has(intent.type)) {
    const handler = HANDLERS[intent.type];
    return Promise.resolve(handler === undefined ? undefined : handler(m, intent)).then(() => undefined);
  }
  if (intent.type === INTENT.TEST_LOAD || intent.type === INTENT.TEST_LABEL_SCOPE) return Promise.resolve(undefined);   // manager-only seams
  if (intent.type === INTENT.SETUP_NEW_TEST) return Promise.resolve(onCreate(m)).then(() => undefined);   // §26.8
  return m.editor.dispatch(intent);
}

// ── ViewModel + dispose ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Names, readiness and "models changed" for every record. Recomputed only when a §26.6 trigger fired (catalog change /
 * model left → catalogEpoch) or a record changed (recordsVersion) — never per run-progress notification (Codex plan
 * review Q1). Cost with many records × models remains the CTM-8 calibration gate.
 */
function derivedOf(m) {
  const d = m.derived;
  if (d !== null && d.catalogEpoch === m.catalogEpoch && d.recordsVersion === m.recordsVersion) return d;
  let listed = [];
  try { listed = m.catalog.list() ?? []; } catch { listed = []; }
  if (!Array.isArray(listed)) listed = [];
  // H1: a departed key is absent at once — its entry is not "in the scene" and its binding reads as null.
  const entries = listed.filter((e) => !m.departed.has(e?.modelKey));
  const bindingFor = (k) => (m.departed.has(k) ? null : m.bindingFor(k));
  const inCatalog = new Set(entries.map((e) => e?.modelKey).filter((k) => typeof k === 'string'));
  const records = [...m.records.values()];
  // CTM-2 / seam (e): names are disambiguated over catalog.list() keys ∪ the referenced scope — exactly the key set the
  // editor's resolver uses once pushLabelScope delivered the same scope (displayed-run keys are a subset of it).
  const keys = new Set([...listed.map((e) => e?.modelKey).filter((k) => typeof k === 'string'), ...labelScopeOf(m)]);
  const names = disambiguatedNames(m.catalog, [...keys].sort());
  const baseName = (k) => names.get(k) ?? fallbackModelName(k);
  m.derived = {
    catalogEpoch: m.catalogEpoch, recordsVersion: m.recordsVersion,
    scopeName: (k) => (inCatalog.has(k) ? baseName(k) : `${baseName(k)} (not loaded)`),
    readiness: new Map(records.map((r) => [r.testId, readinessOf({ draft: r.draft, entries, bindingFor, modelName: baseName })])),
    modelsChanged: new Map(records.map((r) => [r.testId, modelsChangedOf({ summary: r.summary, bindingFor, catalog: m.catalog })])),
  };
  return m.derived;
}

function viewModelOf(m) {
  if (m.vmCache !== null) return m.vmCache;
  const { scopeName, readiness, modelsChanged } = derivedOf(m);
  const manager = buildManagerViewModel({ ...gateState(m), view: m.view, notice: m.notice, live: m.live, scopeName, readiness, modelsChanged });
  m.vmCache = Object.freeze({ manager, editor: m.editorVm });
  return m.vmCache;
}

/** §26.8: drop records and the manager's OWN listeners; the editor's dispose() is the composition root's next step. */
function dispose(m) {
  if (m.disposed) return;
  m.disposed = true;
  for (const off of m.disposers.splice(0)) {
    try { off(); } catch { /* keep going */ }
  }
  m.records.clear();
  m.departed.clear();
  m.pending = null;
  m.activation = null;
  m.recovery = null;
  m.subscribers.clear();
  m.derived = null;
  m.vmCache = null;
}
```

Then: add `export { createTestsManager } from './testsManager.js';` to `clashpanel/core/index.js` (and one header-comment line: "plus the Clash Tests manager factory (spec §26)"); change `test/clashpanel/core/index.test.mjs:10` to `['INTENT', 'buildViewModel', 'createDefaultScheduler', 'createPanelController', 'createTestsManager']`; add `'core/testsManager.js',` to the scaffold list after `'core/managerViewModel.js',`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/clashpanel/core/testsManager.core.test.mjs test/clashpanel/core/index.test.mjs test/clashpanel/scaffold.test.mjs test/clashpanel/layering.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 6: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/testsManager.js clashpanel/core/index.js test/clashpanel/support/fakeEditor.mjs test/clashpanel/core/testsManager.core.test.mjs test/clashpanel/core/index.test.mjs test/clashpanel/scaffold.test.mjs
git commit -m "feat(clashpanel): Clash Tests manager core — records, sync, open/create/duplicate (spec §26)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Pending operations — confirm/cancel/re-check, Delete test, Reset results

**Files:**
- Modify: `clashpanel/core/testsManager.js` (add `onConfirm`, `onCancel`, `reevaluate`, `onDelete`, `onReset`, `runDelete`, `runReset`; extend `RUN` and `HANDLERS`)
- Test: `test/clashpanel/core/testsManager.pending.test.mjs`

**Interfaces:**
- Consumes: Task 7 internals (`request`, `execute`, `activate`, `snapshotOutgoing`, `gateState`, `nameOf`, `changed`).
- Produces: `MANAGER_INTENT.CONFIRM/CANCEL/DELETE/RESET` behavior per §26.2a/§26.7:
  - CONFIRM/CANCEL with a non-current or non-awaiting `operationId` → ignored; CONFIRM while the editor's own confirmation is pending → ignored.
  - CONFIRM re-check: if `vm.version !== expectedEditorVersion` **and** any of `runActive`/`heldUnsaved`/`testId` changed → re-evaluated (refused with the gate reason, or re-prompted as a NEW operation with `MANAGER_TEXT.RECHECKED`), never executed with outdated consent.
  - Delete: always prompts; non-active → remove record; active → activate successor (next, else previous; none → fresh `Clash test <N>`), commit, remove, `view:'list'`.
  - Reset: prompts only when the active test's held results are unsaved; active → `RESULTS_CLEAR` (+ `RESULTS_CLEAR_CONFIRMED` under the manager's consent) then `summary = null`; non-active → `summary = null`.

- [ ] **Step 1: Write the failing tests**

```js
// test/clashpanel/core/testsManager.pending.test.mjs — spec §26.2a pending operation, §26.7 Delete/Reset, AC-M8/M9/M15/M18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { makeManagerHarness, lastRunOf } from '../support/fakeEditor.mjs';

const loads = (h) => h.editor.dispatched.filter((i) => i.type === INTENT.TEST_LOAD);
const held = (h, runId = 'run-1') => h.editor.set({ heldUnsaved: true, lastRun: lastRunOf(runId, 2) }, { runPatch: { state: 'done' } });
const confirm = (h) => h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: h.vm().confirm.operationId });

test('confirming a switch loads with acknowledgeUnsaved:true; cancelling changes nothing (AC-M2, AC-M15)', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: h.vm().confirm.operationId });
  assert.equal(h.vm().pending, null);
  assert.equal(loads(h).length, 0);
  assert.equal(h.vm().activeTestId, 'test-1');
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  await confirm(h);
  assert.equal(loads(h).length, 1);
  assert.equal(loads(h)[0].acknowledgeUnsaved, true);
  assert.equal(h.vm().activeTestId, 'new-1');
  assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported', 'outgoing summary captured before the retirement');
});

test('AC-M18: stale operationIds are ignored; a second action while one is pending is ignored', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  const op1 = h.vm().confirm.operationId;
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: op1 });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-1' });
  const op2 = h.vm().confirm.operationId;
  assert.notEqual(op2, op1);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op1 });
  assert.equal(h.vm().pending.operationId, op2, 'stale confirm ignored');
  assert.equal(h.vm().count, 2);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: 'op-999' });
  assert.equal(h.vm().pending.operationId, op2, 'other actions and unknown ids ignored while pending');
});

test('Review Focus 1: a double click (two identical actions in one tick) starts exactly one operation', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await Promise.all([h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' }), h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' })]);
  assert.equal(loads(h).length, 1);
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  await Promise.all([h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op }), h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op })]);
  assert.equal(h.vm().count, 1);
});

test('AC-M18: a confirm after the editor changed is re-checked — run started → refused; results became unsaved → re-prompted', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().notice, 'Stop the running test first.');
  assert.equal(h.vm().count, 1);
  assert.equal(loads(h).length, 0);

  h.editor.set({ runActive: false }, { runPatch: { state: 'idle' } });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op2 = h.vm().confirm.operationId;
  assert.doesNotMatch(h.vm().confirm.text, /unsaved/);
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op2 });
  const vm = h.vm();
  assert.notEqual(vm.confirm.operationId, op2, 're-prompted as a new operation');
  assert.match(vm.confirm.text, /Its unsaved results are discarded too\.$/);
  assert.equal(vm.notice, 'The test changed while you were confirming — please confirm again.');
  assert.equal(loads(h).length, 0, 'never executed with outdated consent');
});

test('manager actions are disabled while the editor confirmation is pending; CONFIRM_CANCEL is forwarded', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  h.editor.set({ pendingConfirm: true });
  assert.equal(h.vm().confirm.enabled, false);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().pending.operationId, op, 'not executed while the editor asks');
  await h.dispatch({ type: INTENT.CONFIRM_CANCEL });
  assert.equal(h.editor.test.pendingConfirm, false);
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: op });
  h.editor.set({ pendingConfirm: true });
  assert.deepEqual(h.vm().create, { enabled: false, reason: 'Answer the pending confirmation in the test editor first.' });
});

test('AC-M8: Delete always confirms; a non-active delete removes only that record; the counter is never reused', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const c = h.vm().confirm;
  assert.equal(c.text, 'Delete “Clash test 1”? Its setup and results are discarded for this session and can\'t be recovered.');
  assert.equal(c.confirmLabel, 'Delete test');
  await confirm(h);
  assert.deepEqual(h.vm().tests.map((t) => t.name), ['Clash test 2']);
  assert.equal(h.vm().live, 'Deleted “Clash test 1” for this session.');
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().tests.at(-1).name, 'Clash test 3');
});

test('AC-M8: deleting the active test activates the next record, else the previous, and returns to the list', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  await confirm(h);
  assert.equal(h.vm().activeTestId, 'new-1');
  assert.equal(h.vm().view, 'list');
  assert.deepEqual(h.vm().tests.map((t) => t.testId), ['new-1', 'new-2']);
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-2' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-2' });
  await confirm(h);
  assert.equal(h.vm().activeTestId, 'new-1');
});

test('AC-M8 / CTM-5: deleting the last test leaves exactly one fresh active "Clash test <N>"', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  await confirm(h);
  const vm = h.vm();
  assert.equal(vm.count, 1);
  assert.equal(vm.activeTestId, 'new-1');
  assert.equal(vm.tests[0].name, 'Clash test 2');
});

test('deleting the active test with unsaved results: ONE prompt that states the discard and is the acknowledgement', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.match(h.vm().confirm.text, /Its unsaved results are discarded too\.$/);
  await confirm(h);
  assert.equal(loads(h).at(-1).acknowledgeUnsaved, true);
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().confirm, null, 'never a second prompt');
});

test('deleting the last test with a colliding minted id is refused: nothing is deleted (Codex plan review I3)', async () => {
  const h = makeManagerHarness({ mintId: () => 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().notice, 'A new test id could not be created; nothing was changed.');
});

test('deleting a running test is impossible', async () => {
  const h = makeManagerHarness();
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().tests[0].actions.delete.enabled, false);
});

test('AC-M9: Reset of a non-active test drops only its summary, with no prompt, keeping testId and draft', async () => {
  const h = makeManagerHarness();
  h.editor.set({ lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.row('test-1').resultsText, 'Results not held — open and re-run to view');
  await h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
  assert.equal(h.vm().confirm, null);
  assert.deepEqual(h.row('test-1').status, { kind: 'not-run', text: 'Not run' });
  assert.equal(h.row('test-1').name, 'Clash test 1');
  assert.equal(h.vm().live, 'Reset the results of “Clash test 1”.');
});

test('AC-M9/AC-M15: Reset of the active test with unsaved results confirms once, uses the existing Clear path, stays reset', async () => {
  const h = makeManagerHarness();
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
  assert.match(h.vm().confirm.text, /Resetting discards them/);
  await confirm(h);
  assert.deepEqual(h.editor.dispatched.map((i) => i.type).slice(-2), [INTENT.RESULTS_CLEAR, INTENT.RESULTS_CLEAR_CONFIRMED]);
  assert.deepEqual(h.row('test-1').status, { kind: 'not-run', text: 'Not run' });
  h.editor.set({});
  assert.deepEqual(h.row('test-1').status, { kind: 'not-run', text: 'Not run' }, 'the reset run is never re-reduced');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashpanel/core/testsManager.pending.test.mjs`
Expected: FAIL — e.g. `TypeError: Cannot read properties of null (reading 'operationId')` (DELETE has no handler yet, so no confirm exists) and CONFIRM/CANCEL tests fail on unchanged state.

- [ ] **Step 3: Implement**

Add to `clashpanel/core/testsManager.js` after `runCreate` (and replace `const RUN = { switch: runSwitch, create: runCreate };` with the version below):

```js
async function runDelete(m, p) {
  const victim = m.records.get(p.sourceTestId);
  if (victim === undefined) return;
  const name = victim.draft.name;
  if (p.sourceTestId !== m.activeTestId) {                        // non-active: nothing held, nothing to retire
    removeRecord(m, p.sourceTestId);
    m.live = MANAGER_TEXT.deleted(name);
    return;
  }
  let created = null;
  if (p.createsSuccessor) {                                       // deleting the last test = Delete + Create (CTM-5)
    m.counter += 1;
    created = addRecord(m, createDraft({ testId: p.targetTestId, testNumber: m.counter }));
  }
  const r = await activate(m, p.targetTestId, p.discardsUnsaved);
  if (r.outcome === 'committed') {
    removeRecord(m, victim.testId);
    m.view = 'list';
    m.live = MANAGER_TEXT.deleted(name);
    return;
  }
  if (created !== null) removeRecord(m, created.testId);
  if (r.outcome === 'failed') m.notice = MANAGER_TEXT.failed('delete', name, r.reason);
}

async function runReset(m, p) {
  const record = m.records.get(p.sourceTestId);
  if (record === undefined) return;
  if (p.sourceTestId === m.activeTestId) {
    snapshotOutgoing(m);                                          // the seal is reduced before anything is retired
    await m.editor.dispatch({ type: INTENT.RESULTS_CLEAR });       // the existing clearResults path (§26.7)
    if (m.editor.getViewModel().test.pendingConfirm === true) {
      if (p.discardsUnsaved !== true) {                           // unsaved since the request: never discard without consent
        await m.editor.dispatch({ type: INTENT.CONFIRM_CANCEL });
        m.notice = MANAGER_TEXT.RECHECKED;
        return;
      }
      await m.editor.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
    }
  }
  record.summary = null;                                          // lastReducedRunId is kept: never re-reduced
  recordsChanged(m);
  m.live = MANAGER_TEXT.reset(record.draft.name);
}

const RUN = { switch: runSwitch, create: runCreate, delete: runDelete, reset: runReset };
```

Add after `onDuplicate`:

```js
function onDelete(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'delete', testId).enabled) return undefined;
  if (testId !== m.activeTestId) return request(m, 'delete', { sourceTestId: testId, alwaysPrompt: true });
  const order = [...m.records.keys()];
  const i = order.indexOf(testId);
  const successor = order[i + 1] ?? order[i - 1] ?? null;          // next in list order, else the previous
  const targetTestId = successor ?? mintFresh(m);
  if (targetTestId === null) return refuseNoId(m);
  return request(m, 'delete', { sourceTestId: testId, targetTestId, createsSuccessor: successor === null, alwaysPrompt: true });
}

function onReset(m, intent) {
  const testId = intent.testId;
  if (!actionGate(gateState(m), 'reset', testId).enabled) return undefined;
  return request(m, 'reset', { sourceTestId: testId });
}

function onConfirm(m, intent) {
  const p = m.pending;
  if (p === null || p.operationId !== intent.operationId || p.state !== 'awaiting' || m.fault !== null) return undefined;   // stale
  const vm = m.editor.getViewModel();
  m.editorVm = vm;
  const t = vm.test;
  if (t.pendingConfirm === true) { changed(m); return undefined; }  // disabled while the editor asks (§26.2a)
  const drifted = vm.version !== p.expectedEditorVersion
    && (t.runActive !== p.observed.runActive || t.heldUnsaved !== p.observed.heldUnsaved || t.testId !== p.observed.testId);
  if (drifted) return reevaluate(m, p);
  return execute(m, p.operationId);
}

function onCancel(m, intent) {
  const p = m.pending;
  if (p === null || p.operationId !== intent.operationId || p.state !== 'awaiting') return undefined;
  m.pending = null;
  changed(m);
  return undefined;
}

const ACTION_OF = Object.freeze({ switch: 'open', create: 'create', delete: 'delete', reset: 'reset' });
const REDO = {
  switch: (m, p) => onOpen(m, { testId: p.targetTestId }),
  create: (m) => onCreate(m),
  delete: (m, p) => onDelete(m, { testId: p.sourceTestId }),
  reset: (m, p) => onReset(m, { testId: p.sourceTestId }),
};

/** A confirm whose consent is outdated: refuse with the gate reason, or re-request (new operationId, maybe a new prompt). */
function reevaluate(m, p) {
  m.pending = null;
  if (m.editorVm.test.testId !== m.activeTestId) {
    m.notice = MANAGER_TEXT.REFUSED_CHANGED;
    changed(m);
    return undefined;
  }
  const g = actionGate(gateState(m), ACTION_OF[p.kind], p.kind === 'switch' ? p.targetTestId : p.sourceTestId);
  if (!g.enabled) { m.notice = g.reason; changed(m); return undefined; }
  const out = REDO[p.kind](m, p);
  m.notice = m.pending?.state === 'awaiting' ? MANAGER_TEXT.RECHECKED : null;
  changed(m);
  return out;
}
```

Extend `HANDLERS` with:

```js
  [MANAGER_INTENT.DELETE]: onDelete,
  [MANAGER_INTENT.RESET]: onReset,
  [MANAGER_INTENT.CONFIRM]: onConfirm,
  [MANAGER_INTENT.CANCEL]: onCancel,
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/clashpanel/core/testsManager.pending.test.mjs test/clashpanel/core/testsManager.core.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 5: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/testsManager.js test/clashpanel/core/testsManager.pending.test.mjs
git commit -m "feat(clashpanel): manager pending operations, Delete test and Reset results (spec §26.2a, §26.7)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: M1 — divergence recovery with one token, terminal manager fault, editor-intent gating

**Files:**
- Modify: `clashpanel/core/testsManager.js` (add the exported `FAULT_POLICY`, `beginRecovery`, `compensate`; **replace** `syncFrom` and `activate`; one line each in `dispatch` and `reevaluate`; fault overlay in `viewModelOf`)
- Create: `test/clashpanel/support/faultControls.mjs` (the single intent → control mapping table, Work plan re-review M1; also consumed by Task 11)
- Test: `test/clashpanel/core/testsManager.recovery.test.mjs`

**Interfaces:**
- Consumes: Tasks 7–8 internals.
- Produces (M1, mechanical):
  - `m.recovery: null | {token:number, cause:'notification'|'result'|'confirm', state:'scheduled'|'loading'}`.
  - `beginRecovery(m, cause, {schedule: boolean})` — no-op if `m.recovery !== null || m.fault !== null` (coalescing). `schedule:true` (no activation in flight) queues exactly one `compensate(m, token)` microtask; `schedule:false` (inside an activation) leaves compensation to the activation, which calls it once after its load settles.
  - `compensate(m, token)` — runs only for the current token in state `'scheduled'`; loads the committed `activeTestId`'s record with `acknowledgeUnsaved:false` (plan decision P-7); success iff `result.ok && result.testId === activeTestId && editor.getViewModel().test.testId === activeTestId` → `recovery = null`, notice `MANAGER_TEXT.restored(name)`; otherwise `fault = {text: MANAGER_TEXT.FAULT}`, `pending = null`.
  - `syncFrom` returns before touching any record while `recovery !== null || fault !== null`; an unexpected id starts recovery (`schedule: m.activation === null`).
  - Fault (Work plan review M2 — explicit **allow-list**, plan decision P-3): every manager action disabled (via `actionGate`; `VIEW_LIST`/`VIEW_EDITOR` stay); `dispatch` forwards an editor intent only if `FAULT_POLICY[intent.type] === 'allow'` — anything else, including an intent missing from the table, is dropped (fail closed). `FAULT_POLICY` classifies **every** `INTENT` value (39):
    - **allow (20)** — non-mutating list/navigation and view state: `FILTER_TEXT`, `FILTER_MODEL`, `FILTER_MAX_GAP`, `FILTER_UNVERIFIED`, `FILTER_HAS_LOCATION`, `FILTER_ELEMENT`, `FILTER_CLEAR`, `GROUP_MODE`, `GROUP_TOGGLE`, `SORT_SET`, `NAV_PAGE`, `SETUP_TOGGLE_COLLAPSED`, `ACTION_FOCUS_ON_SELECT` (a preference toggle; it presents nothing); Stop: `RUN_STOP`; Clear and its confirmation: `RESULTS_CLEAR`, `RESULTS_CLEAR_CONFIRMED`, `CONFIRM_CANCEL`; hide/show needed for cleanup: `PANEL_HIDDEN` (the existing `bridge.clear()` cleanup path), `PANEL_SHOWN` (freshness re-check only); diagnostics: `DIAGNOSTICS_COPY`. Disposal is not an intent and is always available.
    - **block (19)** — setup edits: `SETUP_NAME`, `SETUP_MODE`, `SETUP_CLEARANCE`, `SETUP_BASIS`, `SETUP_TOGGLE_MODEL`, `SETUP_USE_SELECTION`, `SETUP_SELF_CLASH`, `SETUP_NEW_TEST`; run/admission: `RUN_START`, `RUN_RELEASE_AND_RETRY`; Viewer-mutating result actions (`controller.js` `select`/`present`/`onBackToAll` call `bridge.present`/`bridge.clear`): `NAV_SELECT`, `NAV_PREV`, `NAV_NEXT`, `ACTION_FOCUS`, `ACTION_ISOLATE`, `ACTION_MARKERS`, `ACTION_BACK_TO_ALL`; manager-only seams: `TEST_LOAD`, `TEST_LABEL_SCOPE`.
    - `RESULTS_CLEAR_CONFIRMED` is safe to allow because, on entering the fault, the manager dispatches `INTENT.CONFIRM_CANCEL` once: an editor confirmation raised before the fault (e.g. for Run) is dropped, and while faulted only `RESULTS_CLEAR` can raise a new one (`RUN_START`, `SETUP_NEW_TEST` are blocked), so the confirmation can only ever confirm a Clear.
  - **Fault overlay = dispatch policy (Work plan re-review M1).** While faulted, `getViewModel().editor` is `lockedEditorVm(m.editorVm, m.fault.text, FAULT_POLICY)` (Task 6): every **user-facing** control whose intent `FAULT_POLICY` blocks reports `{enabled:false, reason: MANAGER_TEXT.FAULT}` (setup edits + New test, Run, Release and retry, result-row selection, Previous/Next, Focus, Isolate, Markers, Back to All), allow-listed controls are carried over unchanged, and the Task 11 renderer turns exactly those gates into disabled DOM controls described by the fault banner. Not faulted ⇒ the composite `editor` **is** `m.editorVm` (identity; no copy). The overlay lives only in the manager layer (`managerViewModel.js`, `testsManager.js`, `ui/render/manager.js`): the editor's controller, `viewModel.js` builders and the five editor renderers are unchanged (AC-M13).
  - `test/clashpanel/support/faultControls.mjs` (test support): `FAULT_CONTROLS` — the single explicit table mapping each user-facing editor `INTENT` to `{gate(editorVm) → {enabled, reason}|value, dom: [selector…]}`; `NON_USER_FACING` — the intents with no control in the editor Panel and why (`TEST_LOAD`, `TEST_LABEL_SCOPE`: manager-only seams; `PANEL_HIDDEN`, `PANEL_SHOWN`: shell visibility lifecycle, `ClashDockingPanel.js:84`); `faultFixtureEditorVm()` — a deep-frozen full editor ViewModel in which every mapped control is rendered and enabled; `variant` entries + `faultVariantEditorVm()` for the mutually exclusive alternative dispatch sites (admission-banner Clear results, empty-filtered Clear filters); `faultCases()` — the two cases both equivalence tests iterate. Guard: `FAULT_CONTROLS` ∪ `NON_USER_FACING` = exactly the `INTENT` values, disjoint.

- [ ] **Step 1: Write the mapping table and the failing tests**

```js
// test/clashpanel/support/faultControls.mjs — Work plan re-review M1: THE single explicit mapping from every editor
// INTENT to the user-facing control(s) that dispatch it, used to pin "fault overlay = FAULT_POLICY" mechanically:
//   gate(editorVm) → the ViewModel value the fault overlay must set to {enabled:false, reason} when the intent is
//                    blocked, and must leave unchanged when it is allowed;
//   dom            → selectors of the rendered node(s) the managed renderer must disable and describe when blocked.
//   variant        → an ALTERNATIVE dispatch site of the same intent that cannot render together with `dom` (a
//                    mutually exclusive state), checked against faultVariantEditorVm() (Codex targeted review Medium).
// An intent with no control in the editor Panel is declared in NON_USER_FACING with its reason. A new INTENT, or an
// intent moved between allow and block in FAULT_POLICY, fails Task 9 / Task 11 until this table and the overlay agree.
// Plain data + pure functions; Node-side only (the DOM test passes `dom` selectors into the page as strings).
import { INTENT } from '../../../clashpanel/core/intents.js';
import { panelVm, setupVm, runVm, filtersVm, resultsVm, selectedVm, resultRow, groupRow } from '../dom/support/vmFixtures.mjs';

const bannerAction = (type) => (vm) => vm.run.banners.find((b) => b.action?.intent?.type === type)?.action;
const lockedBy = (enabled, part) => ({ enabled, reason: part?.reason ?? null });
const key = (k) => `[data-key="${k}"]`;

export const NON_USER_FACING = Object.freeze({
  [INTENT.TEST_LOAD]: 'manager-only seam (a): dispatched by the manager; dropped from UI/facade dispatch',
  [INTENT.TEST_LABEL_SCOPE]: 'manager-only seam (e): dispatched by the manager; dropped from UI/facade dispatch',
  [INTENT.PANEL_HIDDEN]: 'shell visibility lifecycle (ClashDockingPanel.js), not a control in the Panel body',
  [INTENT.PANEL_SHOWN]: 'shell visibility lifecycle (ClashDockingPanel.js), not a control in the Panel body',
});

export const FAULT_CONTROLS = Object.freeze({
  // Setup region (setup.js) — one shared setup lock; New test and Use selection also have their own existing gates.
  [INTENT.SETUP_NAME]: { gate: (vm) => vm.setup.locked, dom: [key('setup-name')] },
  [INTENT.SETUP_MODE]: { gate: (vm) => vm.setup.locked, dom: ['[data-key^="setup-mode-"]'] },
  [INTENT.SETUP_CLEARANCE]: { gate: (vm) => vm.setup.locked, dom: [key('setup-clearance')] },
  [INTENT.SETUP_BASIS]: { gate: (vm) => vm.setup.locked, dom: [key('setup-basis')] },
  [INTENT.SETUP_TOGGLE_MODEL]: { gate: (vm) => vm.setup.locked, dom: ['section[data-region="setup"] .clash-model-list input'] },
  [INTENT.SETUP_USE_SELECTION]: { gate: (vm) => lockedBy(vm.setup.useSelectionEnabled, vm.setup.locked), dom: ['[data-key^="setup-use-selection-"]'] },
  [INTENT.SETUP_SELF_CLASH]: { gate: (vm) => vm.setup.locked, dom: [key('setup-self-clash')] },
  [INTENT.SETUP_NEW_TEST]: { gate: (vm) => vm.setup.newTest, dom: [key('setup-new-test')] },
  [INTENT.SETUP_TOGGLE_COLLAPSED]: { gate: (vm) => vm.setup.collapsed, dom: [key('setup-toggle-collapsed')] },
  // Run region (run.js) — banner actions carry their intent as data.
  [INTENT.RUN_START]: { gate: (vm) => lockedBy(vm.run.canRun, vm.run.locked), dom: [key('run-start')] },
  [INTENT.RUN_STOP]: { gate: (vm) => vm.run.canStop, dom: [key('run-stop')] },
  [INTENT.RESULTS_CLEAR]: { gate: (vm) => vm.run.state, dom: [key('results-clear')],
    variant: { gate: bannerAction(INTENT.RESULTS_CLEAR), dom: [key('banner-admission-error-action')] } },   // admission 'clear-results'
  [INTENT.RESULTS_CLEAR_CONFIRMED]: { gate: bannerAction(INTENT.RESULTS_CLEAR_CONFIRMED), dom: [key('banner-confirm-discard-unsaved-action')] },
  [INTENT.RUN_RELEASE_AND_RETRY]: { gate: bannerAction(INTENT.RUN_RELEASE_AND_RETRY), dom: [key('banner-admission-error-action')] },
  [INTENT.DIAGNOSTICS_COPY]: { gate: (vm) => vm.run.diagnostics, dom: [key('diagnostics-copy')] },
  // Manager header (manager.js) — shown while the editor asks for a confirmation.
  [INTENT.CONFIRM_CANCEL]: { gate: (vm) => vm.test.pendingConfirm, dom: [key('editor-confirm-cancel')] },
  // Filters region (filters.js) and the selected clash's "Show only this element" (selected.js).
  [INTENT.FILTER_TEXT]: { gate: (vm) => vm.filters, dom: [key('filter-text')] },
  [INTENT.FILTER_MODEL]: { gate: (vm) => vm.filters, dom: [key('filter-model')] },
  [INTENT.FILTER_MAX_GAP]: { gate: (vm) => vm.filters, dom: [key('filter-max-gap')] },
  [INTENT.FILTER_UNVERIFIED]: { gate: (vm) => vm.filters, dom: [key('filter-unverified')] },
  [INTENT.FILTER_HAS_LOCATION]: { gate: (vm) => vm.filters, dom: [key('filter-has-location')] },
  [INTENT.FILTER_ELEMENT]: { gate: (vm) => [vm.filters.elementOnly, vm.selected.side1, vm.selected.side2], dom: [key('filter-element-clear'), key('selected-only-1'), key('selected-only-2')] },
  [INTENT.FILTER_CLEAR]: { gate: (vm) => vm.filters.active, dom: [key('filter-clear')],
    variant: { gate: (vm) => vm.results.state, dom: [key('results-clear-filters')] } },                  // empty-filtered results
  [INTENT.GROUP_MODE]: { gate: (vm) => vm.filters.groupBy, dom: ['[data-key^="group-"]'] },
  [INTENT.SORT_SET]: { gate: (vm) => vm.filters.sort, dom: [key('sort')] },
  // Results region (results.js).
  [INTENT.GROUP_TOGGLE]: { gate: (vm) => vm.results.rows.filter((r) => r.kind === 'group'), dom: ['.clash-group-row button'] },
  [INTENT.NAV_SELECT]: { gate: (vm) => vm.results.select, dom: ['section[data-region="results"] .clash-row'] },
  [INTENT.NAV_PREV]: { gate: (vm) => lockedBy(vm.results.nav.canPrev, vm.results.nav.locked), dom: [key('nav-prev')] },
  [INTENT.NAV_NEXT]: { gate: (vm) => lockedBy(vm.results.nav.canNext, vm.results.nav.locked), dom: [key('nav-next')] },
  [INTENT.NAV_PAGE]: { gate: (vm) => vm.results.page, dom: [key('page-prev'), key('page-next')] },
  // Selected clash region (selected.js).
  [INTENT.ACTION_FOCUS]: { gate: (vm) => vm.selected.actions.focus, dom: [key('action-focus')] },
  [INTENT.ACTION_ISOLATE]: { gate: (vm) => vm.selected.actions.isolate, dom: [key('action-isolate')] },
  [INTENT.ACTION_MARKERS]: { gate: (vm) => vm.selected.actions.markers, dom: [key('action-markers')] },
  [INTENT.ACTION_FOCUS_ON_SELECT]: { gate: (vm) => vm.selected.actions.focusOnSelect, dom: [key('action-focus-on-select')] },
  [INTENT.ACTION_BACK_TO_ALL]: { gate: (vm) => vm.selected.actions.backToAll, dom: [key('action-back-to-all')] },
});

function deepFrozen(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFrozen(v[k]); }
  return v;
}

/**
 * A full editor ViewModel (shape: core/viewModel.js; deep-frozen like buildViewModel's) in which EVERY control of
 * FAULT_CONTROLS is rendered and enabled: Soft setup with clearance + units, a done run that can still be stopped,
 * both banner actions, diagnostics, every filter (max gap, element-only, active), a grouped page with a selected row
 * and enabled Previous/Next/page buttons, a live selected clash, and an editor confirmation waiting.
 */
export function faultFixtureEditorVm() {
  return deepFrozen(panelVm({
    test: { testId: 'T-1', runActive: false, heldUnsaved: true, pendingConfirm: true, lastRun: null },
    setup: setupVm({
      mode: 'soft',
      basis: { ...setupVm().basis, required: true, state: 'unavailable', headline: 'Choose the units', message: 'Units are not verified.', value: 'mm' },
      clearance: { value: '5', visible: true, unitLabel: 'mm', error: null },
    }),
    run: runVm({
      state: 'done', doneKind: 'completed', canRun: true, canStop: true,
      diagnostics: { available: true, preview: ['line 1'] },
      banners: [
        { id: 'admission-error', kind: 'error', text: 'Previous results are still held.', action: { label: 'Release previous results and retry', intent: { type: INTENT.RUN_RELEASE_AND_RETRY } } },
        { id: 'confirm-discard-unsaved', kind: 'warning', text: 'Discard unsaved results?', action: { label: 'Discard unsaved results', intent: { type: INTENT.RESULTS_CLEAR_CONFIRMED } } },
      ],
    }),
    filters: filtersVm({ maxGap: { visible: true, value: '', max: 5, error: null }, elementOnly: { label: 'Wall-1' }, active: true, groupBy: 'element' }),
    results: resultsVm({
      view: 'grouped', page: { index: 1, count: 3, size: 50 },
      rows: [groupRow('g1', { expanded: true }), resultRow(0, { groupId: 'g1' }), resultRow(1, { groupId: 'g1', selected: true })],
      nav: { canPrev: true, canNext: true, label: 'Clash 2 of 3', scoped: false },
    }),
    selected: selectedVm(),
  }));
}

/** The mutually exclusive alternatives of faultFixtureEditorVm(): the admission banner offering Clear results (instead
 *  of Release and retry) and an empty-filtered results region (its own Clear filters button; no rows, no nav). */
export function faultVariantEditorVm() {
  const base = faultFixtureEditorVm();
  return deepFrozen({
    ...base,
    run: { ...base.run, banners: [{ id: 'admission-error', kind: 'error', text: 'Previous results are still held.', action: { label: 'Clear results', intent: { type: INTENT.RESULTS_CLEAR } } }] },
    results: { ...base.results, state: 'empty-filtered', message: 'No clashes match the current filters.', rows: [] },
  });
}

/** The cases the equivalence tests render: `main` checks every entry's {gate, dom}; `variant` checks every `variant`. */
export function faultCases() {
  const all = Object.entries(FAULT_CONTROLS);
  return [
    { name: 'main', vm: faultFixtureEditorVm(), controls: Object.fromEntries(all.map(([type, c]) => [type, { gate: c.gate, dom: c.dom }])) },
    { name: 'variant', vm: faultVariantEditorVm(), controls: Object.fromEntries(all.filter(([, c]) => c.variant).map(([type, c]) => [type, c.variant])) },
  ];
}
```

```js
// test/clashpanel/core/testsManager.recovery.test.mjs — independent Work review M1; spec §26.2a divergence recovery,
// §26.9 fault, AC-M16; Review Focus 4, 5 and 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';
import { MANAGER_TEXT, lockedEditorVm } from '../../../clashpanel/core/managerViewModel.js';
import { FAULT_POLICY } from '../../../clashpanel/core/testsManager.js';
import { makeManagerHarness, defaultLoad } from '../support/fakeEditor.mjs';
import { FAULT_CONTROLS, NON_USER_FACING, faultCases } from '../support/faultControls.mjs';

const loads = (h) => h.editor.dispatched.filter((i) => i.type === INTENT.TEST_LOAD);
const rogue = () => createDraft({ testId: 'rogue', testNumber: 99 });
const ok = (testId) => ({ ok: true, testId, version: 1, releaseStuck: false });
/** A manager driven into the terminal fault: a divergent Create load, then a refused compensation. */
async function faulted() {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }); return ok(intent.testId); });
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 2, releaseStuck: false, reason: 'unsaved-results' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
  return h;
}
// Work plan review M2: the expected allow-list, written out independently of the implementation's table.
const FAULT_ALLOWED = [
  INTENT.FILTER_TEXT, INTENT.FILTER_MODEL, INTENT.FILTER_MAX_GAP, INTENT.FILTER_UNVERIFIED, INTENT.FILTER_HAS_LOCATION,
  INTENT.FILTER_ELEMENT, INTENT.FILTER_CLEAR, INTENT.GROUP_MODE, INTENT.GROUP_TOGGLE, INTENT.SORT_SET, INTENT.NAV_PAGE,
  INTENT.SETUP_TOGGLE_COLLAPSED, INTENT.ACTION_FOCUS_ON_SELECT, INTENT.RUN_STOP, INTENT.RESULTS_CLEAR,
  INTENT.RESULTS_CLEAR_CONFIRMED, INTENT.CONFIRM_CANCEL, INTENT.PANEL_HIDDEN, INTENT.PANEL_SHOWN, INTENT.DIAGNOSTICS_COPY,
];

test('M1 notification-first: a mismatched notification during a load starts ONE recovery; the activation compensates once', async () => {
  const h = makeManagerHarness();
  const initial = h.editor.test.draft;
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }); return ok(intent.testId); });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  const l = loads(h);
  assert.equal(l.length, 2, 'the Create load + exactly one compensating load');
  assert.equal(l[1].testId, 'test-1');
  assert.equal(l[1].draft, initial, 'the committed source record\'s snapshotted draft');
  assert.equal(l[1].acknowledgeUnsaved, false);
  const vm = h.vm();
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(vm.fault, null);
  assert.equal(vm.notice, 'The test editor was restored to “Clash test 1”.');
  assert.equal(vm.count, 1, 'the Create record is rolled back');
  assert.equal(h.editor.test.testId, 'test-1');
});

test('M1 result-first: an ok result naming another testId (no notification) starts ONE compensation', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ok('rogue'));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2);
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.vm().fault, null);
});

test('M1: a refusal naming another testId is a divergence, not a plain failure', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ({ ok: false, testId: 'rogue', version: 1, releaseStuck: false, reason: 'run-active' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2);
});

test('M1 duplicate signals: two mismatched notifications AND a mismatched result yield exactly one compensation', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => {
    editor.set({ testId: 'rogue', draft: rogue() });
    editor.set({ testId: 'rogue2', draft: rogue() });
    return ok('rogue');
  });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2);
  assert.equal(h.vm().fault, null);
});

test('M1 spontaneous divergence: no activation in flight → one scheduled compensation; a disagreeing id never syncs', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });           // new-1, not active
  const hijack = draftReduce(createDraft({ testId: 'new-1' }), { type: 'name', value: 'Hijacked' });
  h.editor.set({ testId: 'new-1', draft: hijack });
  h.editor.set({ testId: 'new-1', draft: hijack });                                 // a second signal, same divergence
  assert.equal(h.row('new-1').name, 'Clash test 1 copy');
  await h.settle();
  assert.equal(loads(h).length, 1, 'one compensating load');
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.row('new-1').name, 'Clash test 1 copy');
  assert.equal(h.editor.test.testId, 'test-1');
});

test('M1 compensation failure → terminal fault: manager + editor run/edit actions disabled; Clear, Stop and views stay', async () => {
  const h = await faulted();
  const vm = h.vm();
  assert.deepEqual(vm.fault, { text: MANAGER_TEXT.FAULT });
  assert.ok(h.editor.dispatched.some((i) => i.type === INTENT.CONFIRM_CANCEL), 'M2: a pre-fault editor confirmation is dropped on entry');
  assert.deepEqual(vm.create, { enabled: false, reason: MANAGER_TEXT.FAULT });
  assert.ok(vm.tests.every((t) => Object.values(t.actions).every((a) => !a.enabled)));
  assert.deepEqual(vm.editorLock, { enabled: false, reason: MANAGER_TEXT.FAULT });
  const composite = h.manager.getViewModel().editor;
  assert.equal(composite.run.canRun, false, 'headless consumers see Run disabled (§26.9)');
  assert.deepEqual(composite.run.locked, { enabled: false, reason: MANAGER_TEXT.FAULT });
  const n = h.editor.dispatched.length;
  for (const type of [INTENT.SETUP_NAME, INTENT.SETUP_NEW_TEST, INTENT.RUN_START, INTENT.RUN_RELEASE_AND_RETRY]) await h.dispatch({ type, value: 'x' });
  assert.equal(h.editor.dispatched.length, n, 'run/edit intents blocked');
  for (const type of [INTENT.NAV_SELECT, INTENT.NAV_NEXT, INTENT.ACTION_FOCUS, INTENT.ACTION_ISOLATE, INTENT.ACTION_MARKERS, INTENT.ACTION_BACK_TO_ALL]) {
    await h.dispatch({ type, value: true, resultId: 'r0', groupId: null });
  }
  assert.equal(h.editor.dispatched.length, n, 'M2: Viewer-mutating result actions blocked');
  for (const type of [INTENT.RESULTS_CLEAR, INTENT.RUN_STOP, INTENT.PANEL_HIDDEN]) await h.dispatch({ type });
  assert.deepEqual(h.editor.dispatched.slice(n).map((i) => i.type), [INTENT.RESULTS_CLEAR, INTENT.RUN_STOP, INTENT.PANEL_HIDDEN]);
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });
  assert.equal(h.vm().view, 'list');
  h.editor.set({ draft: rogue() });
  assert.ok(h.vm().tests.every((t) => t.name !== 'Clash test 99'), 'no draft synced by a disagreeing id');
  assert.equal(loads(h).length, 2, 'no further compensation after the fault');
});

test('M2: FAULT_POLICY classifies EVERY editor INTENT exactly once — a new, unclassified intent fails this test', () => {
  assert.ok(Object.isFrozen(FAULT_POLICY));
  assert.deepEqual(Object.keys(FAULT_POLICY).sort(), Object.values(INTENT).sort(), 'exactly the INTENT values, no more, no fewer');
  for (const [type, policy] of Object.entries(FAULT_POLICY)) assert.ok(policy === 'allow' || policy === 'block', type);
  assert.deepEqual(Object.keys(FAULT_POLICY).filter((t) => FAULT_POLICY[t] === 'allow').sort(), [...FAULT_ALLOWED].sort());
});

test('M2: while faulted exactly the allow-listed intents reach the editor; every other intent is dropped', async () => {
  const h = await faulted();
  for (const type of Object.values(INTENT)) {
    const n = h.editor.dispatched.length;
    await h.dispatch({ type, value: false, resultId: 'r0', groupId: null, page: 0 });
    assert.equal(h.editor.dispatched.length === n + 1, FAULT_ALLOWED.includes(type), `${type} (${FAULT_POLICY[type]})`);
  }
  assert.equal(loads(h).length, 2, 'no load and no compensation is reachable from the fault');
});

test('re-review M1 guard: every INTENT is mapped to a control in FAULT_CONTROLS or declared in NON_USER_FACING — exactly once', () => {
  const mapped = Object.keys(FAULT_CONTROLS);
  const declared = Object.keys(NON_USER_FACING);
  assert.deepEqual([...mapped, ...declared].sort(), Object.values(INTENT).sort(), 'a new INTENT fails until it is mapped or declared');
  assert.equal(new Set([...mapped, ...declared]).size, mapped.length + declared.length, 'no intent is both mapped and declared');
  for (const [type, c] of Object.entries(FAULT_CONTROLS)) {
    assert.ok(typeof c.gate === 'function' && c.dom.length > 0, type);
    if (c.variant) assert.ok(typeof c.variant.gate === 'function' && c.variant.dom.length > 0, `${type} variant`);
  }
});

test('re-review M1 (VM): the fault overlay disables with the fault reason EXACTLY the user-facing controls FAULT_POLICY blocks; allowed ones are unchanged', () => {
  const blocked = Object.keys(FAULT_CONTROLS).filter((t) => FAULT_POLICY[t] !== 'allow');
  assert.deepEqual(blocked.sort(), [INTENT.SETUP_NAME, INTENT.SETUP_MODE, INTENT.SETUP_CLEARANCE, INTENT.SETUP_BASIS, INTENT.SETUP_TOGGLE_MODEL,
    INTENT.SETUP_USE_SELECTION, INTENT.SETUP_SELF_CLASH, INTENT.SETUP_NEW_TEST, INTENT.RUN_START, INTENT.RUN_RELEASE_AND_RETRY,
    INTENT.NAV_SELECT, INTENT.NAV_PREV, INTENT.NAV_NEXT, INTENT.ACTION_FOCUS, INTENT.ACTION_ISOLATE, INTENT.ACTION_MARKERS,
    INTENT.ACTION_BACK_TO_ALL].sort(), 'the 17 user-facing blocked intents (19 blocked − TEST_LOAD − TEST_LABEL_SCOPE)');
  for (const { name, vm: ed, controls } of faultCases()) {
    const before = JSON.stringify(ed);
    const locked = lockedEditorVm(ed, MANAGER_TEXT.FAULT, FAULT_POLICY);
    for (const [type, c] of Object.entries(controls)) {
      if (FAULT_POLICY[type] === 'allow') {
        assert.deepEqual(c.gate(locked), c.gate(ed), `${name} ${type}: allowed — the overlay leaves its control unchanged`);
      } else {
        assert.notEqual(c.gate(ed)?.enabled, false, `${name} ${type}: enabled in the fixture before the fault (non-vacuous)`);
        assert.equal(c.gate(locked)?.enabled, false, `${name} ${type}: blocked — disabled while faulted`);
        assert.equal(c.gate(locked).reason, MANAGER_TEXT.FAULT, `${name} ${type}: exposes the terminal-fault reason`);
      }
    }
    assert.equal(JSON.stringify(ed), before, `${name}: the editor ViewModel is never written (copy/overlay only)`);
  }
});

test('re-review M1 (wiring): no overlay unless faulted — the editor ViewModel itself; while faulted exactly lockedEditorVm(editor VM, FAULT, FAULT_POLICY)', async () => {
  const clean = makeManagerHarness();
  assert.equal(clean.manager.getViewModel().editor, clean.editor.getViewModel(), 'not faulted: identity, no copy, no change');
  const h = await faulted();
  const own = h.editor.getViewModel();
  const snapshot = JSON.stringify(own);
  const composite = h.manager.getViewModel().editor;
  assert.notEqual(composite, own);
  assert.deepEqual(composite, lockedEditorVm(own, MANAGER_TEXT.FAULT, FAULT_POLICY));
  assert.equal(h.editor.getViewModel(), own, 'the overlay makes the editor publish nothing');
  assert.equal(JSON.stringify(own), snapshot, 'and never writes the editor\'s ViewModel');
});

test('AC-M16: a Create whose activation fails or diverges leaves no record; the counter is never decremented', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 1, releaseStuck: false, reason: 'run-active' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  h.editor.scriptLoad(() => ok('rogue'));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().count, 1);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().tests.at(-1).name, 'Clash test 4');
});

test('manager actions are disabled while a compensation is in flight', async () => {
  const h = makeManagerHarness();
  let release;
  h.editor.scriptLoad(() => ok('rogue'));
  h.editor.scriptLoad((intent, editor) => new Promise((resolve) => { release = () => resolve(defaultLoad(intent, editor)); }));
  const done = h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  assert.deepEqual(h.vm().create, { enabled: false, reason: MANAGER_TEXT.BUSY });
  release();
  await done;
  assert.deepEqual(h.vm().create, { enabled: true, reason: null });
});

test('Review Focus 4: a late same-target notification between the load result and the commit is not a divergence', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => { const r = defaultLoad(intent, editor); queueMicrotask(() => editor.set({})); return r; });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 1);
  assert.equal(h.vm().activeTestId, 'new-1');
  assert.equal(h.vm().notice, null);
});

test('Review Focus 5: disposing during an in-flight activation never commits, notifies or throws', async () => {
  const h = makeManagerHarness();
  let finish;
  h.editor.scriptLoad((intent, editor) => new Promise((resolve) => { finish = () => resolve(defaultLoad(intent, editor)); }));
  const seen = [];
  h.manager.subscribe((vm) => seen.push(vm));
  const pending = h.dispatch({ type: MANAGER_INTENT.CREATE });
  h.manager.dispose();
  const n = seen.length;
  finish();
  await pending;
  assert.equal(seen.length, n);
  assert.equal(h.vm().count, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashpanel/core/testsManager.recovery.test.mjs`
Expected: FAIL at module link, before any test runs — the file imports `FAULT_POLICY`, which `testsManager.js` does not export until Step 3, so Node reports `SyntaxError: The requested module '../../../clashpanel/core/testsManager.js' does not provide an export named 'FAULT_POLICY'` and the file fails as a whole with that error (`ℹ fail 1`, no individual test reported). Only once that export exists do the recovery assertions fail as the subsequent red stage — e.g. notification-first asserts `2 !== 1` loads (no compensation yet); the fault test fails on `vm.fault === null`.

- [ ] **Step 3: Implement**

In `clashpanel/core/testsManager.js`:

1. After `const MANAGER_TYPES = …` add:

```js
// Work plan review M2 — the terminal-fault intent policy (spec §26.2a, §26.9, AC-M16; plan decision P-3). EVERY editor
// INTENT value is classified; dispatch forwards only 'allow' (an unclassified type is dropped — fail closed — and fails
// the classification test).
//   allow: cannot edit the setup, start a run or present/mutate the Viewer from the divergent editor — non-mutating
//          list navigation/filter/group/sort/page and view preferences, Stop, Clear results (+ confirmation / cancel),
//          hide (the existing bridge.clear() cleanup path) / show (freshness re-check), diagnostics.
//   block: setup edits, run/admission, every result action that presents or clears Viewer state (select/Prev/Next
//          present the clash; Focus/Isolate/Markers present; Back to All clears), and the manager-only seams.
const ALLOW = 'allow';
const BLOCK = 'block';
export const FAULT_POLICY = Object.freeze({
  [INTENT.SETUP_NAME]: BLOCK, [INTENT.SETUP_MODE]: BLOCK, [INTENT.SETUP_CLEARANCE]: BLOCK, [INTENT.SETUP_BASIS]: BLOCK,
  [INTENT.SETUP_TOGGLE_MODEL]: BLOCK, [INTENT.SETUP_USE_SELECTION]: BLOCK, [INTENT.SETUP_SELF_CLASH]: BLOCK,
  [INTENT.SETUP_NEW_TEST]: BLOCK, [INTENT.SETUP_TOGGLE_COLLAPSED]: ALLOW,
  [INTENT.RUN_START]: BLOCK, [INTENT.RUN_STOP]: ALLOW, [INTENT.RESULTS_CLEAR]: ALLOW, [INTENT.RESULTS_CLEAR_CONFIRMED]: ALLOW,
  [INTENT.RUN_RELEASE_AND_RETRY]: BLOCK,
  [INTENT.FILTER_TEXT]: ALLOW, [INTENT.FILTER_MODEL]: ALLOW, [INTENT.FILTER_MAX_GAP]: ALLOW, [INTENT.FILTER_UNVERIFIED]: ALLOW,
  [INTENT.FILTER_HAS_LOCATION]: ALLOW, [INTENT.FILTER_ELEMENT]: ALLOW, [INTENT.FILTER_CLEAR]: ALLOW,
  [INTENT.GROUP_MODE]: ALLOW, [INTENT.GROUP_TOGGLE]: ALLOW, [INTENT.SORT_SET]: ALLOW,
  [INTENT.NAV_SELECT]: BLOCK, [INTENT.NAV_PREV]: BLOCK, [INTENT.NAV_NEXT]: BLOCK, [INTENT.NAV_PAGE]: ALLOW,
  [INTENT.ACTION_FOCUS]: BLOCK, [INTENT.ACTION_ISOLATE]: BLOCK, [INTENT.ACTION_MARKERS]: BLOCK,
  [INTENT.ACTION_FOCUS_ON_SELECT]: ALLOW, [INTENT.ACTION_BACK_TO_ALL]: BLOCK,
  [INTENT.PANEL_HIDDEN]: ALLOW, [INTENT.PANEL_SHOWN]: ALLOW, [INTENT.DIAGNOSTICS_COPY]: ALLOW,
  [INTENT.TEST_LOAD]: BLOCK, [INTENT.CONFIRM_CANCEL]: ALLOW, [INTENT.TEST_LABEL_SCOPE]: BLOCK,
});
```

2. Replace `syncFrom` with:

```js
/**
 * Steps 1–2 of §26.2a. Expected ids: the committed activeTestId, plus the in-flight activation's target. Anything else
 * is a divergence (M1): sync is suspended and ONE recovery begins. While recovering or faulted nothing is ever synced.
 */
function syncFrom(m, vm) {
  if (m.fault !== null || m.recovery !== null) return;
  const t = vm?.test ?? null;
  const expected = t !== null && (t.testId === m.activeTestId || (m.activation !== null && t.testId === m.activation.targetTestId));
  const record = expected ? m.records.get(t.testId) : undefined;
  if (record === undefined) { beginRecovery(m, 'notification', { schedule: m.activation === null }); return; }
  let dirty = false;
  if (t.draft !== record.draft) { record.draft = t.draft; dirty = true; }
  if (reduceSummary(record, t.lastRun)) dirty = true;
  if (dirty) recordsChanged(m);
}
```

3. After `loadInto` add:

```js
/** M1: exactly one recovery token per divergence; repeated signals are coalesced into it. */
function beginRecovery(m, cause, { schedule }) {
  if (m.recovery !== null || m.fault !== null) return;
  m.recoverySeq += 1;
  const token = m.recoverySeq;
  m.recovery = { token, cause, state: 'scheduled' };
  if (schedule) void Promise.resolve().then(() => compensate(m, token));
}

/** One compensating load of the COMMITTED activeTestId's snapshotted draft; success resumes sync, failure is terminal. */
async function compensate(m, token) {
  if (m.disposed || m.recovery === null || m.recovery.token !== token || m.recovery.state !== 'scheduled') return;
  m.recovery = { ...m.recovery, state: 'loading' };
  changed(m);
  const record = m.records.get(m.activeTestId);
  const result = record === undefined ? null : await loadInto(m, record, false);
  if (m.disposed) return;
  const now = m.editor.getViewModel();
  m.editorVm = now;
  m.recovery = null;
  if (result?.ok === true && result.testId === m.activeTestId && now?.test?.testId === m.activeTestId) {
    m.notice = MANAGER_TEXT.restored(record.draft.name);
    syncFrom(m, now);
  } else {
    m.fault = { text: MANAGER_TEXT.FAULT };
    m.pending = null;
    // M2: drop any editor confirmation raised BEFORE the fault (it may be for Run), so RESULTS_CLEAR_CONFIRMED — allowed
    // while faulted — can only confirm a Clear results requested afterwards (RUN_START / SETUP_NEW_TEST are blocked).
    try { void Promise.resolve(m.editor.dispatch({ type: INTENT.CONFIRM_CANCEL })).catch(() => {}); } catch { /* the fault stands */ }
  }
  changed(m);
}
```

4. Replace `activate` with:

```js
/**
 * §26.2a activation (M1). Commit ONLY when no divergence was seen, the load is {ok} for exactly targetTestId and the
 * editor reports that id. A refusal for the still-held source is a plain failure. Anything else — including a
 * notification-first divergence detected while the load ran — is compensated ONCE here, after the load settled.
 * `m.activation` stays set until the result is evaluated, so a late same-target notification is never a divergence.
 */
async function activate(m, targetTestId, acknowledgeUnsaved) {
  snapshotOutgoing(m);
  if (m.recovery !== null || m.fault !== null) return { outcome: 'diverged' };
  const record = m.records.get(targetTestId);
  if (record === undefined || record.draft?.testId !== record.testId) return { outcome: 'failed', reason: 'unknown-test' };
  m.activation = { targetTestId };
  const result = await loadInto(m, record, acknowledgeUnsaved);
  const now = m.disposed ? null : m.editor.getViewModel();
  m.activation = null;
  if (m.disposed) return { outcome: 'failed', reason: 'disposed' };
  m.editorVm = now;
  const editorId = now?.test?.testId;
  const clean = m.recovery === null && m.fault === null;
  if (clean && result?.ok === true && result.testId === targetTestId && editorId === targetTestId) {
    m.activeTestId = targetTestId;
    syncFrom(m, now);
    return { outcome: 'committed', releaseStuck: result.releaseStuck === true };
  }
  if (clean && result?.ok === false && result.testId === m.activeTestId && editorId === m.activeTestId) {
    return { outcome: 'failed', reason: typeof result.reason === 'string' ? result.reason : 'refused' };
  }
  beginRecovery(m, 'result', { schedule: false });                 // no-op when a notification already began it
  await compensate(m, m.recovery?.token);
  return { outcome: 'diverged' };
}
```

5. In `dispatch`, directly before the `INTENT.SETUP_NEW_TEST` line, add:

```js
  if (m.fault !== null && FAULT_POLICY[intent.type] !== ALLOW) return Promise.resolve(undefined);   // §26.2a fault; M2 allow-list, fail closed
```

6. In `reevaluate`, inside the `if (m.editorVm.test.testId !== m.activeTestId) {` branch, before `changed(m);`, add `beginRecovery(m, 'confirm', { schedule: true });`.
7. Headless fault contract (§26.9/§26.10; Work plan re-review M1): import `lockedEditorVm` from `./managerViewModel.js` and, in `viewModelOf`, replace `m.vmCache = Object.freeze({ manager, editor: m.editorVm });` with:

```js
  // §26.9: while faulted every user-facing control FAULT_POLICY blocks is {enabled:false, reason}; otherwise the
  // editor's own ViewModel object, unchanged (the overlay is a copy, never applied to the editor).
  const editorVm = m.fault === null ? m.editorVm : lockedEditorVm(m.editorVm, m.fault.text, FAULT_POLICY);
  m.vmCache = Object.freeze({ manager, editor: editorVm });
```

- [ ] **Step 4: Run the manager suites**

Run: `node --test test/clashpanel/core/testsManager.recovery.test.mjs test/clashpanel/core/testsManager.pending.test.mjs test/clashpanel/core/testsManager.core.test.mjs`
Expected: PASS — `ℹ fail 0`.

- [ ] **Step 5: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add clashpanel/core/testsManager.js test/clashpanel/core/testsManager.recovery.test.mjs test/clashpanel/support/faultControls.mjs
git commit -m "feat(clashpanel): single-token divergence recovery and terminal manager fault (Work review M1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Integration with the real controller + static boundary guard

**Files:**
- Test: `test/clashpanel/core/testsManager.integration.test.mjs` (real `createPanelController` via `makeHarness`)
- Test: `test/clashpanel/core/testsManager.static.test.mjs`
- No production change expected. If a test fails because of a manager defect, fix it in `testsManager.js` (TDD); if it fails because the editor seam cannot satisfy §26 without changing existing behavior, **stop** and record the gate (Global Constraint 3).

**Interfaces:**
- Consumes: `makeHarness`, `makeSet`, `hardResults` (`controllerHarness.mjs`); `until` (`settle.mjs`); `createTestsManager`; `STATEMENTS`.
- Produces: executable evidence for AC-M2, M3, M4, M5, M6, M9, M10, M11, M12, M14, M15, M16 (stuck release), M17, M19 with the real editor.

- [ ] **Step 1: Write the integration tests**

```js
// test/clashpanel/core/testsManager.integration.test.mjs — spec §26 with the REAL editor controller and the scripted
// engine/catalog/bridge doubles (no Viewer, no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { until } from '../support/settle.mjs';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { STATEMENTS } from '../../../clashpanel/core/runReport.js';

const SAVED = { state: 'saved', timedOut: false, attempt: 1 };
const PENDING = { state: 'pending', timedOut: true, attempt: 1 };

function setup(opts) {
  const h = makeHarness(opts);
  let n = 0;
  const manager = createTestsManager({ editor: h.controller, engine: h.engine, catalog: h.catalog, bridge: h.bridge, scheduler: h.scheduler,
    mintId: () => { n += 1; return `new-${n}`; } });
  const m = {
    manager,
    vm: () => manager.getViewModel().manager,
    ed: () => h.controller.getViewModel(),
    row: (id) => manager.getViewModel().manager.tests.find((t) => t.testId === id),
    async do(intent) { const out = await manager.dispatch(intent); await h.settle(); return out; },
  };
  return { h, m };
}
async function selectAB(m) {
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
}
async function runToSeal(h, m, { n = 3, persistence = SAVED, status = 'completed', resultSet } = {}) {
  await m.do({ type: INTENT.RUN_START });
  const handle = h.engine.lastHandle;
  handle.finish({ status, resultSet: resultSet === undefined ? makeSet({ runId: handle.runId, results: hardResults(n) }) : resultSet, persistence });
  await h.settle();
  return handle;
}
const confirm = (m) => m.do({ type: MANAGER_INTENT.CONFIRM, operationId: m.vm().confirm.operationId });

test('AC-M2/M6/M14: k tests hold at most one set; edits and revision survive switches; an unchanged rerun reuses the revision', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await m.do({ type: INTENT.SETUP_NAME, value: 'X walls' });
  await runToSeal(h, m);
  assert.equal(h.engine.resident.size, 1);
  const xDraft = m.ed().test.draft;
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.notEqual(m.vm().activeTestId, X);
  assert.equal(h.engine.resident.size, 0, 'outgoing saved set released; non-active tests hold nothing');
  await selectAB(m);
  await runToSeal(h, m);
  assert.equal(h.engine.resident.size, 1);
  await m.do({ type: MANAGER_INTENT.OPEN, testId: X });
  assert.equal(h.engine.resident.size, 0);
  assert.equal(m.ed().test.draft, xDraft, 'X\'s exact draft (incl. revision/lastRun) is back');
  await runToSeal(h, m);
  const calls = h.engine.startCalls;
  assert.equal(calls.at(-1).definition.testId, X);
  assert.equal(calls.at(-1).definition.revision, calls[0].definition.revision, 'unchanged definition → same revision → same resultIds');
  await m.do({ type: INTENT.SETUP_NAME, value: 'X walls v2' });
  await runToSeal(h, m);
  assert.equal(calls.at(-1).definition.revision, calls[0].definition.revision + 1);
  assert.ok(h.engine.resident.size <= 1);
});

test('AC-M2: an unsaved set is released only after the single confirmation (§23.5 copy for New test)', async () => {
  const { h, m } = setup();
  await selectAB(m);
  await runToSeal(h, m, { persistence: PENDING });
  await m.do({ type: INTENT.SETUP_NEW_TEST });                     // manager-hosted: New test = Create
  assert.equal(m.vm().confirm.text, 'The current results are held in memory only. Starting a new test discards them — discard?');
  assert.equal(h.engine.resident.size, 1, 'nothing released before consent');
  await confirm(m);
  assert.equal(h.engine.resident.size, 0);
  assert.equal(m.vm().count, 2);
});

test('AC-M3: Create/Open/Delete-active/Reset-active refused while the run is non-terminal; Duplicate allowed', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await m.do({ type: MANAGER_INTENT.DUPLICATE, testId: X });
  await selectAB(m);
  await m.do({ type: INTENT.RUN_START });
  const vm = m.vm();
  const other = vm.tests.find((t) => !t.active).testId;
  assert.deepEqual(vm.create, { enabled: false, reason: 'Stop the running test first.' });
  assert.equal(m.row(X).actions.delete.enabled, false);
  assert.equal(m.row(X).actions.reset.enabled, false);
  assert.equal(m.row(other).actions.open.enabled, false);
  assert.equal(m.row(X).status.kind, 'running');
  await m.do({ type: MANAGER_INTENT.OPEN, testId: other });
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.equal(m.vm().activeTestId, X);
  await m.do({ type: MANAGER_INTENT.DUPLICATE, testId: X });
  assert.equal(m.vm().count, 3);
  assert.equal(h.engine.startCalls.length, 1);
});

test('AC-M4: after a switch, late derivation/freshness outcomes of the outgoing test change neither the editor nor the Viewer', async () => {
  const { h, m } = setup();
  h.engine.control.summarize.manual = true;
  h.engine.control.getFreshness.manual = true;
  await selectAB(m);
  await runToSeal(h, m);
  assert.ok(h.engine.control.summarize.pending.length >= 1 && h.engine.control.getFreshness.pending.length >= 1);
  const viewerCalls = h.bridge.calls.length;
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.bridge.calls.length, viewerCalls + 1);
  assert.equal(h.bridge.calls.at(-1).op, 'clear', 'the switch\'s single queued clear()');
  const after = m.ed();
  h.engine.control.summarize.resolveAll();
  h.engine.control.getFreshness.resolveAll();
  await h.settle();
  const late = m.ed();
  assert.equal(late.test.testId, after.test.testId);
  assert.equal(late.results.state, 'before-run');
  assert.equal(late.run.state, 'idle');
  assert.equal(h.bridge.presents.length, 0);
});

test('AC-M4: a late basis verdict for the outgoing participants is dropped (setupGen)', async () => {
  const { h, m } = setup();
  const resolvers = [];
  h.catalog.setBasis(() => new Promise((resolve) => { resolvers.push(resolve); }));
  await m.do({ type: INTENT.SETUP_MODE, value: 'soft' });
  await m.do({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await selectAB(m);
  const X = m.vm().activeTestId;
  assert.equal(resolvers.length, 1, 'X evaluation pending');
  await m.do({ type: MANAGER_INTENT.DUPLICATE, testId: X });
  const Y = m.vm().tests.at(-1).testId;
  await m.do({ type: MANAGER_INTENT.OPEN, testId: Y });
  assert.equal(resolvers.length, 2, 'Y forced its own evaluation');
  resolvers[0]({ state: 'verified', basisKey: 'late' });
  await h.settle();
  assert.equal(m.ed().setup.softChecking, true, 'the outgoing verdict did not commit to Y');
  resolvers[1]({ state: 'unverified', reason: 'differ' });
  await h.settle();
  assert.equal(m.ed().setup.softChecking, false);
  assert.equal(m.ed().setup.basis.required, true);
});

test('AC-M5: a non-active test shows its last status/count and "Results not held"; opening it shows the editor idle', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m, { n: 0 });
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.deepEqual(m.row(X).status, { kind: 'completed', text: 'Completed — 0 clashes reported' });
  assert.equal(m.row(X).resultsText, 'Results not held — open and re-run to view');
  assert.doesNotMatch(JSON.stringify(m.vm()), /no clashes/i);
  await m.do({ type: MANAGER_INTENT.OPEN, testId: X });
  const ed = m.ed();
  assert.equal(ed.run.state, 'idle');
  assert.equal(ed.results.state, 'before-run');
  assert.equal(ed.test.lastRun, null);
  assert.deepEqual(ed.setup.scope, { A: 'Architecture', B: 'Structure' });
});

test('AC-M9: Clear results keeps the summary; Reset returns to "Not run" keeping testId, draft and revision', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m);
  await m.do({ type: INTENT.RESULTS_CLEAR });
  assert.equal(m.row(X).status.text, 'Completed — 3 clashes reported');
  assert.equal(m.row(X).resultsText, 'Results not held — open and re-run to view');
  await m.do({ type: MANAGER_INTENT.RESET, testId: X });
  assert.deepEqual(m.row(X).status, { kind: 'not-run', text: 'Not run' });
  assert.equal(m.vm().activeTestId, X);
  await runToSeal(h, m);
  assert.equal(h.engine.startCalls.at(-1).definition.revision, h.engine.startCalls[0].definition.revision);
});

test('AC-M15: a seal followed in the next intents by Clear results and Create still leaves that run\'s summary', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await m.do({ type: INTENT.RUN_START });
  const handle = h.engine.lastHandle;
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(2) }), persistence: SAVED });
  await until(h.scheduler, () => m.ed().run.state === 'done');
  await Promise.all([m.manager.dispatch({ type: INTENT.RESULTS_CLEAR }), m.manager.dispatch({ type: MANAGER_INTENT.CREATE })]);
  await h.settle();
  assert.equal(m.row(X).status.text, 'Completed — 2 clashes reported');
  assert.equal(m.row(X).resultCount, 2);
  assert.equal(m.vm().count, 2);
});

test('AC-M15: a seal immediately followed by Reset deliberately empties the summary', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await m.do({ type: INTENT.RUN_START });
  h.engine.lastHandle.finish({ status: 'completed', resultSet: makeSet({ runId: h.engine.lastHandle.runId, results: hardResults(2) }), persistence: SAVED });
  await until(h.scheduler, () => m.ed().run.state === 'done');
  await m.do({ type: MANAGER_INTENT.RESET, testId: X });
  assert.deepEqual(m.row(X).status, { kind: 'not-run', text: 'Not run' });
});

test('AC-M16: a confirmed switch whose release is stuck commits, shows the release-error banner, keeps the retry list', async () => {
  const { h, m } = setup();
  await selectAB(m);
  await runToSeal(h, m, { persistence: PENDING });
  h.engine.setReleaseFailure(new Error('store down'));
  await m.do({ type: MANAGER_INTENT.CREATE });
  await confirm(m);
  assert.equal(m.vm().activeTestId, 'new-1');
  assert.ok(m.ed().run.banners.some((b) => b.id === 'release-error'));
  assert.equal(h.engine.resident.size, 1, 'the stuck set stays for the residency retry');
  h.engine.setReleaseFailure(null);
  m.manager.dispose();
  await h.controller.dispose();
  assert.equal(h.engine.resident.size, 0, 'retried by disposeAll');
});

test('AC-M17: planning-stage cancel and failure rows read the §7.3 headline, no count, no "Models changed"', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m, { status: 'cancelled', resultSet: null });
  assert.deepEqual(m.row(X).status, { kind: 'cancelled', text: 'Stopped before any results' });
  assert.equal(m.row(X).resultCount, null);
  assert.equal(m.row(X).resultsText, null);
  await runToSeal(h, m, { status: 'failed', resultSet: null });
  assert.deepEqual(m.row(X).status, { kind: 'failed', text: STATEMENTS.NO_RESULT_SET });
  h.catalog.removeModel('mB');
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).modelsChanged, false, 'models: [] never marks a row');
});

test('AC-M19: an inactive multi-model Soft test without a basis reads setup-complete; opening it blocks Run on the §23 rule', async () => {
  const { h, m } = setup({ basis: { state: 'unverified', reason: 'models differ' } });
  const X = m.vm().activeTestId;
  await m.do({ type: MANAGER_INTENT.CREATE });
  const Y = m.vm().activeTestId;
  await m.do({ type: INTENT.SETUP_MODE, value: 'soft' });
  await m.do({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await selectAB(m);
  await m.do({ type: MANAGER_INTENT.OPEN, testId: X });
  assert.equal(m.row(Y).readiness.state, 'setup-complete');
  assert.doesNotMatch(m.row(Y).readiness.text, /\bready\b/i);
  assert.equal(m.row(Y).modeText, 'Soft (clearance 0.05)');
  await m.do({ type: MANAGER_INTENT.OPEN, testId: Y });
  assert.equal(m.ed().setup.basis.required, true);
  assert.equal(m.ed().run.canRun, false);
  void h;
});

test('AC-M10 / Review Focus 3: readiness and "models changed" follow catalog and model-left events, with no freshness/claim/derivation read', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m);
  await m.do({ type: MANAGER_INTENT.CREATE });                     // X inactive with a summary; the editor is idle
  const reads = () => ['getFreshness', 'assessNoClashClaim', 'summarize', 'groupBy', 'filter'].map((k) => h.engine.control[k].calls);
  const before = reads();
  const rowsBefore = JSON.stringify(m.vm().tests);
  h.catalog.addModel({ modelKey: 'mC', displayName: 'MEP', model: { label: 'C' }, loaded: true });
  h.catalog.fire();
  await h.settle();
  assert.equal(JSON.stringify(m.vm().tests), rowsBefore, 'an unrelated new model changes no record');
  // Work plan review H1: the event ALONE — the catalog snapshot and the binding are deliberately left unchanged.
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  assert.ok(h.catalog.list().some((e) => e.modelKey === 'mB'), 'catalog still lists mB');
  assert.notEqual(h.engine.registry.bindingFor('mB'), null, 'binding still readable');
  assert.equal(m.row(X).readiness.state, 'models-missing');
  assert.equal(m.row(X).readiness.text, 'Structure is not loaded');
  assert.equal(m.row(X).modelsChanged, true);
  assert.equal(m.row(X).modelsChangedText, 'Models changed since this run');
  h.catalog.fire();                                                // a notification still listing mB reconciles nothing
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'models-missing');
  h.catalog.removeModel('mB');                                     // the authoritative removal follows
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'models-missing');
  assert.equal(m.row(X).modelsChanged, true);
  h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: h.modelB, loaded: true });   // showModel: same key + Model
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'setup-complete');
  assert.equal(m.row(X).modelsChanged, false);
  h.catalog.removeModel('mB');
  const reloaded = { label: 'B2' };
  h.catalog.addModel({ modelKey: 'mB2', displayName: 'Structure', model: reloaded, loaded: true });   // reload under a NEW key
  h.engine.setBinding('mB2', { modelKey: 'mB2', model: reloaded, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 });
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'models-missing', 'never re-bound by name/URN');
  assert.deepEqual(reads(), before, 'no freshness/claim/derivation read for any record');
});

test('AC-M11: Set A/B summaries disambiguate host names across every referenced key; "(not loaded)" once absent', async () => {
  const { h, m } = setup({ displayNames: { mA: 'Arch', mB: 'Arch' } });
  const X = m.vm().activeTestId;
  await selectAB(m);
  assert.equal(m.row(X).setA, 'Arch · …mA');
  assert.equal(m.row(X).setB, 'Arch · …mB');
  h.catalog.removeModel('mB');
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).setB, 'Arch · …mB (not loaded)', 'still disambiguated: the record keeps mB known (CTM-2)');
  assert.equal(m.ed().setup.scope.A, m.row(X).setA, 'G-A2: the active editor shows the identical label');
});

test('AC-M11 / CTM-2 / G-A2 seam (e): the same modelKey has the identical label in the list and the editor, incl. an unloaded same-host-name model referenced only by another test', async () => {
  const { h, m } = setup({ displayNames: { mA: 'Arch', mB: 'Arch' } });
  const X = m.vm().activeTestId;
  await selectAB(m);                                               // X references mA + mB
  await m.do({ type: MANAGER_INTENT.CREATE });
  const Y = m.vm().activeTestId;
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });   // Y references mA only
  h.catalog.removeModel('mB');                                     // mB unloaded; only record X still references it
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(Y).setA, 'Arch · …mA', 'list: mA is disambiguated against the referenced, unloaded mB');
  assert.equal(m.ed().setup.scope.A, m.row(Y).setA, 'editor Set A summary: the identical label (fails without seam (e))');
  assert.equal(m.ed().setup.models.find((e) => e.modelKey === 'mA').displayName, m.row(Y).setA, 'editor model list: identical');
  assert.equal(m.row(X).setB, 'Arch · …mB (not loaded)');
  // Invalidation: deleting X removes mB from the referenced scope; list and editor drop the suffix together.
  await m.do({ type: MANAGER_INTENT.DELETE, testId: X });
  await confirm(m);
  assert.equal(m.vm().count, 1);
  assert.equal(m.row(Y).setA, 'Arch');
  assert.equal(m.ed().setup.scope.A, 'Arch');
  // Invalidation: a referenced key re-added by an edit of the active draft re-disambiguates both views.
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
  assert.equal(m.row(Y).setA, 'Arch · …mA');
  assert.equal(m.ed().setup.scope.A, 'Arch · …mA');
});

test('AC-M12: manager dispose then editor dispose leaves no listener and holds nothing', async () => {
  const { h, m } = setup();
  await selectAB(m);
  await runToSeal(h, m);
  m.manager.dispose();
  assert.equal(h.catalog.listenerCount(), 1, 'only the editor\'s own listener remains');
  assert.equal(h.bridge.listenerCount(), 1);
  const out = await h.controller.dispose();
  assert.equal(out.released, true);
  assert.equal(h.catalog.listenerCount(), 0);
  assert.equal(h.bridge.listenerCount(), 0);
  assert.equal(h.engine.resident.size, 0);
});
```

- [ ] **Step 2: Write the static boundary guard**

```js
// test/clashpanel/core/testsManager.static.test.mjs — spec §26.2/§26.5/§26.6, AC-M10/AC-M12, Global Constraints 2/7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from '../support/layering.mjs';

const read = (f) => stripComments(readFileSync(new URL(`../../../clashpanel/core/${f}`, import.meta.url), 'utf8'));
const MANAGER_FILES = ['testsManager.js', 'managerViewModel.js', 'testReadiness.js', 'testDrafts.js', 'testSummary.js'];
const BANNED = ['startRun', 'releaseResultSet', 'retainResultSet', 'getPersistenceState', 'getFreshness', 'assessNoClashClaim',
  'derivations', 'validateTest', 'getPairStatus', 'getElementStatus', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'cookie'];

test('manager modules never call engine run/residency/derivation/status reads and never persist anything', () => {
  for (const f of MANAGER_FILES) for (const word of BANNED) assert.equal(read(f).includes(word), false, `${f} mentions ${word}`);
});

test('testsManager reads only port.registry and bridge.onModelLeft, and never touches the raw engine', () => {
  const src = read('testsManager.js');
  assert.deepEqual([...new Set([...src.matchAll(/\bport\s*\.\s*(\w+)/g)].map((x) => x[1]))], ['registry']);
  assert.deepEqual([...new Set([...src.matchAll(/\bbridge\s*\.\s*(\w+)/g)].map((x) => x[1]))], ['onModelLeft']);
  assert.equal(/\bengine\s*\.\s*\w+/.test(src), false);
});

test('Work plan review H1: the catalog is read only through list/onChange plus ONE keyOfModel identity read of the model-left event; no Model is kept', () => {
  const src = read('testsManager.js');
  assert.deepEqual([...new Set([...src.matchAll(/\bcatalog\s*\.\s*(\w+)/g)].map((x) => x[1]))].sort(), ['keyOfModel', 'list', 'onChange']);
  assert.equal(src.match(/\bkeyOfModel\b/g).length, 1, 'exactly one identity read');
  assert.match(src, /m\.catalog\.keyOfModel\(event\?\.model\)/, '…of the model-left event\'s model');
  assert.deepEqual(src.match(/\bevent\??\.model\b/g), ['event?.model'], 'the event\'s Model is used nowhere else (never stored)');
});

test('G-A2: the manager\'s own editor dispatches are exactly the four-seam intents plus the existing Clear path (seams (a), (c), (e); §26.7)', () => {
  const src = read('testsManager.js');
  const sent = [...src.matchAll(/editor\.dispatch\(\{\s*type:\s*INTENT\.(\w+)/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(sent)].sort(), ['CONFIRM_CANCEL', 'RESULTS_CLEAR', 'RESULTS_CLEAR_CONFIRMED', 'TEST_LABEL_SCOPE', 'TEST_LOAD']);
});
```

- [ ] **Step 3: Run them**

Run: `node --test test/clashpanel/core/testsManager.integration.test.mjs test/clashpanel/core/testsManager.static.test.mjs`
Expected: PASS — `ℹ fail 0`. Any failure is a manager defect (fix with a focused test first) or a seam contradiction (stop, record a gate).

- [ ] **Step 4: Offline gate and checkpoint**

Run: `npm run test:offline 2>&1 | tail -6` → `ℹ fail 0`.

```bash
git add test/clashpanel/core/testsManager.integration.test.mjs test/clashpanel/core/testsManager.static.test.mjs
git commit -m "test(clashpanel): Clash Tests manager integration with the real editor and boundary guard (spec §26.12)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Managed renderer (Tests list + header around the unchanged editor) and shell option

**Files:**
- Create: `clashpanel/ui/render/manager.js`
- Modify: `clashpanel/ui/ClashDockingPanel.js` (`import { renderManagedPanel } from './render/manager.js';`; `createPanelShell({ …, managed = false })` selects `renderManagedPanel` when `managed === true`)
- Modify: `test/clashpanel/scaffold.test.mjs` (add `'ui/render/manager.js'` after `'ui/render/panel.js'`)
- Create: `test/clashpanel/dom/support/managerFixtures.mjs`
- Test: `test/clashpanel/dom/manager.dom.mjs`

**Interfaces:**
- Consumes: composite VM `{manager: ManagerVM, editor: EditorVM}` (Tasks 6–7; `editor` fault-overlaid by `lockedEditorVm`, Tasks 6 and 9); `renderPanel` (`ui/render/panel.js`); `el`, `setText`, `rebuild`, `instanceNs` (`ui/dom.js`); `INTENT`, `MANAGER_INTENT` (`core/intents.js`). Tests only: `lockedEditorVm`, `MANAGER_TEXT` (Task 6), `FAULT_POLICY` (Task 9), `faultCases` (over `FAULT_CONTROLS`; `test/clashpanel/support/faultControls.mjs`, Task 9).
- Produces: `renderManagedPanel(root, vm, dispatch, doc)`. Root children in fixed order: `.clash-manager-header` (`div role=region`), `.clash-manager-list` (`div role=region`, hidden unless `view==='list'`), `.clash-manager-editor` (renderPanel host; hidden unless `view==='editor'`). Manager parts are never `<section>` (the editor keeps exactly five sections — existing composition assertion). Data-keys: `manager-view-list`, `manager-view-editor`, `manager-create`, `manager-{open|duplicate|reset|delete}-<rowIndex>`, `manager-confirm`, `manager-cancel`, `editor-confirm-cancel`. Exactly **one** live region in the managed Panel: the header's persistent `.clash-status` node relays manager announcements and the editor's `run.statusLive`; the editor's own status node is de-registered (`aria-live`/`role` removed) after each `renderPanel` (plan decision P-12). Fault locking (Work plan re-review M1) is a pure function of the core's overlay: when `manager.editorLock` is set, every editor control whose `vm.editor` gate (from `lockedEditorVm`, Task 6) is `{enabled:false, reason: editorLock.reason}` is locked — native `disabled` plus `aria-describedby` → the fault banner (`<ns>-manager-fault`, `role=alert`), whose text is the reason. A result row (`li role=option`, no native `disabled`) is locked by `lockRow` and made genuinely inert, manager-only (fault-state re-review M1): `data-fault-locked="true"`, `aria-disabled="true"`, `aria-describedby` → the fault banner, `tabindex` removed (out of the tab order; blurred if it held focus), a disabled look (`opacity:.4; cursor:default`, no hover highlight, no focus ring), and a capture-phase `click`/`keydown`/`keyup` guard on the editor host (`guardLockedRows`, installed once per host) that stops any such event targeted inside a locked row before the row's own `results.js` listeners run; controls whose intent `FAULT_POLICY` allows (incl. the setup collapse toggle, Stop, Clear, filters, page, Focus on select, Copy diagnostics) are never touched. Equivalence with `FAULT_POLICY` is pinned by the Task 11 DOM test over `FAULT_CONTROLS` (Task 9).

- [ ] **Step 1: Write the fixtures and failing DOM tests**

```js
// test/clashpanel/dom/support/managerFixtures.mjs — plain-JSON Clash Tests manager ViewModels for the DOM tests
// (browser-importable; no Node APIs). Shape: clashpanel/core/managerViewModel.js buildManagerViewModel.
import { panelVm } from './vmFixtures.mjs';

const ALLOW = { enabled: true, reason: null };

export function managerRow(i, over = {}) {
  return {
    testId: `T-${i}`, name: `Clash test ${i}`, active: i === 1, modeText: 'Hard', setA: 'Architecture', setB: 'Structure',
    status: { kind: 'not-run', text: 'Not run' }, resultCount: null, resultsText: null, setupChangedSinceRun: false,
    readiness: { state: 'setup-complete', text: 'Setup complete — readiness to run is checked when opened', models: [] },
    modelsChanged: false, modelsChangedText: null,
    actions: { open: ALLOW, duplicate: ALLOW, reset: { enabled: false, reason: 'This test has no results to reset.' }, delete: ALLOW },
    ...over,
  };
}

export function managerVm(over = {}) {
  const tests = over.tests ?? [managerRow(1), managerRow(2)];
  return {
    view: 'list', activeTestId: 'T-1', activeName: 'Clash test 1', count: tests.length, create: ALLOW,
    pending: null, confirm: null, notice: null, fault: null, editorLock: null, live: '', tests, ...over,
  };
}

export function managedVm(manager = {}, editor = {}) {
  return { manager: managerVm(manager), editor: panelVm(editor) };
}
```

```js
// test/clashpanel/dom/manager.dom.mjs — spec §26.8–§26.10: the managed renderer in real Chromium over fake ViewModels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { managedVm, managerRow } from './support/managerFixtures.mjs';
import { HOSTILE, runVm, panelVm } from './support/vmFixtures.mjs';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { lockedEditorVm, MANAGER_TEXT } from '../../../clashpanel/core/managerViewModel.js';
import { FAULT_POLICY } from '../../../clashpanel/core/testsManager.js';
import { faultCases } from '../support/faultControls.mjs';

const R = ['/clashpanel/ui/render/manager.js', 'renderManagedPanel'];

test('list view: one row per test, row header = name, active row by text and aria-current; the editor keeps five hidden sections', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'list' }));
  const r = await page.evaluate(() => {
    const root = document.getElementById('clash-root');
    return {
      rows: [...root.querySelectorAll('.clash-manager-table tbody tr')].map((tr) => [tr.querySelector('th[scope="row"]').textContent, tr.getAttribute('aria-current')]),
      caption: root.querySelector('.clash-manager-table caption').textContent,
      sections: [...root.querySelectorAll('section')].map((s) => s.dataset.region),
      editorHidden: root.querySelector('.clash-manager-editor').hidden,
      listHidden: root.querySelector('.clash-manager-list').hidden,
      toggle: root.querySelector('[data-key="manager-view-editor"]').textContent,
    };
  });
  assert.deepEqual(r.rows, [['Clash test 1 (active)', 'true'], ['Clash test 2', null]]);
  assert.equal(r.caption, 'Clash tests (this session only)');
  assert.deepEqual(r.sections, ['setup', 'run', 'filters', 'results', 'selected']);
  assert.equal(r.editorHidden, true);
  assert.equal(r.listHidden, false);
  assert.equal(r.toggle, 'Back to test');
}));

test('row actions dispatch manager intents with the testId; a disabled action exposes its visible reason via aria-describedby', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'list' }));
  for (const key of ['manager-open-1', 'manager-duplicate-0', 'manager-delete-1', 'manager-create']) await page.click(`[data-key="${key}"]`);
  assert.deepEqual(await intents(page), [
    { type: 'manager/open', testId: 'T-2' }, { type: 'manager/duplicate', testId: 'T-1' },
    { type: 'manager/delete', testId: 'T-2' }, { type: 'manager/create' },
  ]);
  const reset = await page.evaluate(() => {
    const b = document.querySelector('[data-key="manager-reset-0"]');
    return { disabled: b.disabled, label: b.getAttribute('aria-label'), reason: document.getElementById(b.getAttribute('aria-describedby'))?.textContent };
  });
  assert.deepEqual(reset, { disabled: true, label: 'Reset results “Clash test 1”', reason: 'This test has no results to reset.' });
}));

test('the confirmation is an in-panel banner: focus moves to it once; Confirm/Cancel carry the operationId', () => withPage(async ({ page }) => {
  const confirm = { operationId: 'op-3', text: 'Delete “Clash test 2”? Its setup and results are discarded for this session and can\'t be recovered.', confirmLabel: 'Delete test', cancelLabel: 'Cancel', enabled: true };
  await mountRenderer(page, ...R, managedVm({ view: 'list', confirm, pending: { operationId: 'op-3', kind: 'delete', sourceTestId: 'T-2', targetTestId: null } }));
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-banner-id')), 'manager-confirm');
  await page.click('[data-key="manager-cancel"]');
  await page.click('[data-key="manager-confirm"]');
  assert.deepEqual(await intents(page), [{ type: 'manager/cancel', operationId: 'op-3' }, { type: 'manager/confirm', operationId: 'op-3' }]);
}));

test('ONE live region: manager announcements and the editor status are relayed by a single persistent header node (§23.6/§26.10)', () => withPage(async ({ page }) => {
  const created = 'Created “Clash test 2”.';
  await mountRenderer(page, ...R, managedVm({ view: 'editor', live: created }));
  const state = () => page.evaluate(() => {
    const root = document.getElementById('clash-root');
    const node = root.querySelector('.clash-manager-header > .clash-status');
    return { regions: root.querySelectorAll('[aria-live]').length, same: node === window.__liveNode, text: node.textContent, hidden: node.closest('[hidden]') !== null };
  });
  await page.evaluate(() => { window.__liveNode = document.querySelector('.clash-manager-header > .clash-status'); });
  assert.deepEqual(await state(), { regions: 1, same: true, text: created, hidden: false });
  assert.equal(await page.evaluate(() => document.querySelector('[data-key="manager-view-list"]').textContent), 'All tests (2)');
  await rerender(page, managedVm({ view: 'editor', live: created }, { run: runVm({ statusLive: 'Running' }) }));
  assert.deepEqual(await state(), { regions: 1, same: true, text: 'Running', hidden: false }, 'the editor status is relayed');
  await rerender(page, managedVm({ view: 'list', live: 'Opened “Clash test 1”.' }, { run: runVm({ statusLive: 'Running' }) }));
  assert.deepEqual(await state(), { regions: 1, same: true, text: 'Opened “Clash test 1”.', hidden: false }, 'still announced in list view');
  await rerender(page, managedVm({ view: 'editor', live: 'Opened “Clash test 1”.' }, { run: runVm({ statusLive: 'Running' }) }));
  await page.click('[data-key="manager-view-list"]');
  assert.deepEqual(await intents(page), [{ type: 'manager/viewList' }]);
}));

test('a pending editor confirmation can be cancelled from the manager header (CONFIRM_CANCEL)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'editor' }, { test: { pendingConfirm: true } }));
  await page.click('[data-key="editor-confirm-cancel"]');
  assert.deepEqual(await intents(page), [{ type: 'confirm/cancel' }]);
}));

test('manager fault: alert banner; setup controls (not the collapse toggle) and Run disabled and described by it; Clear results stays enabled', () => withPage(async ({ page }) => {
  const fault = { text: 'The tests list lost track of the test editor.' };
  const editor = lockedEditorVm(panelVm({ run: runVm({ state: 'done', doneKind: 'completed', canRun: true }) }), fault.text, FAULT_POLICY);
  await mountRenderer(page, ...R, managedVm({ view: 'editor', fault, editorLock: { enabled: false, reason: fault.text } }, editor));
  const r = await page.evaluate(() => {
    const banner = document.querySelector('[data-banner-id="manager-fault"]');
    const setup = [...document.querySelectorAll('section[data-region="setup"] button, section[data-region="setup"] input, section[data-region="setup"] select')];
    const locked = setup.filter((n) => n.getAttribute('data-key') !== 'setup-toggle-collapsed');
    const toggle = document.querySelector('[data-key="setup-toggle-collapsed"]');
    const run = document.querySelector('[data-key="run-start"]');
    return {
      role: banner.getAttribute('role'), text: banner.textContent,
      setupAllDisabled: locked.length > 0 && locked.every((n) => n.disabled && n.getAttribute('aria-describedby') === banner.id),
      toggleEnabled: toggle.disabled === false && !toggle.hasAttribute('aria-describedby'),
      runDisabled: run.disabled && run.getAttribute('aria-describedby') === banner.id,
      clearEnabled: document.querySelector('[data-key="results-clear"]').disabled === false,
    };
  });
  assert.deepEqual(r, { role: 'alert', text: 'The tests list lost track of the test editor.', setupAllDisabled: true, toggleEnabled: true, runDisabled: true, clearEnabled: true });
}));

test('Review Focus 6 / re-review M1 (DOM): every user-facing control FAULT_POLICY blocks is disabled and described by the fault reason; allowed controls are untouched', () => withPage(async ({ page }) => {
  const reason = MANAGER_TEXT.FAULT;
  const read = (selectors) => page.evaluate((map) => {
    const root = document.getElementById('clash-root');
    const state = (n) => {
      const by = n.getAttribute('aria-describedby');
      return { disabled: n.disabled === true, ariaDisabled: n.getAttribute('aria-disabled'), describedBy: by, reason: by ? document.getElementById(by)?.textContent ?? null : null };
    };
    const out = {};
    for (const [type, list] of Object.entries(map)) out[type] = list.flatMap((sel) => [...root.querySelectorAll(sel)]).map(state);
    return { out, bannerId: root.querySelector('[data-banner-id="manager-fault"]')?.id ?? null };
  }, selectors);
  for (const { name, vm: ed, controls } of faultCases()) {
    const selectors = Object.fromEntries(Object.entries(controls).map(([type, c]) => [type, c.dom]));
    await mountRenderer(page, ...R, managedVm({ view: 'editor' }, ed));
    const before = await read(selectors);
    await rerender(page, managedVm({ view: 'editor', fault: { text: reason }, editorLock: { enabled: false, reason } }, lockedEditorVm(ed, reason, FAULT_POLICY)));
    const after = await read(selectors);
    assert.equal(before.bannerId, null);
    assert.ok(typeof after.bannerId === 'string' && after.bannerId.endsWith('-manager-fault'));
    for (const [type, nodes] of Object.entries(after.out)) {
      assert.ok(nodes.length > 0 && nodes.length === before.out[type].length, `${name} ${type}: its control(s) are rendered by the fixture`);
      if (FAULT_POLICY[type] === 'allow') {
        assert.deepEqual(nodes, before.out[type], `${name} ${type}: allowed — not disabled or re-described by the fault`);
        continue;
      }
      assert.ok(before.out[type].every((n) => !n.disabled && n.ariaDisabled !== 'true'), `${name} ${type}: enabled before the fault (non-vacuous)`);
      for (const n of nodes) {
        assert.ok(n.disabled || n.ariaDisabled === 'true', `${name} ${type}: disabled while faulted`);
        assert.equal(n.describedBy, after.bannerId, `${name} ${type}: described by the fault banner`);
        assert.equal(n.reason, reason, `${name} ${type}: exposes the terminal-fault reason`);
      }
    }
  }
}));

test('fault-state re-review M1 (DOM): a faulted result row leaves the tab order, looks disabled, and click/Enter/Space emit no intent — the same inputs dispatch NAV_SELECT when not faulted', () => withPage(async ({ page }) => {
  const reason = MANAGER_TEXT.FAULT;
  const ed = faultCases()[0].vm;   // main fixture: grouped page, rows r0 and r1 (selected), both in group g1
  const ROW = '.clash-manager-editor [data-key="-|r0"]';
  const SELECT = { type: INTENT.NAV_SELECT, resultId: 'r0', groupId: 'g1' };
  const clean = () => managedVm({ view: 'editor' }, ed);
  const faulted = () => managedVm({ view: 'editor', fault: { text: reason }, editorLock: { enabled: false, reason } }, lockedEditorVm(ed, reason, FAULT_POLICY));
  // ONE input path for both states: synthetic click on the row and on a child (bubbling, like a pointer click on its
  // text), synthetic Enter and Space keydown on the row (the events results.js resultRow listens to), then real
  // Playwright input — a forced pointer click (force: Playwright treats aria-disabled as not actionable) and
  // focus + Enter/Space keys.
  const fire = async () => {
    await page.evaluate((sel) => {
      const row = document.querySelector(sel);
      const opts = { bubbles: true, cancelable: true, composed: true };
      row.dispatchEvent(new MouseEvent('click', opts));
      row.querySelector('.clash-label').dispatchEvent(new MouseEvent('click', opts));
      row.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: 'Enter' }));
      row.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: ' ' }));
    }, ROW);
    await page.click(ROW, { force: true });
    await page.focus(ROW);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
  };
  const rowState = () => page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const by = row.getAttribute('aria-describedby');
    const cs = getComputedStyle(row);
    return {
      tabindex: row.getAttribute('tabindex'), ariaDisabled: row.getAttribute('aria-disabled'), locked: row.getAttribute('data-fault-locked'),
      describedBy: by, reason: by ? document.getElementById(by)?.textContent ?? null : null,
      cursor: cs.cursor, opacity: cs.opacity, background: cs.backgroundColor,
    };
  }, ROW);
  const focusedRow = () => page.evaluate(() => document.activeElement?.classList.contains('clash-row') === true);
  // Real Tab sweep from the header's view toggle through the whole editor host; returns the result rows it lands on.
  const rowTabStops = async () => {
    await page.focus('[data-key="manager-view-list"]');
    const stops = [];
    for (let i = 0; i < 200; i += 1) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => {
        const a = document.activeElement;
        return { inEditor: a?.closest('.clash-manager-editor') != null, row: a?.classList.contains('clash-row') === true, key: a?.getAttribute('data-key') ?? null };
      });
      if (!s.inEditor) { if (stops.length > 0) break; continue; }
      stops.push(s);
    }
    return stops.filter((s) => s.row).map((s) => s.key);
  };
  // Stand-in for the host's main.css row hover (the harness loads no host stylesheet), so "no hover highlight" is observable.
  await page.addStyleTag({ content: '.clash-panel-root .clash-row:hover{background-color:rgb(1, 2, 3)}' });

  // Not faulted (non-vacuous): both rows are tab stops, hover highlights, and every input dispatches NAV_SELECT.
  await mountRenderer(page, ...R, clean());
  assert.deepEqual(await rowTabStops(), ['-|r0', '-|r1'], 'not faulted: the rows are tab stops');
  await page.hover(ROW);
  assert.deepEqual(await rowState(), {
    tabindex: '0', ariaDisabled: null, locked: null, describedBy: null, reason: null, cursor: 'auto', opacity: '1', background: 'rgb(1, 2, 3)',
  });
  await fire();
  assert.deepEqual(await intents(page), Array(7).fill(SELECT), 'not faulted: 2 clicks + Enter + Space (synthetic) + click + Enter + Space (real) each select');
  assert.equal(await focusedRow(), true, 'not faulted: the row took focus');

  // Faulted (rendered twice: the lock is idempotent): rebuild() restores focus to the row, lockRow removes it again.
  await rerender(page, faulted());
  assert.equal(await focusedRow(), false, 'faulted: focus does not stay on a locked row');
  await rerender(page, faulted());
  const bannerId = await page.evaluate(() => document.querySelector('[data-banner-id="manager-fault"]').id);
  await page.mouse.move(0, 0);
  await page.hover(ROW);
  assert.deepEqual(await rowState(), {
    tabindex: null, ariaDisabled: 'true', locked: 'true', describedBy: bannerId, reason, cursor: 'default', opacity: '0.4', background: 'rgba(0, 0, 0, 0)',
  });
  await fire();
  assert.equal((await intents(page)).length, 7, 'faulted: no click, Enter or Space — synthetic or real — reaches the row handler');
  assert.equal(await focusedRow(), false, 'faulted: focus() cannot land on the row');
  assert.deepEqual(await rowTabStops(), [], 'faulted: Tab never lands on a result row');

  // Un-faulted render: rows are rebuilt unlocked and interactive again.
  await rerender(page, clean());
  assert.deepEqual(await rowState().then(({ tabindex, ariaDisabled, locked, describedBy }) => ({ tabindex, ariaDisabled, locked, describedBy })),
    { tabindex: '0', ariaDisabled: null, locked: null, describedBy: null });
  await fire();
  assert.equal((await intents(page)).length, 14, 'un-faulted: the same inputs select again');
}));

test('Review Focus 2: hostile and unbroken names stay inert text and never widen the panel', () => withPage(async ({ page }) => {
  const long = 'W'.repeat(10000);
  await page.setViewportSize({ width: 480, height: 800 });
  await mountRenderer(page, ...R, managedVm({ view: 'list', activeName: HOSTILE, tests: [managerRow(1, { name: HOSTILE, setA: HOSTILE }), managerRow(2, { name: long })] }));
  const r = await page.evaluate(() => {
    const root = document.getElementById('clash-root');
    return { pwned: window.__pwned ?? null, imgs: root.querySelectorAll('img').length, overflow: root.scrollWidth <= root.clientWidth + 1,
      name: root.querySelector('tbody tr th .clash-manager-name').textContent };
  });
  assert.deepEqual(r, { pwned: null, imgs: 0, overflow: true, name: '<img src=x onerror=window.__pwned=1>' });
}));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 test/clashpanel/dom/manager.dom.mjs`
Expected: FAIL — `TypeError: /clashpanel/ui/render/manager.js has no export renderManagedPanel` (module not served / missing).

- [ ] **Step 3: Implement the renderer**

```js
// clashpanel/ui/render/manager.js — spec §26.8–§26.10: the Clash Tests manager views around the UNCHANGED editor.
// Root children, fixed order: [0] header (active test, view switch, notice / fault / confirmation banners, one
// persistent live node), [1] Tests list (a semantic table), [2] editor host rendered by renderPanel. Manager parts are
// <div role="region">, never <section>, so the editor keeps exactly its five regions. Text only via textContent (AC-P13);
// state is never conveyed by colour alone (§26.10). Thin: renders the ViewModel, dispatches intents, holds no state.
import { el, setText, rebuild, instanceNs } from '../dom.js';
import { INTENT, MANAGER_INTENT } from '../../core/intents.js';
import { renderPanel } from './panel.js';

export const MANAGER_STYLE_ID = 'clash-manager-style';
const MANAGER_CSS = [
  '.clash-manager-table{width:100%;table-layout:fixed;border-collapse:collapse}',
  '.clash-manager-table th,.clash-manager-table td{text-align:left;vertical-align:top;padding:2px 4px;overflow-wrap:anywhere;word-break:break-word}',
  '.clash-manager-actions button{margin:0 4px 4px 0}',
  '.clash-manager-reason{display:block;font-size:smaller}',
  '.clash-manager-table tr[aria-current="true"] th{font-weight:bold}',
  // A fault-locked result row (lockRow below): the host's native disabled-control look (wwwroot/main.css
  // `.clash-panel-root button:disabled` = opacity .4, cursor default), no hover highlight (main.css
  // `.clash-panel-root .clash-row:hover` is (0,3,0); these selectors are (0,4,0)/(0,5,0)) and no focus ring.
  '.clash-manager-editor .clash-row[data-fault-locked="true"]{opacity:.4;cursor:default}',
  '.clash-manager-editor .clash-row[data-fault-locked="true"]:not(.clash-row-selected):hover{background:transparent}',
  '.clash-manager-editor .clash-row[data-fault-locked="true"]:focus-visible{outline:none}',
].join('\n');

const ACTIONS = Object.freeze([
  Object.freeze({ id: 'open', label: 'Open', intent: MANAGER_INTENT.OPEN }),
  Object.freeze({ id: 'duplicate', label: 'Duplicate', intent: MANAGER_INTENT.DUPLICATE }),
  Object.freeze({ id: 'reset', label: 'Reset results', intent: MANAGER_INTENT.RESET }),
  Object.freeze({ id: 'delete', label: 'Delete test', intent: MANAGER_INTENT.DELETE }),
]);

function ensureStyle(doc) {
  if (doc.getElementById(MANAGER_STYLE_ID)) return;
  (doc.head ?? doc.documentElement).appendChild(el(doc, 'style', { attrs: { id: MANAGER_STYLE_ID }, text: MANAGER_CSS }));
}

function ensurePart(root, doc, cls, index, attrs) {
  let part = null;
  for (const child of root.children) if (child.classList.contains(cls)) { part = child; break; }
  if (!part) part = el(doc, 'div', { class: cls, attrs });
  if (root.children[index] !== part) root.insertBefore(part, root.children[index] ?? null);
  return part;
}

/**
 * ONE live region for the whole managed Panel (§23.6/§26.10; Codex plan review I2; plan decision P-12). The header
 * node is never hidden (the editor host is, in list view), so it relays whichever announcement changed last: a
 * manager announcement (vm.manager.live) or the editor's status (vm.editor.run.statusLive).
 */
function announce(header, live, vm) {
  const managerLive = vm.manager.live ?? '';
  const editorLive = vm.editor?.run?.statusLive ?? '';
  let text = live.textContent;
  if (managerLive !== '' && managerLive !== (header.getAttribute('data-live-manager') ?? '')) text = managerLive;
  else if (editorLive !== (header.getAttribute('data-live-editor') ?? '')) text = editorLive;
  header.setAttribute('data-live-manager', managerLive);
  header.setAttribute('data-live-editor', editorLive);
  if (live.textContent !== text) setText(live, text);
}

/** The editor's own status node (run.js) stays for layout but is no longer a live region: the header relays it. */
function silenceEditorLive(host) {
  for (const node of host.querySelectorAll('.clash-status')) {
    node.removeAttribute('aria-live');
    node.removeAttribute('role');
    node.setAttribute('aria-hidden', 'true');
  }
}

function confirmBanner(doc, confirm, dispatch) {
  return el(doc, 'div', {
    class: 'clash-banner clash-banner-warning',
    attrs: { 'data-banner-id': 'manager-confirm', role: 'alertdialog', 'aria-label': 'Confirm test action', tabindex: '-1' },
  }, [
    el(doc, 'p', { class: 'clash-banner-text', text: confirm.text }),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'manager-confirm', disabled: confirm.enabled === false }, text: confirm.confirmLabel,
      on: { click: () => dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: confirm.operationId }) },
    }),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'manager-cancel' }, text: confirm.cancelLabel,
      on: { click: () => dispatch({ type: MANAGER_INTENT.CANCEL, operationId: confirm.operationId }) },
    }),
  ]);
}

function renderHeader(header, vm, dispatch, doc, ns) {
  const m = vm.manager;
  let body = header.querySelector(':scope > .clash-manager-header-body');
  let live = header.querySelector(':scope > .clash-status');
  if (!body) { body = el(doc, 'div', { class: 'clash-manager-header-body' }); header.appendChild(body); }
  if (!live) { live = el(doc, 'div', { class: 'clash-status', attrs: { role: 'status', 'aria-live': 'polite' } }); header.appendChild(live); }
  announce(header, live, vm);
  rebuild(body, doc, () => {
    body.appendChild(el(doc, 'p', { class: 'clash-manager-active', text: `Test: ${m.activeName}` }));
    body.appendChild(m.view === 'list'
      ? el(doc, 'button', { attrs: { type: 'button', 'data-key': 'manager-view-editor' }, text: 'Back to test', on: { click: () => dispatch({ type: MANAGER_INTENT.VIEW_EDITOR }) } })
      : el(doc, 'button', { attrs: { type: 'button', 'data-key': 'manager-view-list' }, text: `All tests (${m.count})`, on: { click: () => dispatch({ type: MANAGER_INTENT.VIEW_LIST }) } }));
    if (m.fault) {
      body.appendChild(el(doc, 'div', { class: 'clash-banner clash-banner-error', attrs: { id: `${ns}-manager-fault`, role: 'alert', 'data-banner-id': 'manager-fault' } },
        [el(doc, 'p', { class: 'clash-banner-text', text: m.fault.text })]));
    }
    if (m.notice) body.appendChild(el(doc, 'p', { class: 'clash-manager-notice', text: m.notice }));
    if (vm.editor?.test?.pendingConfirm === true) {
      body.appendChild(el(doc, 'p', { class: 'clash-manager-editor-confirm' }, [
        el(doc, 'span', { text: 'A confirmation is waiting in the test editor. ' }),
        el(doc, 'button', { attrs: { type: 'button', 'data-key': 'editor-confirm-cancel' }, text: 'Cancel it', on: { click: () => dispatch({ type: INTENT.CONFIRM_CANCEL }) } }),
      ]));
    }
    if (m.confirm) body.appendChild(confirmBanner(doc, m.confirm, dispatch));
  });
  // Focus moves to a NEW confirmation (§26.10); re-rendering the same one never steals focus again.
  const op = m.confirm?.operationId ?? '';
  const banner = body.querySelector('[data-banner-id="manager-confirm"]');
  if (banner && header.getAttribute('data-confirm-op') !== op) banner.focus();
  header.setAttribute('data-confirm-op', op);
}

function actionCell(doc, t, i, dispatch, ns) {
  return el(doc, 'td', { class: 'clash-manager-actions' }, ACTIONS.flatMap((a) => {
    const gate = t.actions[a.id];
    const reasonId = `${ns}-manager-${i}-${a.id}-reason`;
    return [
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': `manager-${a.id}-${i}`, 'aria-label': `${a.label} “${t.name}”`, disabled: !gate.enabled, 'aria-describedby': gate.enabled ? null : reasonId },
        text: a.label, on: { click: () => dispatch({ type: a.intent, testId: t.testId }) },
      }),
      gate.enabled ? null : el(doc, 'span', { class: 'clash-manager-reason', attrs: { id: reasonId }, text: gate.reason }),
    ];
  }));
}

function row(doc, t, i, dispatch, ns) {
  const status = [t.status.text, t.resultsText, t.setupChangedSinceRun ? 'Setup changed since this run' : null, t.modelsChangedText]
    .filter((s) => typeof s === 'string' && s.length > 0).join(' · ');
  return el(doc, 'tr', { attrs: { 'data-test-id': t.testId, 'aria-current': t.active ? 'true' : null } }, [
    el(doc, 'th', { attrs: { scope: 'row' } }, [
      el(doc, 'span', { class: 'clash-manager-name', text: t.name }),
      t.active ? el(doc, 'span', { class: 'clash-manager-active-mark', text: ' (active)' }) : null,
    ]),
    el(doc, 'td', { text: t.modeText }),
    el(doc, 'td', { text: t.setA }),
    el(doc, 'td', { text: t.setB }),
    el(doc, 'td', { class: 'clash-manager-status', text: status }),
    el(doc, 'td', { class: 'clash-manager-readiness', text: t.readiness?.text ?? '' }),
    actionCell(doc, t, i, dispatch, ns),
  ]);
}

function renderList(list, m, dispatch, doc, ns) {
  rebuild(list, doc, () => {
    const reasonId = `${ns}-manager-create-reason`;
    list.appendChild(el(doc, 'div', { class: 'clash-manager-create' }, [
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'manager-create', disabled: !m.create.enabled, 'aria-describedby': m.create.enabled ? null : reasonId },
        text: 'New test', on: { click: () => dispatch({ type: MANAGER_INTENT.CREATE }) },
      }),
      m.create.enabled ? null : el(doc, 'span', { class: 'clash-manager-reason', attrs: { id: reasonId }, text: m.create.reason }),
    ]));
    list.appendChild(el(doc, 'table', { class: 'clash-manager-table' }, [
      el(doc, 'caption', { text: 'Clash tests (this session only)' }),
      el(doc, 'thead', {}, [el(doc, 'tr', {}, ['Test', 'Mode', 'Set A', 'Set B', 'Status', 'Readiness', 'Actions'].map((h) => el(doc, 'th', { attrs: { scope: 'col' }, text: h })))]),
      el(doc, 'tbody', {}, m.tests.map((t, i) => row(doc, t, i, dispatch, ns))),
    ]));
  });
}

// Terminal manager fault (§26.2a, §26.9, §26.10; Work plan re-review M1). The DOM lock is a pure function of the core's
// fault overlay (lockedEditorVm, Task 6): a control is locked exactly when its vm.editor gate is {enabled:false} with
// the lock's reason, so the Panel never shows enabled a control whose intent FAULT_POLICY drops, and never locks an
// allow-listed one (the setup collapse toggle included). Locked = native `disabled` plus aria-describedby → the fault
// banner, whose text IS the reason; a node without native `disabled` (a result row, li role=option) is locked by
// lockRow and made inert by guardLockedRows (fault-state re-review M1).
const SETUP_LOCKED = 'section[data-region="setup"] :is(button, input, select, textarea):not([data-key="setup-toggle-collapsed"]):not([data-key="setup-new-test"])';
const FAULT_LOCKS = Object.freeze([
  Object.freeze({ gate: (e) => e?.setup?.locked, selector: SETUP_LOCKED }),
  Object.freeze({ gate: (e) => e?.setup?.newTest, selector: '[data-key="setup-new-test"]' }),
  Object.freeze({ gate: (e) => e?.run?.locked, selector: '[data-key="run-start"]' }),
  Object.freeze({ gate: (e) => e?.results?.select, selector: 'section[data-region="results"] .clash-row' }),
  Object.freeze({ gate: (e) => e?.results?.nav?.locked, selector: '[data-key="nav-prev"], [data-key="nav-next"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.focus, selector: '[data-key="action-focus"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.isolate, selector: '[data-key="action-isolate"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.markers, selector: '[data-key="action-markers"]' }),
  Object.freeze({ gate: (e) => e?.selected?.actions?.backToAll, selector: '[data-key="action-back-to-all"]' }),
]);

// A result row (results.js resultRow: li role=option, tabindex="0", its own click and Enter/Space keydown listeners
// dispatching NAV_SELECT) has no native `disabled`, so the manager makes it inert itself, without touching the editor
// renderer (AC-M13): FAULT_ROW_ATTR marker (CSS + guard key), aria-disabled, aria-describedby → the fault banner,
// tabindex removed (out of the tab order and not focusable; results.js uses a plain tabindex="0" on every row, no
// roving tabindex), and blurred if rebuild() just restored focus to it. Idempotent (plain attribute sets/removes).
// Reversal needs no code: results.js rebuilds every row from the ViewModel on each render (`rebuild`, results.js:128),
// so an un-faulted render yields fresh unlocked rows — pinned by the result-row DOM test.
const FAULT_ROW_ATTR = 'data-fault-locked';
const ROW_GUARD_EVENTS = Object.freeze(['click', 'keydown', 'keyup']);
const guardedHosts = new WeakSet();

function lockRow(n, faultId) {
  n.setAttribute(FAULT_ROW_ATTR, 'true');
  n.setAttribute('aria-disabled', 'true');
  n.setAttribute('aria-describedby', faultId);
  n.removeAttribute('tabindex');
  if (n.ownerDocument.activeElement === n) n.blur();
}

/**
 * Capture-phase guard on the editor host, installed once per host. DOM dispatch invokes capture listeners on the
 * target's ancestors BEFORE any listener on the target itself or any bubbling listener; results.js registers the row's
 * click/keydown handlers as ordinary (non-capture) listeners on the row `li` (dom.js el() → addEventListener(event,
 * handler)), and the editor host is a strict ancestor of every row (renderPanel(editorHost, …)). Stopping propagation
 * here therefore means no row handler runs for any click/keydown/keyup whose target is in a locked row (keyup is not
 * used by results.js today; it is guarded fail-closed). Events outside locked rows pass untouched.
 */
function guardLockedRows(host) {
  if (guardedHosts.has(host)) return;
  guardedHosts.add(host);
  const block = (e) => {
    const t = e.target;
    if (typeof t?.closest !== 'function' || t.closest(`[${FAULT_ROW_ATTR}="true"]`) === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const type of ROW_GUARD_EVENTS) host.addEventListener(type, block, { capture: true });
}

function lockEditor(host, vm, ns) {
  const reason = vm.manager.editorLock?.reason;
  if (typeof reason !== 'string') return;
  const faultId = `${ns}-manager-fault`;
  const byFault = (g) => g?.enabled === false && g.reason === reason;
  const lock = (n) => {
    if (!('disabled' in n)) { lockRow(n, faultId); return; }
    n.disabled = true;
    n.setAttribute('aria-describedby', faultId);
  };
  for (const { gate, selector } of FAULT_LOCKS) {
    if (byFault(gate(vm.editor))) for (const n of host.querySelectorAll(selector)) lock(n);
  }
  // Banner actions name their intent as data (run.js `banner-<id>-action`); the overlay already applied the policy.
  for (const b of vm.editor?.run?.banners ?? []) {
    if (!byFault(b?.action)) continue;
    const key = `banner-${b.id}-action`;
    for (const n of host.querySelectorAll('[data-key]')) if (n.getAttribute('data-key') === key) lock(n);
  }
}

export function renderManagedPanel(root, vm, dispatch, doc) {
  ensureStyle(doc);
  if (!root.classList.contains('clash-panel-root')) root.classList.add('clash-panel-root');
  const ns = instanceNs(root);
  const header = ensurePart(root, doc, 'clash-manager-header', 0, { role: 'region', 'aria-label': 'Clash test' });
  const list = ensurePart(root, doc, 'clash-manager-list', 1, { role: 'region', 'aria-label': 'All clash tests' });
  const editorHost = ensurePart(root, doc, 'clash-manager-editor', 2, {});
  guardLockedRows(editorHost);
  const m = vm.manager;
  renderHeader(header, vm, dispatch, doc, ns);
  list.hidden = m.view !== 'list';
  editorHost.hidden = m.view !== 'editor';
  if (m.view === 'list') renderList(list, m, dispatch, doc, ns);
  else rebuild(list, doc, () => {});
  renderPanel(editorHost, vm.editor, dispatch, doc);
  silenceEditorLive(editorHost);
  lockEditor(editorHost, vm, ns);
}
```

In `clashpanel/ui/ClashDockingPanel.js`: add `import { renderManagedPanel } from './render/manager.js';`; change the signature to `export function createPanelShell({ Autodesk, parentContainer, controller, id, title, doc, managed = false } = {})`; replace `const render = (vm) => { if (!disposed && body !== null) renderPanel(body, vm, dispatch, document_); };` with:

```js
  // §26.8: a manager-hosted Panel renders {manager, editor}; the standalone editor renders its own ViewModel.
  const renderBody = managed === true ? renderManagedPanel : renderPanel;
  const render = (vm) => { if (!disposed && body !== null) renderBody(body, vm, dispatch, document_); };
```

Add `'ui/render/manager.js',` to the scaffold list after `'ui/render/panel.js',`.

- [ ] **Step 4: Run the DOM tests and the layering/scaffold guards**

Run: `node --test --test-concurrency=1 test/clashpanel/dom/manager.dom.mjs test/clashpanel/dom/shell.dom.mjs && node --test test/clashpanel/scaffold.test.mjs test/clashpanel/layering.test.mjs`
Expected: PASS — `ℹ fail 0` (shell tests unchanged: default `managed:false`).

- [ ] **Step 5: Full gate and checkpoint**

Run: `npm test 2>&1 | tail -12`
Expected: offline `ℹ fail 0`; DOM `ℹ fail 0` (106 + 9 new).

```bash
git add clashpanel/ui/render/manager.js clashpanel/ui/ClashDockingPanel.js test/clashpanel/dom/support/managerFixtures.mjs test/clashpanel/dom/manager.dom.mjs test/clashpanel/scaffold.test.mjs
git commit -m "feat(clashpanel): Tests list and manager header around the unchanged editor (spec §26.8–§26.10)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Composition — the normal Panel hosts the manager; end-to-end fake-port test; README

**Files:**
- Modify: `clashpanel/index.js`
- Modify: `clashpanel/README.md` (new short section "Clash Tests manager (session-scoped, spec §26)")
- Test: `test/clashpanel/dom/managerComposition.dom.mjs`

**Interfaces:**
- Consumes: `createTestsManager`, `createDefaultScheduler` (core barrel); `createPanelShell({managed})`.
- Produces: `createClashPanel({…, testsManager = true})`. Returned object keys are **unchanged** (`controller, dispose, hide, isVisible, show, toggle` — pinned by `composition.dom.mjs`). With the manager hosted, `controller` is a frozen **facade** with ONE authoritative dispatch surface (Codex plan review C1; plan decision P-13): `getViewModel()` = `manager.getViewModel().editor` (the editor ViewModel, fault-locked when faulted), `subscribe(cb)` = manager subscription delivering that editor ViewModel, `dispatch(intent)` = `manager.dispatch(intent)` (so `SETUP_NEW_TEST` is Create, `TEST_LOAD` is dropped, fault/pending gates apply), `dispose()` = manager dispose then editor dispose. `testsManager:false` composes the standalone editor (in-place New test, §23.5) and returns the raw editor as before. Dispose order: shell → manager → controller → bridge. No host (`wwwroot/`) change is needed: `clashPanelHost.js` calls `createClashPanel` without the option and never uses `panel.controller`.

- [ ] **Step 1: Write the failing end-to-end tests**

```js
// test/clashpanel/dom/managerComposition.dom.mjs — createClashPanel hosts the Clash Tests manager (spec §26.8);
// real core + manager + ViewerBridge + UI over the in-page fake engine/catalog/viewer (inPageFakes.mjs). Event-driven waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage } from './support/harness.mjs';

const P = '#clash-detection-panel';

async function boot(page, options = {}) {
  await page.evaluate(async (opts) => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const world = fakes.createWorld();
    const panel = createClashPanel({ Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: world.engine, catalog: world.catalog, events: world.events, ...opts });
    window.__e2e = { world, panel, vmOf: () => panel.controller.getViewModel() };
    panel.show();
  }, options);
}
const waitVm = (page, predicate) => page.waitForFunction(`(${predicate})(window.__e2e.vmOf())`);

async function runFirstTest(page) {
  await page.click(`${P} [data-key="setup-A-mA"]`);
  await waitVm(page, (vm) => vm.setup.models.some((m) => m.modelKey === 'mA' && m.inA));
  await page.click(`${P} [data-key="setup-B-mB"]`);
  await waitVm(page, (vm) => vm.setup.validation.state === 'ready' && vm.run.canRun === true);
  await page.click(`${P} [data-key="run-start"]`);
  await page.waitForFunction(() => window.__e2e.world.engine.handles.length === 1);
  await page.evaluate(() => window.__e2e.world.engine.handles[0].finish());
  await waitVm(page, (vm) => vm.run.state === 'done' && vm.results.state === 'list');
}

test('E2E manager: New test keeps test 1 in the list with its last run; switching back shows test 1 idle and clears the Viewer', () => withPage(async ({ page }) => {
  await boot(page);
  const r0 = await page.evaluate(() => ({ header: !!document.querySelector('#clash-detection-panel .clash-manager-header'), keys: Object.keys(window.__e2e.panel).sort() }));
  assert.deepEqual(r0, { header: true, keys: ['controller', 'dispose', 'hide', 'isVisible', 'show', 'toggle'] });
  await runFirstTest(page);
  const firstId = await page.evaluate(() => window.__e2e.vmOf().test.testId);
  await page.click(`${P} [data-key="setup-new-test"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 2' && vm.run.state === 'idle');
  await page.click(`${P} [data-key="manager-view-list"]`);
  await page.waitForFunction(() => document.querySelectorAll('#clash-detection-panel .clash-manager-table tbody tr').length === 2);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#clash-detection-panel .clash-manager-table tbody tr')]
    .map((tr) => ({ name: tr.querySelector('.clash-manager-name').textContent, status: tr.querySelector('.clash-manager-status').textContent, current: tr.getAttribute('aria-current') })));
  assert.equal(rows[0].name, 'Clash test 1');
  assert.match(rows[0].status, /^Completed — 3 clashes reported · Results not held — open and re-run to view/);
  assert.equal(rows[1].current, 'true');
  await page.click(`${P} [data-key="manager-open-0"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 1' && vm.run.state === 'idle' && vm.results.state === 'before-run');
  assert.equal(await page.evaluate(() => window.__e2e.vmOf().test.testId), firstId);
  assert.equal(await page.evaluate(() => window.__e2e.world.viewer.meshCount()), 0, 'no Panel-owned marker remains');
}));

test('E2E: panel.controller is the manager-routed facade — SETUP_NEW_TEST creates, TEST_LOAD is dropped (Codex plan review C1)', () => withPage(async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const { INTENT } = await import('/clashpanel/core/intents.js');
    const c = window.__e2e.panel.controller;
    const first = c.getViewModel().test;
    await c.dispatch({ type: INTENT.TEST_LOAD, testId: 'forged', draft: first.draft });
    const afterLoad = c.getViewModel().test.testId;
    await c.dispatch({ type: INTENT.SETUP_NEW_TEST });              // resolves after the Create operation settled
    return { firstId: first.testId, afterLoad, name: c.getViewModel().test.draft.name,
      allTests: document.querySelector('#clash-detection-panel [data-key="manager-view-list"]').textContent };
  });
  assert.equal(r.afterLoad, r.firstId, 'a forged TEST_LOAD through the public controller is dropped');
  assert.equal(r.name, 'Clash test 2');
  assert.equal(r.allTests, 'All tests (2)', 'Create kept test 1 in the list (no in-place reset, no divergence)');
}));

test('E2E standalone (testsManager:false): no manager UI and New test keeps the §23.5 in-place semantics', () => withPage(async ({ page }) => {
  await boot(page, { testsManager: false });
  await page.click(`${P} [data-key="setup-new-test"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 2');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#clash-detection-panel .clash-manager-header').length), 0);
}));

test('E2E: a hostile test name is inert in the list; dispose leaves no panel, manager UI or listener', () => withPage(async ({ page }) => {
  await boot(page);
  await page.fill(`${P} [data-key="setup-name"]`, '<img src=x onerror=window.__pwned=1>');
  await waitVm(page, (vm) => vm.test.draft.name.startsWith('<img'));
  await page.click(`${P} [data-key="manager-view-list"]`);
  const r = await page.evaluate(async () => {
    const name = document.querySelector('#clash-detection-panel .clash-manager-name').textContent;
    const pwned = window.__pwned ?? null;
    await window.__e2e.panel.dispose();
    return { name, pwned, panels: document.querySelectorAll('.docking-panel').length, headers: document.querySelectorAll('.clash-manager-header').length,
      catalogListeners: window.__e2e.world.catalog.listenerCount() };
  });
  assert.deepEqual(r, { name: '<img src=x onerror=window.__pwned=1>', pwned: null, panels: 0, headers: 0, catalogListeners: 0 });
}));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 test/clashpanel/dom/managerComposition.dom.mjs`
Expected: FAIL — first test: `header: false` (the Panel does not host the manager yet).

- [ ] **Step 3: Implement the composition**

In `clashpanel/index.js`:
1. `import { createPanelController, createTestsManager, createDefaultScheduler } from './core/index.js';`
2. Signature: `export function createClashPanel({ Autodesk, viewer, THREE, engine, catalog, scheduler, doc, events, id = DEFAULT_ID, title = DEFAULT_TITLE, testsManager = true } = {})`; doc comment gains: `testsManager (default true): host the session-scoped Clash Tests manager (spec §26) around the editor; false = the standalone editor (§23.5 in-place New test). The returned object is unchanged; \`controller\` is always the editor.`
3. Replace the controller construction block with:

```js
  const sched = scheduler ?? createDefaultScheduler();
  let controller;
  try {
    controller = createPanelController({ engine, catalog, bridge, scheduler: sched });
  } catch (error) {
    void Promise.resolve().then(() => bridge.dispose()).catch(() => {});
    throw error;
  }

  let manager = null;
  if (testsManager !== false) {
    try {
      // The manager sees only onModelLeft of the bridge (spec §26.2: it never presents or clears).
      manager = createTestsManager({ editor: controller, engine, catalog, bridge: { onModelLeft: (cb) => bridge.onModelLeft(cb) }, scheduler: sched });
    } catch (error) {
      void Promise.resolve().then(() => controller.dispose()).catch(() => {}).then(() => bridge.dispose()).catch(() => {});
      throw error;
    }
  }
```

4. Shell construction: `shell = createPanelShell({ Autodesk, parentContainer: viewer.container, controller: manager ?? controller, managed: manager !== null, id, title, doc });` and in its `catch` add `try { manager?.dispose(); } catch { /* rollback continues */ }` before the existing controller/bridge rollback.
5. In `disposeAll`, at the start of the `finally` block (before `controller.dispose()`), add:

```js
      try { manager?.dispose(); } catch (error) { errors.push(error); }   // §26.8: manager first, then the editor's dispose
```

6. Before the final `return Object.freeze({ … })`, add the public facade and return it as `controller`:

```js
  // ONE authoritative dispatch surface (Codex plan review C1): with the manager hosted, programmatic dispatches go
  // through it exactly like the UI's; readers keep receiving the editor ViewModel (fault-locked when faulted).
  const publicController = manager === null ? controller : Object.freeze({
    getViewModel: () => manager.getViewModel().editor,
    subscribe: (cb) => manager.subscribe((vm) => cb(vm.editor)),
    dispatch: (intent) => manager.dispatch(intent),
    dispose: () => { manager.dispose(); return controller.dispose(); },
  });
```

and change the returned `controller,` entry to `controller: publicController,`.

In `clashpanel/README.md` add a section:

```markdown
## Clash Tests manager (session-scoped, spec §26)

`createClashPanel` hosts a session-scoped Clash Tests manager by default (`testsManager: false` composes the
standalone editor). The manager lists several tests, creates/opens/duplicates/deletes/resets them and shows per-test
readiness and "models changed". It adds **no host port**: it reads `catalog.list/displayNameFor/onChange`,
`catalog.keyOfModel` (only to name a model-left event's model), `registry.bindingFor` and the bridge's model-left
events only. Only the active test holds results or touches the Viewer.
Nothing is persisted — every test is lost on reload or `dispose()`. Live headed SVF2 verification of switch/delete
teardown and of row readiness after unload/reload is gate CTM-7 (not performed).
```

- [ ] **Step 4: Run the composition and existing DOM suites**

Run: `node --test --test-concurrency=1 test/clashpanel/dom/managerComposition.dom.mjs test/clashpanel/dom/composition.dom.mjs test/clashpanel/dom/shell.dom.mjs && node --test test/clashPanel.host.test.mjs test/ClashPanelExtension.test.mjs`
Expected: PASS — `ℹ fail 0`; `composition.dom.mjs` passes **unchanged** (five sections, unchanged panel keys).

- [ ] **Step 5: Full gate and checkpoint**

Run: `npm test 2>&1 | tail -12` → offline `ℹ fail 0`, DOM `ℹ fail 0`.

```bash
git add clashpanel/index.js clashpanel/README.md test/clashpanel/dom/managerComposition.dom.mjs
git commit -m "feat(clashpanel): host the session-scoped Clash Tests manager in createClashPanel (spec §26.8)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Final gate, package final report, handoff — then STOP

**Files:**
- Create: `docs/research/2026-10-10-clash-tests-manager-final-report.md` (package final report, CLAUDE.md "Durable Package Completion Reports")
- Modify: `docs/handoffs/latest.md` (new LATEST entry; previous entry marked superseded)

**Interfaces:** none (verification and documentation only; no production change).

- [ ] **Step 1: Verify repository state and run every gate**

Run:
```bash
git status --short && git diff --check
npm test 2>&1 | tail -15
node --test test/clashpanel/specReconciliation.test.mjs test/clashpanel/core/testsManager.*.test.mjs test/clashpanel/core/controller.loadTest.test.mjs test/clashpanel/core/controller.testSnapshot.test.mjs 2>&1 | tail -6
git diff --stat -- clashtest collision wwwroot server.js routes package.json scripts
```
Expected: `git diff --check` empty; offline `ℹ fail 0` (total = Task 1 baseline + all new tests; 1 existing todo; Global Constraint 11 waiver only); DOM `ℹ fail 0` (106 + 13 new); focused manager suites `ℹ fail 0`; the protected-path `git diff --stat` prints nothing.

- [ ] **Step 2: Run the bounded internal review**

Run `codex-review code "clashpanel/core/testsManager.js" medium` as an explicit `run_in_background` Bash call (CLAUDE.md internal review loop; never the native advisor tool), read `.codex-worker/responses/<id>/response.md`, then `TaskStop` the backgrounded task. Remediate only confirmed blocking findings with a focused failing test first; re-review only changed areas. If the worker is not running, record that finding — do not fall back.

- [ ] **Step 3: Write the package final report**

`docs/research/2026-10-10-clash-tests-manager-final-report.md` must contain: repository/branch/HEAD/origin relation/tree state; authorized scope (owner authorization text + this plan + spec §26); files changed; delivered behavior per CTM/AC (link the coverage table below); run commands and exact test totals (offline and DOM, before/after); M1 and M2 closure evidence and the fault overlay = `FAULT_POLICY` equivalence evidence (Work plan re-review M1) (test names); the three disclosed surface-list updates (G-A1); plan decisions P-1…P-16 and the owner's decisions on G-A2/G-A3/G-PERF/G-PD as implemented; internal review summary and unresolved findings; deferred work (CTM-7, CTM-8, CTM-9, CTM-10); product defaults CTM-3…CTM-6 as implemented; protected boundaries confirmed unchanged (Step 1 `git diff --stat` output); commit/push state; exact next gate.

- [ ] **Step 4: Update the handoff and stop**

Add a new `## LATEST — …` entry at the top of `docs/handoffs/latest.md` (≤ 8 bullets: repo/HEAD/tree; package status "implementation complete, ready for independent Work review"; governing spec/plan; final report link; verification totals; deferred gates CTM-7/CTM-8; **next authorized action: none — awaiting independent Work review and owner decision**; must-not-begin list from §"Not authorized" below). Mark the previous LATEST entry `(superseded)`. Do not commit unless authorized. Report branch, HEAD and final `git status --short`.

---

## Gates and open items (classified per CLAUDE.md; none is guessed closed)

| ID | Item | Class | Status / who decides |
|---|---|---|---|
| G-AUTH | Implementation of this plan | authorization | **Not authorized.** The bounded independent Work re-review of the first remediation closed H1, H2/G-A2 and M1 and left one Medium (fault-state ViewModel/UI); next gate: a **targeted independent Work re-review of that correction only** (second remediation, 2026-10-10); implementation then still requires explicit owner authorization. |
| G-A1 | AC-M13 says existing editor suites pass "unchanged", while §26.2 (b)/§26.9 add `vm.test` and the manager must be exported from the core barrel. Three **surface-enumeration** lists must grow (`controller.setupRun.test.mjs:34`, `index.test.mjs:10`, `scaffold.test.mjs`); no behavioral assertion changes. | spec ambiguity → decided | **Accepted** (independent Work plan review; owner, 2026-10-10). The three list updates are the necessary test update; every behavioral editor suite still runs unchanged. |
| G-A2 | CTM-2 requires the label resolver's known keys to include every record's referenced keys (`controller.js:70`), while §26.2 (d) said "nothing else" beyond seams (a)–(c); without an editor change the list and the editor could label the same `modelKey` differently (Work plan review H2). | spec/plan decision → decided | **Resolved by the owner (2026-10-10): the bounded fourth additive seam (e)** `INTENT.TEST_LABEL_SCOPE {modelKeys}` (Task 4), fed by the manager's complete referenced-key scope (`labelScopeOf`/`pushLabelScope`, Task 7) and invalidated whenever records or their referenced keys change; identical list/editor labels pinned by Tasks 4, 7 and 10 and the Task 10 static guard. Label disagreement is **not** accepted as a spec deviation. The only spec text touched is the bounded §26.2 (d) record in Task 1 (line 838). |
| G-A3 | §26.10 says announcements use "the existing visually hidden live region (§23.6)". In list view the editor host (which contains that region) is hidden, so the plan keeps **one** live region by relaying both manager announcements and the editor's `statusLive` through a single persistent header node and de-registering the editor's node (P-12). | spec nuance → decided | **Accepted** (independent Work plan review; owner, 2026-10-10). The Task 11 single-region and relay DOM tests are kept. |
| G-PERF | The manager is default-on (§26.8) while its rebuild cost with many records × models is unmeasured (CTM-8). The plan mitigates (derived rows recomputed only on §26.6 triggers or record changes; definition keys memoized per frozen draft) but sets no record-count target. | verification/calibration gate + product decision → decided | **Owner (2026-10-10): the manager stays default-on**; CTM-8 is a **mandatory later calibration gate before any product/performance closeout**. No scalability claim and no record limit is made before that measurement. |
| G-PD | CTM-3 (Duplicate copies basis attestation), CTM-4 (switch confirms only for unsaved results), CTM-5 (deleting the last test creates a fresh one), CTM-6 (names not unique) | product decisions → decided | **Accepted by the owner (2026-10-10)** as the recorded defaults; implemented as recorded. |
| CTM-7 | Headed SVF2 validation of switch/delete teardown (markers removed, isolation restored / `skipped-external`) and row readiness after unload/hide/reload (**hide is visibility-only per owner decision F-1 Option B, 2026-10-11: a hide-only `MODEL_REMOVED` leaves readiness/"models changed" unchanged; only unload/unregister/new-key reload is unavailability** — spec §26.6/AC-M10), within the existing PG-1/G1 envelope | verification gate | **Not authorized; not part of this plan's tasks.** Requires separate owner authorization after implementation. |
| CTM-8 | Manager ViewModel rebuild cost with many records × models is unmeasured; no record-count limit is introduced (PD-14) | verification/calibration gate | **Mandatory later gate** (G-PERF) before product/performance closeout; not part of this plan's tasks; no timing assertion is added; not authorized. |
| CTM-9 | Saved sets retained by the engine's default store after release; no store deletion in the Panel | deferred / non-goal | Unchanged. |
| CTM-10 | Re-binding to reloaded models, persistence, run history, background runs, suites | deferred / non-goal | Unchanged. |
| CTM-11 | Pre-existing Soft / status-reader contradictions | reconciled by Task 1 (M2) | §23/§23.7 and §7.5/AC-P4 authoritative. |

## Plan-level decisions (implementation detail the spec leaves open; reversible at review)

| ID | Decision | Basis |
|---|---|---|
| P-1 | Load intent carries an explicit `testId` paired with `draft`; editor checks `isLoadableDraft(draft, testId)`; record existence is checked only by the manager. | Work review M1 item 1 |
| P-2 | A refused load's `testId` is the test the editor still holds; a manager-side activation is "failed" only if that equals the committed `activeTestId`, otherwise it is a divergence. | M1 determinism |
| P-3 | In the fault state only the explicit `FAULT_POLICY` allow-list reaches the editor (Task 9): non-mutating list navigation/filter/group/sort/page and view preferences, `RUN_STOP`, Clear results (+ confirmation, `CONFIRM_CANCEL`), `PANEL_HIDDEN`/`PANEL_SHOWN`, `DIAGNOSTICS_COPY`; plus the manager's list/editor view switch and disposal. Row selection, Prev/Next, Focus, Isolate, Markers and Back to All are **blocked** (they present or clear Viewer state from the divergent editor); every unclassified intent is blocked. Entering the fault cancels any pending editor confirmation once. The ViewModel/UI states the same policy (P-15): each blocked user-facing control is disabled with the fault reason, each allowed one stays interactive (Work plan re-review M1). | §26.2a lists Clear and hide/dispose; Work plan review M2; re-review M1 |
| P-4 | Create's confirmation reuses the §23.5 New-test copy and label verbatim (`DISCARD_TEXT.newTest`, "Discard unsaved results"). | §26.8 "its unsaved-results confirmation unchanged" |
| P-5 | Create mints the `testId` at request time; the record and the counter increment happen only on confirmed execution (a cancelled prompt consumes no `Clash test <N>`). | §26.4 counter semantics |
| P-6 | Readiness precedence `models-missing` > `models-loading` > `incomplete` > `setup-complete`; `incomplete` uses `buildDefinition(…, {verifiedBasis:true})` problems on Set A/B/clearance (an invalid clearance counts too). | §26.6 lists states without precedence |
| P-7 | The compensating load passes `acknowledgeUnsaved:false` (unsaved results of a divergent editor state are never discarded silently; refusal → fault). | M1 fail-safe |
| P-8 | Reset of the active test reuses `RESULTS_CLEAR` and, under the manager's consent, `RESULTS_CLEAR_CONFIRMED`; a record keeps `lastReducedRunId` so a reset run is never re-reduced. | §26.7 "existing clearResults path" |
| P-9 | Manager intents live in a separate `MANAGER_INTENT` vocabulary (in `core/intents.js` for UI layering), so the editor's "every INTENT handled" contract is untouched. | AC-M13, layering |
| P-10 | Row VM adds `modelsChangedText`; `confirm` adds `enabled` — all strings/enablement stay in core. | §26.9 "All strings are built in the headless core" |
| P-11 | `createClashPanel` hosts the manager by default (`testsManager:false` = standalone) and keeps its returned keys unchanged; the shell, not `index.js`, selects the renderer (layering allow-list). | §26.8, existing composition assertions |
| P-12 | One live region in the managed Panel: a persistent header node relays manager announcements and the editor's `statusLive`; the editor's own status node is de-registered after each render (G-A3). | §23.6/§26.10; Codex plan review I2 |
| P-13 | With the manager hosted, `panel.controller` is a facade whose `dispatch` routes through the manager and whose readers return the (fault-locked) editor ViewModel. | Codex plan review C1 |
| P-14 | An injected `mintId` result must be a non-empty string unused by any record; otherwise Create/Duplicate/Delete-last are refused with `MANAGER_TEXT.NO_ID` before any mutation (no retry). | Codex plan review I3 |
| P-15 | While faulted, the composite `editor` ViewModel is `lockedEditorVm(m.editorVm, m.fault.text, FAULT_POLICY)`: every user-facing control whose intent the policy blocks reports `{enabled:false, reason}` (setup `locked`/`newTest`/`useSelectionEnabled`, `run.canRun`/`run.locked`, blocked banner actions, `results.select`, `results.nav` `canPrev`/`canNext`/`locked`, `selected.actions.focus/isolate/markers/backToAll`), allowed controls are unchanged, and the input is never written; not faulted, the composite `editor` is the editor's own ViewModel object. `manager.editorLock` carries the reason; the Task 11 renderer locks exactly the gates the overlay set (native `disabled`, or for a result row `lockRow` + the capture-phase `guardLockedRows` — out of the tab order, visibly disabled, click/Enter/Space stopped before the row handler; `aria-describedby` → fault banner). The overlay lives only in the manager layer, so the editor and its tests are unchanged (AC-M13). Equivalence with `FAULT_POLICY` is pinned by `FAULT_CONTROLS` (Tasks 9, 11). | §26.9, §26.10; Codex plan review I1; Work plan re-review M1; fault-state re-review M1 |
| P-16 | Derived rows (names, readiness, models changed) are cached by `(catalogEpoch, recordsVersion)`; definition keys are memoized per frozen draft. | §26.6 triggers; Codex plan review Q1 |

## Not authorized / out of scope

Must not begin without explicit owner authorization:

- **Implementation of this plan** (all tasks), any commit or push.
- **CTM-7** headed/live SVF2 verification (a verification gate requiring separate authorization), and any other live/browser run beyond the offline and fake-port DOM suites.
- Persistence across reload; any cloud/server/local storage; run history; New/Existing/Resolved comparison; issue lifecycle; multi-level grouping; background runs of non-active tests; more than one running test; re-binding tests to reloaded models (CTM-10); suites.
- G2 / C6 / C8 / G3 work; reflected-fragment work; R20-1; unrelated Low remediation.
- Any change to `clashtest/**` (Core), `clashtest/viewer/**` (Adapter), `collision/**`, the `EnginePort`/`ports.js`, `wwwroot/**` host code, `server.js`, `routes/**`, `package.json`, `scripts/**`.
- Editing the upstream final report or the independent review; editing any spec text beyond Task 1's bounded lines.

**Next gate:** a **targeted independent Work re-review of the third remediation only** (the [fault-state re-review](../../reviews/2026-10-10-clash-tests-manager-fault-state-viewmodel-ui-remediation-independent-work-review.md)'s M1 result-row inertness — Task 11 `lockRow`/`guardLockedRows`/row CSS and its DOM test — and L1 Task 9 Step 2 wording, plus the plan/report text that records them) — not an unrestricted re-review. **Authorized next action:** none beyond that re-review — implementation, CTM-7 and CTM-8 remain not authorized; awaiting owner authorization after a clean re-review.

## Internal review (convergence tool, not an independent gate)

One bounded `codex-review spec` pass (medium; request `20261010-143624-83544-20110`) on the first complete draft: verdict "requires major revision", 3 Critical / 4 Important / 3 questions. Disposition (all remediated in this revision unless noted):

| Finding | Disposition |
|---|---|
| C1 `panel.controller` bypasses the manager | Fixed: facade with manager-routed dispatch (P-13); E2E test in Task 12. |
| C2 standalone New test keeps the previous `lastRun` | Fixed: `newTest()` clears `c.lastSealed` (Global Constraint 3 amended); test in Task 3. |
| C3 load invariant not deep-frozen/canonical | Fixed: `isLoadableDraft` requires frozen sorted-unique `modelKeys` and id lists; tests in Task 2. |
| I1 fault ViewModel still reports enabled Run | Fixed: `lockedEditorVm` overlay + `manager.editorLock` (P-15); tests in Tasks 6 and 9. |
| I2 two live regions | Fixed: single relayed live region (P-12); recorded as G-A3 for acknowledgment; DOM test in Task 11. |
| I3 minted-id collisions overwrite records | Fixed: `mintFresh` validation (P-14); tests in Tasks 7 and 8. |
| I4 EPERM waiver ambiguity | Fixed: Global Constraint 11 defines the single named-set waiver. |
| Q1 default-on cost | Mitigated (P-16, test in Task 7); default-on vs opt-in recorded as owner gate G-PERF; CTM-8 stays a calibration gate. |
| Q2 G-A2 acceptance | Recorded as an explicit owner decision (G-A2). |
| Q3 CTM-3…6 approval | Recorded: must be confirmed before Task 2 (G-PD). |

Per CLAUDE.md's review boundary the remediation was not sent for a further unrestricted review round; the next review is the independent Work review of this plan.

### Remediation of the independent Work plan review (2026-10-10)

The [Independent Work Review of this plan](../../reviews/2026-10-10-clash-tests-manager-implementation-plan-independent-work-review.md) (0C/2H/2M/0L) was remediated within its minimum corrections, with the owner's gate decisions (see "Gates and open items"):

| Finding | Remediation (plan location) |
|---|---|
| H1 model-left identity discarded | Task 7: `onModelLeft` resolves `event.model` via `catalog.keyOfModel`, keeps only the key in `m.departed` (while still listed); `derivedOf` treats it as absent at once; `onCatalogChange` reconciles only on observed removal. Tests: event-only (catalog + binding unchanged), removal, same-key re-entry in both orders. Task 10: AC-M10 test corrected (event alone first); static guard (one identity read, no Model kept). |
| H2 list/editor label scope (G-A2) | Owner chose seam (e): Task 4 `INTENT.TEST_LABEL_SCOPE`/`onTestLabelScope`/`c.labelScope`; Task 7 `labelScopeOf`/`pushLabelScope`; Task 10 identical-label integration test incl. unloaded same-host-name model and invalidation; Task 1 bounded §26.2 (d) record + guard. |
| M1 `isLoadableDraft` not total/exact | Task 2: exact field sets, prototypes, data properties, `lastRun.revision === revision`, `-0` and `elements` key order, try/catch totality; tests incl. hostile accessors/proxies. Task 4: refusal cases with zero mutation and no notification. |
| M2 fault allow-list | Task 9: exported `FAULT_POLICY` over all 39 `INTENT` values (20 allow / 19 block, unclassified ⇒ blocked), `CONFIRM_CANCEL` on fault entry; classification test and reach/drop test. P-3 updated. |

**Targeted internal review (one round, changed areas only):** `codex-advisor` medium, request `20261010-160813-62825-21876`. Verdict: H1, H2 and M2 pass (no Critical/High); one Medium blocker and one Low. Dispositions:

| Finding | Disposition |
|---|---|
| Medium (blocking): `isLoadableDraft` still accepted two forms `draft.js` cannot emit — a `-0` element id and `elements` keys out of `normalizeElements` order | Fixed in Task 2 (`!Object.is(id, -0)`; `canonicalKeyOrder` comparison) with one test per case. |
| Low: Task 10 AC-M10 title said "no engine read" though `registry.bindingFor` is read | Fixed: title now "no freshness/claim/derivation read". |
| Note: `createDraft` does not validate `testNumber`; the validator requires `testCounter ≥ 1` | Accepted as is: every controller/manager caller supplies a positive integer; the plan claims exactness only for drafts those callers produce. |

No second internal round was run (review boundary); the next gate is the bounded independent Work re-review.

### Remediation of the remediation re-review (2026-10-10, second remediation)

The bounded [Independent Work re-review](../../reviews/2026-10-10-clash-tests-manager-implementation-plan-remediation-independent-work-review.md) (0C/0H/1M/0L) closed H1, H2/G-A2 and M1; its one Medium (faulted Viewer controls visibly enabled while `FAULT_POLICY` drops their intents) is corrected, within the owner-authorized scope (documents only; `FAULT_POLICY` semantics unchanged):

| Finding | Remediation (plan location) |
|---|---|
| re-review M1 fault ViewModel/UI mismatch | Task 6: `lockedEditorVm(editorVm, reason, policy)` disables with the reason every policy-blocked user-facing control (setup edits/New test, Run, Release and retry banner action, `results.select`, Previous/Next, Focus, Isolate, Markers, Back to All) and carries allowed ones over unchanged; unit test. Task 9: `viewModelOf` passes `FAULT_POLICY`; new `test/clashpanel/support/faultControls.mjs` (`FAULT_CONTROLS` with `variant` alternative dispatch sites, `NON_USER_FACING`, `faultFixtureEditorVm`, `faultVariantEditorVm`, `faultCases`); tests: mapping guard over every `INTENT`, VM equivalence derived from `FAULT_POLICY`, wiring (identity when not faulted; never writes the editor VM). Task 11: VM-driven `lockEditor`/`FAULT_LOCKS` (native `disabled` or `aria-disabled` + `aria-describedby` → fault banner; the setup collapse toggle is no longer locked — it is allow-listed); DOM equivalence test over `FAULT_CONTROLS`; existing fault DOM test feeds the real overlay. P-3, P-15, Review Focus 6, coverage rows updated. |

**AC-M13 (existing editor suites unchanged):** the overlay is a copy built in `managerViewModel.js` and applied only by `testsManager.js` `viewModelOf` while `m.fault !== null`; the DOM lock runs only in `ui/render/manager.js` after `renderPanel`. `clashpanel/core/viewModel.js` (beyond Task 6's `export describeScope`), `controller.js`, and the editor renderers `setup.js`/`run.js`/`results.js`/`selected.js`/`panel.js` are not changed: they already render the existing gates the overlay sets (`run.canRun`, `setup.newTest`/`useSelectionEnabled`, `results.nav.canPrev/canNext`, `selected.actions.*.enabled/reason`) and ignore the added fields (`setup.locked`, `run.locked`, `results.select`, `results.nav.locked`, banner `action.enabled/reason`). The editor's own `getViewModel()` is never overlaid, so no existing editor assertion can observe it.

**Targeted internal review (one round, this correction only):** `codex-advisor` medium, request `20261010-164932-96311-15149`. Verdict: no Critical/High; one Medium blocker and one Low. Verified by the reviewer: every listed selector renders in the fixture and blocked controls start enabled; `FAULT_LOCKS` has no selector collision and never locks the collapse toggle; the allowed-gate comparisons hold under the overlay's reference carry-over; clean wiring identity holds (`m.editorVm = first`); counts 39 = 35 + 4, 19 = 17 + 2, DOM 106 + 8 / 106 + 12. Dispositions:

| Finding | Disposition |
|---|---|
| Medium (blocking): `FAULT_CONTROLS` omitted two alternative dispatch sites of allow-listed intents that cannot render with the main fixture — the admission-error banner's Clear results action (`RESULTS_CLEAR`) and the empty-filtered results' Clear filters button (`FILTER_CLEAR`, `results-clear-filters`) — so the equivalence proof was not exhaustive over rendered controls | Fixed (reviewer's option 1): entries may declare a `variant` `{gate, dom}`; `faultVariantEditorVm()` renders those alternatives; `faultCases()` makes the Task 9 VM test and the Task 11 DOM test check both cases; the guard also checks every `variant`. |
| Low: `lockedEditorVm(editorVm, reason, policy)` read as fully policy-driven although the fixed control families are locked unconditionally (only banner actions consult `policy`) | Fixed in wording (Task 6 Interfaces and doc comment): the fixed families are exactly `FAULT_POLICY`'s blocked user-facing intents, an equality pinned by the equivalence tests; only banner actions consult `policy`. |

No second internal round was run (review boundary); the next gate is the targeted independent Work re-review of this correction.

### Remediation of the fault-state re-review (2026-10-10, third remediation)

The targeted [fault-state re-review](../../reviews/2026-10-10-clash-tests-manager-fault-state-viewmodel-ui-remediation-independent-work-review.md) (0C/0H/1M/1L) confirmed `FAULT_POLICY`, the overlay, `FAULT_CONTROLS` and AC-M13; its two findings are corrected (documents only; owner-authorized):

| Finding | Remediation (plan location) |
|---|---|
| M1 faulted result row `aria-disabled` but still focusable/activatable, no disabled look, DOM test never activated it | Task 11 only: `lockRow` (`data-fault-locked`, `aria-disabled`, `aria-describedby` → fault banner, `tabindex` removed, blur if focused); `guardLockedRows` — capture-phase `click`/`keydown`/`keyup` listener on the persistent editor host that `stopImmediatePropagation`s events targeted inside a locked row (capture on an ancestor runs before the row's non-capture `results.js:24–28` listeners); row CSS (`opacity:.4; cursor:default`, as `main.css` disabled controls; no hover background; no focus ring); new DOM test "fault-state re-review M1 (DOM): a faulted result row …" (same synthetic + real inputs: 7 selects unfaulted, 0 faulted, 7 again after an un-faulted render; Tab sweep lands on both rows unfaulted and none faulted; computed cursor/opacity/hover; idempotent double faulted render). Interfaces, Review Focus 6, P-15, coverage (AC-M13, AC-M16, new row), DOM counts (Task 11: 106 + 9; Task 13: 106 + 13) updated. Verified against `clashpanel/ui/render/results.js` (row built by `resultRow`, plain `tabindex="0"` on every row, listeners via `dom.js` `el()` `addEventListener` without options, rows rebuilt each render by `rebuild`) — manager-only is possible; no editor renderer change. |
| L1 Task 9 Step 2 named assertion failures although the file first fails at module link | Step 2 now expects `SyntaxError: The requested module '../../../clashpanel/core/testsManager.js' does not provide an export named 'FAULT_POLICY'` first (form checked against Node v22.23.1 with a scratch import, not by running plan tests), the recovery assertion failures only after the export exists. |

**Targeted internal review (one round, this correction only):** `codex-advisor` medium, request `20261010-182334-77552-30027`. Verdict: 0 Critical / 0 High / 0 Medium / 1 Low, nothing blocking. Verified by the reviewer (from source, no tests run): the host capture listener precedes the row's `results.js` listeners for row and child-span targets; `lockRow` is reapplied after each rebuild; the DOM test is non-vacuous (7 / 7 / 14) and covers Tab sweep, child click, synthetic and forced real input, focus restore + blur, double faulted render and un-fault; CSS specificity beats `main.css`; counts 106 + 9 / 106 + 13; Step 2 error form; identifiers and records consistent. Disposition — Low (this line said "see the dispositions below" with none recorded): fixed by this record. No second round (review boundary); the next gate is the targeted independent Work re-review of this correction.

## Requirement → task coverage

| Requirement | Task(s) / test file |
|---|---|
| §26.1 scope (create, list, row fields, open/edit, duplicate, delete/reset, active state, readiness/models changed) | 6, 7, 8, 11 |
| §26.2 manager layer; one editor; no engine/bridge calls | 7, 10 (`testsManager.static.test.mjs`) |
| §26.2 (a) atomic load seam / CTM-1 | 2 (`isLoadableDraft`), 4 (`controller.loadTest.test.mjs`) |
| §26.2 (b) `vm.test` | 3 (`controller.testSnapshot.test.mjs`) |
| §26.2 (c) editor confirm cancel | 4, 8, 11 |
| §26.2 (d) nothing else / no port widening (+ owner-authorized seam (e), G-A2) | Global Constraints 2–3; 1 (bounded §26.2 (d) record); 4 (seam (e)); 10 (static guards: port/bridge/catalog reads, editor seam intents) |
| §26.2a sync (draft sync, summary reduction, second guard) | 7, 10 (AC-M14, AC-M15) |
| §26.2a pending operation, confirm/cancel/stale/re-check | 7, 8 |
| §26.2a activation commit rule, failure, divergence recovery, fault | 7, 9 |
| §26.2a stuck release policy | 4, 10 (AC-M16) |
| §26.3 residency (one set; switch retirement; refusal while running; non-active display) | 4, 6, 10 (AC-M2, M3, M5) |
| §26.4 record, summary, null set, identity, naming, Duplicate, Create | 2, 3, 7, 8 |
| §26.5 Viewer ownership / late outcomes | 10 (AC-M4); existing ViewerBridge token/queue tests; CTM-7 (gate) |
| §26.6 readiness, models changed, triggers (incl. event-only model-left, H1), reload, names | 5, 6, 7 (H1 event-only / removal / re-entry tests), 10 (AC-M10, M11) |
| §26.7 Delete / Reset / Clear | 8, 10 (AC-M9) |
| §26.8 placement, views, New test = Create, hide/show, dispose | 7, 11, 12 |
| §26.9 ViewModel shape (incl. the fault overlay: every blocked editor control `enabled:false` with the fault reason) | 6, 7, 9 |
| §26.10 accessibility and copy | 6 (copy), 11 (DOM a11y, live region, focus, reasons — incl. the fault reason on every locked editor control, Work plan re-review M1) |
| §26.11 testability | 7 (`fakeEditor.mjs`), 10 |
| AC-M1 | 7, 8 |
| AC-M2 | 8, 10 |
| AC-M3 | 6, 7, 10 |
| AC-M4 | 10 |
| AC-M5 | 6, 10 |
| AC-M6 | 10 |
| AC-M7 | 2, 7 |
| AC-M8 | 8 |
| AC-M9 | 8, 10 |
| AC-M10 | 5; 7 (`testsManager.core.test.mjs`: event-only with catalog and binding unchanged, removal, same-key re-entry in both orders — Work plan review H1); 10 (corrected AC-M10 integration test: event alone first, catalog untouched; static guard: one `keyOfModel` identity read, no Model kept) |
| AC-M11 | 4 (seam (e) unit test), 7 (scope push), 10 (identical list/editor label for the same `modelKey`, incl. an unloaded same-host-name model, and invalidation on Delete / draft edit — Work plan review H2), 11 (inert markup), 12 |
| AC-M12 | 7, 10, 12 |
| AC-M13 | 4 (standalone New test), 12 (standalone E2E), 13 (full suites; G-A1); the fault overlay/lock is manager-layer only (Tasks 6, 9, 11) — no editor module or editor test changes (P-15); the result-row lock (`lockRow`, `guardLockedRows`, row CSS) lives in `ui/render/manager.js` and leaves `results.js` unchanged (fault-state re-review M1) |
| AC-M14 | 10 |
| AC-M15 | 8, 10 |
| AC-M16 | 2, 4 (total, exact `isLoadableDraft`: extra fields, malformed revisions, hostile accessors/proxies → refusal with zero mutation and no notification — Work plan review M1); 7; 9 (single token, compensation, fault; explicit `FAULT_POLICY` allow-list with a classification test over every `INTENT` — Work plan review M2; fault overlay = policy: `FAULT_CONTROLS` guard, VM equivalence and wiring tests — Work plan re-review M1); 10; 11 (DOM equivalence over `FAULT_CONTROLS`: blocked controls disabled + fault reason, allowed controls untouched — re-review M1; result row genuinely inert: no tab stop, disabled look, click/Enter/Space emit no intent, with the same inputs selecting when not faulted and again after an un-faulted render — fault-state re-review M1) |
| AC-M17 | 3, 10 |
| AC-M18 | 8 |
| AC-M19 | 5, 10 |
| CTM-1 | 2, 3, 4 |
| CTM-2 | 4 (seam (e)), 7 (`labelScopeOf`/`pushLabelScope`; rows use the same key set), 10 (AC-M11 list = editor); G-A2 resolved |
| CTM-3 … CTM-6 | 2 (CTM-3), 7/8 (CTM-4, CTM-5), 7 (CTM-6: duplicate names allowed); G-PD accepted by the owner |
| CTM-7 | gate only (not authorized) |
| CTM-8 | mandatory later calibration gate before product/performance closeout (G-PERF); no limit, no timing test, no scalability claim |
| CTM-9, CTM-10 | non-goals (Not authorized list) |
| CTM-11 / Work review M2 | 1 |
| Work review M1 | 2, 4, 7, 9 (M1 table above) |
| Work plan review H1 / H2 / M1 / M2 (2026-10-10) | H1: 7, 10 · H2: 1, 4, 7, 10 · M1: 2, 4 · M2: 9 |
| Work plan re-review M1 (fault ViewModel/UI, 2026-10-10) | 6 (`lockedEditorVm`), 9 (`FAULT_CONTROLS`, VM equivalence, wiring), 11 (`lockEditor`/`FAULT_LOCKS`, DOM equivalence) |
| Fault-state re-review M1 (result-row inertness) and L1 (Task 9 Step 2 red stage), 2026-10-10 | 11 (`lockRow`, `guardLockedRows`, `FAULT_ROW_ATTR` row CSS, result-row DOM test); 9 (Step 2 expected failure) |

**Coverage gaps:** none known at the plan's abstraction level after the 2026-10-10 remediations (the remediation re-review's fault ViewModel/UI Medium is corrected above; subject to the targeted re-review). The earlier revision's claim of full coverage was overstated (the independent Work plan review found AC-M10's event-only case unexercised and the CTM-2 list/editor label scope unresolved); those rows are corrected above. This claim is subject to the bounded independent Work re-review. CTM-7 (live teardown/readiness evidence) and CTM-8 (calibration) are intentionally gates, not tasks.

## Self-review (run by the planning author)

1. **Spec coverage.** Every §26.1–26.13 item and AC-M1…M19 maps to a task above; CTM-7/8 are gates by spec classification.
2. **Placeholder scan.** No "TBD/TODO/implement later/similar to Task N"; every code step shows the code; every run step shows the command and the expected result.
3. **Type and name consistency.** `isLoadableDraft`, `duplicateDraft`, `duplicateName` (Task 2) → used in Tasks 4, 7. `sealSummary`/`summaryStatusText` (Task 3) → controller (3), managerViewModel (6). `LoadResult` shape (Task 4) ↔ `activate`/`compensate` (Tasks 7, 9) and `defaultLoad` (fake). `readinessOf`/`modelsChangedOf` (Task 5) ↔ `viewModelOf` (Task 7). GateState fields (`fault, busy, pending, editorVm, activeTestId, records`) are produced by `gateState()` (Task 7) and consumed by `actionGate`/`buildManagerViewModel` (Task 6). `MANAGER_TEXT` keys used in Tasks 7–9 (`opened, created, duplicated, deleted, reset, restored, failed, RECHECKED, REFUSED_CHANGED, NO_ID, FAULT, BUSY, PENDING`) all exist in Task 6, as does `lockedEditorVm` (used in Task 9) and `editorLock` (read by the Task 11 renderer). `recordsChanged`, `removeRecord`, `mintFresh`, `refuseNoId` (Task 7) are the only record-mutation/id helpers used by Tasks 8–9. `RUN`/`HANDLERS` are extended exactly in Task 8; `syncFrom`/`activate` are replaced exactly in Task 9 (the replacement keeps the `recordsChanged` dirty logic). The `panel.controller` facade (Task 12) uses only the manager's public surface. Remediation names (2026-10-10): `INTENT.TEST_LABEL_SCOPE`/`onTestLabelScope`/`c.labelScope` (Task 4) ↔ `labelScopeOf`/`pushLabelScope`/`labelScopeSig`/`labelScopeVersion` (Task 7) ↔ `editor.labelScopes` (fake, Task 7) ↔ `FAULT_POLICY` (Task 9, `TEST_LABEL_SCOPE: block`) ↔ static guards (Task 10); `onModelLeft`/`onCatalogChange`/`listedKeys`/`m.departed` (Task 7) ↔ AC-M10 tests (Tasks 7, 10); `isLoadableDraft` internals `DRAFT_KEYS`/`SIDE_KEYS`/`LAST_RUN_KEYS`/`isExactRecord`/`isExactArray`/`isLoadableDraftUnsafe` stay private to `testDrafts.js`; `FAULT_POLICY` (exported by `testsManager.js`, not by the core barrel) replaces the former `FAULT_BLOCKED` everywhere. Third-remediation names (Task 11, private to `ui/render/manager.js`): `FAULT_ROW_ATTR` (`data-fault-locked`, also the CSS selector and the DOM test's `locked`), `ROW_GUARD_EVENTS`, `guardedHosts`, `lockRow(n, faultId)` (called by `lockEditor`'s `lock`), `guardLockedRows(host)` (called by `renderManagedPanel` on every render; installs its listeners once per host). Second-remediation names: `lockedEditorVm(editorVm, reason, policy)` (Task 6) ↔ `viewModelOf` (Task 9, `FAULT_POLICY`) ↔ overlay fields `setup.locked`, `run.locked`, banner `action.enabled/reason`, `results.select`, `results.nav.locked` ↔ `FAULT_LOCKS`/`SETUP_LOCKED`/`lockEditor(host, vm, ns)` (Task 11); `FAULT_CONTROLS` (incl. `variant`)/`NON_USER_FACING`/`faultFixtureEditorVm`/`faultVariantEditorVm`/`faultCases` (`test/clashpanel/support/faultControls.mjs`, Task 9) ↔ Task 9 and Task 11 tests.
4. **Review Focus.** Each of the six lines has a pinning test: Task 8 (double click), Task 11 (hostile/unbroken names), Task 10 (model-left without catalog change), Task 9 (late same-target notification; dispose during activation), Tasks 9 and 11 (fault overlay = `FAULT_POLICY`).
5. **Authority.** M1 and M2 are acceptance requirements with owning tasks; transitions beyond plan drafting are recorded as not authorized.

---

## Addendum A — Manager list layout / responsive polish (owner-authorized UI-presentation amendment, 2026-10-11) — NOT IMPLEMENTED, NOT AUTHORIZED TO IMPLEMENT

**Status and boundary.** Tasks 1–13 above are the **historical, completed and accepted** functional implementation (checkpoint `8c102cb`); they are unchanged and Task 11's text still describes what was built (7-column table, ` (active)`, text action buttons). This addendum is a *new, separately authorized polish package* that supersedes only Task 11's **presentation** of the Tests list. Governing design: spec §26.14 (AC-UI1…AC-UI12); report: [UI-layout final report](../../research/2026-10-11-clash-tests-manager-ui-layout-final-report.md). Owner Option A ([record](../../reviews/2026-10-10-clash-tests-manager-ui-architecture-owner-decision.md)) is unchanged. **Implementation requires a separate explicit owner authorization and the decisions CTM-UI-OD1…CTM-UI-OD3 in the report §14 (distinct from the spec's existing OD-1…OD-14).**

**Zero-diff guard (AC-UI9).** Production change set is exactly: `clashpanel/ui/render/manager.js` (the `MANAGER_CSS` string, `renderList`/`row`/`actionCell` and their helpers). Nothing else. `clashpanel/core/**`, `clashpanel/ui/ClashDockingPanel.js`, `clashpanel/ui/render/panel.js`, other renderers, `wwwroot/main.css` (icon masks live in `MANAGER_CSS`; `main.css` has a zero diff), Core, Adapter, collision, ports and package files are untouched.

**Tasks (TDD; each ends green on its focused tests, then the full suites).**

- **P1 — Structure.** Replace table/caption/thead/tbody with caption `p` + `ul` + `li` per §26.14 (DOM order: head line → meta → Set A → Set B → readiness → reasons). Keep `data-key` scheme, `aria-label`, `.clash-manager-name`, `.clash-manager-status` (text and ` · ` joiner), `.clash-manager-readiness`, `aria-current`, `data-test-id`. Add `.clash-manager-mode`, `.clash-manager-set` (+label/value), `.clash-manager-badge`, `.clash-manager-reasons`.
- **P2 — Actions.** Icon-only buttons with decorative icon element, `title`, 28×28 hit area, `role="group"` named with the test name; shared per-distinct-reason elements (reason element ids stay unique per item; `aria-describedby` from every disabled button it explains).
- **P3 — CSS.** Manager-scoped rules only (flex-wrap head line; min inline sizes with specificity above `.clash-panel-root *`; 2-line clamp with `title` for name/Set values; `overflow-wrap:break-word; word-break:normal` for non-clamped fields; list-width-driven tiers; mask-image glyphs + `@supports not` text fallback; active accent bar/badge; disabled/focus inherit existing rules).
- **P4 — Verify.** Run the tests below; then the headed pass (separate authorization).

**Enumerated existing-test edits (structural selectors only; no behavioral assertion weakened).** Disclosed in the later final report.

| File | Current pin | Edit |
| --- | --- | --- |
| `test/clashpanel/dom/manager.dom.mjs:13-33` | `th[scope="row"]` text `['Clash test 1 (active)','true']`; caption; `tbody tr` | read `.clash-manager-item .clash-manager-name` text + `aria-current` + badge text `Active`; caption `p`; `li` count |
| `:35-47` | action button label/reason by `manager-<id>-<i>`, `aria-describedby` text | **unchanged** (must still pass) + add `title`, icon `aria-hidden` |
| `:229-240` | no overflow at 480 px; `tbody tr th .clash-manager-name` | selector → `.clash-manager-item .clash-manager-name`; overflow assertion unchanged |
| `test/clashpanel/dom/managerComposition.dom.mjs:34-51,:127-151` | `.clash-manager-table tbody tr` counts | → `.clash-manager-item` counts; status-cell regex **unchanged** |
| `test/clashpanel/dom/shell.dom.mjs:255-274` | geometry strings | **unchanged** |

**New tests (DOM, real Chromium unless noted).**

1. AC-UI1/2: no table elements; `li` order; badge text and `aria-current` only on the active item.
2. AC-UI3/11: per action `aria-label`, `title`, `aria-hidden` icon, `getBoundingClientRect` ≥ 28×28 at every tested width, gap ≥ 4 px, Tab order, Enter/Space dispatch the same intents, focus-visible outline computed non-`none`.
3. AC-UI4/5: disabled buttons non-focusable; `aria-describedby` → visible element with exact reason; Reset/Delete confirmation banner, focus, labels unchanged (reuse existing assertions).
4. AC-UI6/7: for widths 240/280/340/436 (set via a wrapper of fixed width around the list), 10 000-character unbroken names for test and models — no panel-body horizontal overflow; name/Set `getBoundingClientRect().width` ≥ min (10ch/12ch measured with a same-font `ch` probe element); rendered line count ≤ 2 via height ÷ the explicit numeric `line-height` set on clamped fields; `title` equals DOM text; action group inside item/viewport; status/readiness/reasons `scrollHeight ≤ clientHeight+1`.
5. AC-UI8: width/min/max strings and `container.style.width` identical before/after list↔editor switches.
6. AC-UI9 (node): zero-diff guard on the protected file list (extend the existing static/source-shape guards; `git diff --stat` command recorded in the report); ViewModel row key-list test (`managerViewModel.test.mjs:37-38`) passes unchanged.
7. AC-UI12 (node): `domIsolation`/static guard — no `innerHTML`, `createElementNS`, `<svg`, emoji code points in the manager renderer; icon data-URIs only in CSS strings.
8. Mask fallback: add the test seam class `.clash-manager-no-mask` to the list root (the same fallback declarations as the production `@supports not (...)` rule; `CSS.supports` stubbing is **not** used because it does not affect CSS conditional evaluation), assert each button's text label is visible and the glyph is hidden; separately assert the production `@supports not` block exists in `MANAGER_CSS` and declares the identical fallback.
9. Accessibility names (AC-UI11): `ul` resolves via `aria-labelledby` to the caption text; action group name includes the test name; reason rows list each disabled action once, in order, beside its shared reason (dedup test with two actions sharing a reason).
10. Meta line: `.clash-manager-status.textContent` byte-identical to the ViewModel/old text; the `·` separator is a `span.clash-manager-sep[aria-hidden="true"]`.
11. Support floor: at a 300 px viewport the list content is ≥ 240 px with no horizontal overflow; at 280 px viewport no script error and the action group wraps (degradation only, no layout guarantee).

**Later headed visual pass (separate authorization; not CTM-7).** Normal app (`node server.js`, port 8080) with the Audubon SVF2 set and ≥ 3 tests, Viewer 7.124.2. Evidence package `docs/research/evidence/<date>-manager-layout-headed/` with PNGs `<Set>-NN-<scenario>.png`, `MANIFEST.sha256`, README scenario table (PASS / PASS (caveat) / FAIL / INCONCLUSIVE). Scenarios: default 460 px with short names; hostile long Autodesk-style model names; panel at 340 px min, a 300 px browser viewport (supported minimum) and a ≈ 300 px embedded Viewer container (Viewer container ≠ viewport, since the shell's `90vw` uses the viewport); active/inactive/running/not-run/completed/models-changed/not-loaded rows; every disabled-reason combination (running; confirmation pending; fault); hover/focus/disabled/focus-visible of each icon button and Delete's distinct glyph; icon contrast on the light surface; tooltip (`title`) behavior on enabled buttons and whether it shows on disabled ones; Manager ↔ Editor switch leaves width unchanged; panel dragged then switched; Viewer viewport shrink clamps width and list stays correct; keyboard-only pass; screen-reader spot check (item count, names, reasons) if available; toolbar/panel overlap observation at narrow viewport (existing caveat, not a regression).

**Deferred Lows interaction (L1–L8, none remediated).** L1/L5/L7 (focus loss / index-based `data-key` / missing focus DOM tests): the new structure keeps the `data-key` scheme and rebuild model, so L1/L5 behavior is unchanged and P1–P3 proceed without remediating them; new tests must not assert fixed focus-restoration behavior either way. L3 (copy nits): all strings unchanged, no overlap. L2/L4/L6/L8: no overlap. **If implementation finds that preserving behavior requires touching focus restoration, stop and surface an owner decision.**

**Not authorized (unchanged).** Implementation of this addendum; CTM-7; CTM-8; L1–L8 remediation; persistence/history/background runs/lifecycle; public API change; Core/Adapter/collision; G2/C6/C8/G3; R20-1; separate-panel architecture; any resize feature.
