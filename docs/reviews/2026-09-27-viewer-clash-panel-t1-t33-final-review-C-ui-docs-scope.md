# Final whole-branch review C: UI, composition, docs and T33 scope

Range a0134bb..5d02623 (36 commits, 107 files, +17698/-3). This review was read-only. The full suite was not re-run.

## 1. T33 scope checks (Step 5, BASE=a0134bb). Outputs are verbatim.

| Check | Output | Verdict |
|---|---|---|
| `git status --short` | *(empty)* | OK |
| `git diff --name-only a0134bb..HEAD \| grep -vE '^(clashpanel/\|test/clashpanel/\|scripts/run-dom-tests\.mjs$\|package\.json$\|test/README\.md$\|test/acceptance/README\.md$\|docs/(handoffs\|reviews\|research)/)'` | *(no output; grep rc=1)* | OK |
| `git diff --quiet a0134bb..HEAD -- docs/superpowers/specs docs/superpowers/plans` | rc=0 (frozen-docs-untouched) | OK |
| `git diff a0134bb..HEAD -- package.json` | `-"test": "node scripts/run-tests.mjs",` / `+"test": "npm run test:offline && npm run test:clashpanel:dom",` / `+"test:offline": "node scripts/run-tests.mjs",` / `+"test:clashpanel:dom": "node scripts/run-dom-tests.mjs",` | OK: one line edited, two added |
| `git diff --quiet a0134bb..HEAD -- package-lock.json clashtest collision wwwroot server.js scripts/run-tests.mjs routes CHANGELOG.md test/clashtest test/fixtures` | rc=0 (frozen-untouched) | OK |
| `git diff a0134bb..HEAD -- test/README.md test/acceptance/README.md` | one edited `npm test` bullet plus additions in test/README.md (and an added `test:offline`/pretest note); one added section in the acceptance README | OK: T27 documentation only |
| `grep -c "requires the installed" test/README.md` / `grep -c "Which browser tests are in" test/acceptance/README.md` | `1` / `1` | OK |
| `grep -rnE 'innerHTML\|outerHTML\|insertAdjacentHTML\|document\.write' clashpanel/ui; echo exit=$?` | `exit=1` | OK |
| `grep -rnE 'setThemingColor\|clearThemingColors\|getThemingColor\|viewer\.impl\|Private\.' clashpanel; echo exit=$?` | `exit=1` | OK |
| `grep -rn isOTG clashpanel` | no match (rc=1) | OK |
| `grep -rn elementCount clashpanel` | 3 hits, all comments that say the field is never read (core/runReport.js:10, core/viewModel.js:269, core/resultIndex.js:7) | OK: no code reads it |
| forbidden engine members `\.(register\|unregister\|invalidateModelPlacement\|wireModelUnload\|keyOf\|getPairStatus\|getElementStatus)\(` | only clashpanel/README.md:77, which is the host-responsibility text | OK |
| Viewer selection calls (`setAggregateSelection\|.select(\|restoreState`) | only `setSelectionRange` (text caret, ui/dom.js:70-71) | OK |
| `*.test.mjs` importing playwright | none (rc=1) | OK |
| `find clashpanel -name '*.js' \| wc -l` | 36 | OK: matches catalog §2 |

Note for the T33 record: plan Step 3 expects `# tests 75`, but the DOM suite really has **76**. The plan miscounted T29 by one (42 in the brief vs 43 actual), and C-3 added no test. Record 76 in the handoff and do not treat it as a regression.

## 2. Findings

### MUST-FIX-BEFORE-HANDOFF

**C-M1 (Medium): the dispose contract promises to report bridge failures, but they are always swallowed.**

- Where:
  - clashpanel/index.js:24-33 (jsdoc) and :80-84;
  - clashpanel/README.md:42-45;
  - root cause: clashpanel/viewer/ViewerBridge.js:241-261.
- What happens: `bridge.dispose()` always resolves `undefined`. Its `.then(() => undefined, () => undefined)` swallows every failure. Failed listener removals and failed dispose-time release notes (for example a failed isolation restore) go only into `inspectDisposal()`. That function is diagnostic, and neither the controller nor index.js reads it.
- Dead code: the `try { await bridge.dispose() } catch` blocks in index.js:80-84 and controller.js:501 can never catch anything.
- Why it breaks the contract: the README says "if any step failed ... `dispose()` rejects with an `AggregateError` after all steps ran, so the host must `await` it inside try/catch". The jsdoc says "rejects with an AggregateError listing every failed step".
- Failure scenario:
  1. The Isolate toggle is on.
  2. During `panel.dispose()`, `setAggregateIsolation` throws in the guarded restore, or `viewer.removeEventListener` throws.
  3. The bridge records a note or error internally, and `panel.dispose()` resolves normally.
  4. The host believes teardown was clean, but the Viewer is still isolated and there is no signal. This breaks the restore-table row "Extension unload/dispose → restored (guarded)" in the spec.
- Least-churn fix, choose one:
  - (a) In `disposeAll` after `await bridge.dispose()`, read `bridge.inspectDisposal()` and push `listenerErrors`, plus one `Error` per release note whose isolation outcome is `'failed'`, into `errors`. Add one composition DOM test with a failing viewer `removeEventListener`/`setAggregateIsolation`. This also closes the T32 minor "no test for failing bridge.dispose inside createClashPanel.dispose".
  - (b) Docs-only: correct the README and jsdoc to say bridge-side dispose failures are recorded by the bridge and not surfaced. This is weaker and leaves the host blind.
- Cross-check with reviewer B, who owns ViewerBridge.

**No other MUST-FIX items in area C.**

### RECORD (accept; list in the handoff as known follow-up)

**C-R1 (Medium, a11y): results-list ARIA is invalid.** This was flagged at T29 and T30.

- Where: clashpanel/ui/render/results.js:43 (`li role=presentation` wrapping `<button aria-expanded>`) and :106-109 (`ul role=listbox`).
- Why it is invalid: a listbox may own only `option` or `group` children, so the group-toggle button is a disallowed interactive descendant. The options also use tabindex=0 each, with no roving focus or arrow keys, which does not follow the listbox pattern.
- Decision: **RECORD, not MUST-FIX.**
  - Spec §14.5 only requires "all actions keyboard-reachable; list rows focusable with Enter to select", and the code meets that (native button and Tab-reachable rows).
  - No role is mandated by the spec or plan, and the plan mandates this code.
  - The real impact is degraded screen-reader semantics in grouped view only, not lost function.
- Least-churn fix when authorized: role=tree/treeitem.
  - The `ul` becomes `role=tree`.
  - Result `li` becomes `role=treeitem` with `aria-selected`, plus `aria-level=2` when it has a `groupId`.
  - Group `li` becomes `role=treeitem aria-expanded aria-level=1` with `data-key`, `tabindex=0`, and click plus Enter/Space handlers moved from the inner `<button>` onto the `li`. The button is removed.
  - Moving group toggles out of the listbox is not viable, because group headers are interleaved with their rows.
- Test lines that would change:
  - test/clashpanel/dom/results.dom.mjs:28 (`'option'` → `'treeitem'`);
  - results.dom.mjs:44 and :46 (selector `.clash-group-row button` → `.clash-group-row`);
  - test/clashpanel/dom/panel.dom.mjs:61 (`rowsNotOptions` → role `treeitem`);
  - the panel keyboard-order test's expected focusables, where the group `data-key` stays the same but moves to the `li`.
- Also record: `aria-label` on a plain `<span>` at results.js:33 is ignored by assistive technology, and badges at :36 run together.

**C-R2 (Low-Medium, a11y): focus drops to `<body>` when the focused control becomes disabled.**

- Where: ui/dom.js:66-73.
- Example: pressing Run makes `canRun` false; `rebuild` refocuses the new disabled button, focus fails, and focus lands on `body`. The same happens with Prev/Next at the ends and page ‹ ›.
- Effect: a keyboard user's next Tab restarts from the top of the document, outside the panel.
- Fix: fall back to the nearest enabled keyed sibling or the region heading. This is T28/T29/T31 polish.

**C-R3 (Low): long names in a closed `<select>` hide the disambiguating suffix.**

- Where: ui/render/filters.js:39 (model filter options), with CSS at panel.js:43.
- Effect: a closed native select cannot wrap, and Chromium's open popup also truncates with an end-ellipsis at viewport width. Two duplicate long names (Review Focus 2 combined with 5) can look identical.
- Other places the name appears (setup checklist, row chips, group labels) wrap correctly through `overflow-wrap:anywhere` and keep the suffix.
- Fix: set `title` equal to the full label on each option and on the select's selected label, or truncate in the middle while keeping the suffix.

**C-R4 (Low): dispatch rejections are never caught.**

- Where: every renderer handler, and ClashDockingPanel.js:60.
- Effect: controller `dispatch` rejects only when a handler throws (a programming error), and then the host page gets an `unhandledrejection`. The controller itself is unaffected, because subscriber errors are swallowed at controller.js:101.
- Fix: one shared `.catch` in the shell's `dispatch` wrapper.

**C-R5 (Low): composition rollback drops teardown errors.** In index.js:46 and :54-58, `.catch(()=>{})` discards them on failed construction. They could be attached as `error.cause`.

**C-R6 (Low, G2): the shell dispose has no fallback.** In ClashDockingPanel.js:92-101, if `uninitialize()` throws partway through, nothing removes the container. An `unsubscribe` throw still reaches `uninitialize` (through `finally`) and is caught by index.js. The rollback sweep at :79-83 removes any child appended during construction, which is a G2 assumption.

**C-R7 (Low): the T31 G2-assumptions list exists only in the gitignored ledger.**

- The ledger is `.superpowers/` (.gitignore:484). clashpanel/README.md G2 row names only three of the roughly twelve assumptions.
- The full list must be copied into docs/handoffs/latest.md at handoff: ctor order, `initialize()` fully replaced, `createTitleBar`/`createCloseButton`/`initializeMoveHandlers` signatures, CSS class names, redundant `setVisible` callbacks, no remove-listener, own-property names, `uninitialize` semantics, synchronous append, `titleLabel`, and move-handler cleanup.

**C-R8 (Low): unguarded progress fields.** In run.js:35-36, `unitsEvaluated`/`unitsTotal`/`resultsFound` render as `'undefined'` if the view-model omits them. The view-model always supplies them, but the renderer has no guard.

**C-R9 (Low): run-dom-tests.mjs:45 duplicates `LAUNCH_ARGS` from harness.mjs:19,** which is a drift risk. Also, the runner passes a `*.dom.mjs` file that contains zero `test()` calls.

**C-R10 (Low): weak or vacuous test assertions.**

- The T29 `doesNotMatch(/^No clashes$/)` cannot fail. AC-P2 is still pinned at the view-model level.
- The bounded-DOM test is near-tautological, and there is no scroll-preservation assertion.
- shell.dom.mjs:347 `listeners: 0` checks nothing.
- The composition Copy-diagnostics end-to-end test checks only that it gets a non-null JSON object.
- The T30 keyboard test skips `<summary>`.

**C-R11 (Low): other UX polish.**

- The same reason text appears three times when no model is live.
- Focus's visible reason is tested only through `title`.
- The max-gap bound has no unit.
- `aria-describedby` / `role=alert` are missing on the field errors (clearance, max gap).
- A model's state text sits outside its `label`.
- `copyDiagnostics` gives no feedback on success or failure.
- When the filter value is an absent option, `select.value` shows blank.
- `domIsolation` does not parse `npm -s test` or the implicit pre/post hooks.

### DROP

- T28 "no Save control": spec §14.3 and §14.4 list no Save in Region 1.
- T28 "no hostile-text test for setup/run": panel.dom.mjs `hostileVm()` covers setup and run (T30).
- ui/dom.js:19-21 `props` bypass: every call site uses a literal static property (`checked`, `value`, `open`), and a literal `innerHTML` would still hit the static grep ban. Not reachable by untrusted input.
- index.js:37-39 validates `id` after `createViewerApi`, which is pure (no subscription), so the order has no effect.
- `bridge.dispose()` is called twice on the normal path, but it is idempotent (same promise).
- `Autodesk` is injected through index.js to the shell, which the T1 index rule allows.
- Implementer concern "`overflow-x:hidden` on root" is harmless.
- `README 'fake Viewer/engine/catalog'` wording (T27) is accurate at HEAD.

## 3. Verified OK

**Five regions and the shell**
- The five regions are in fixed order with the spec headings (panel.js:12-18). Sections are reused, so the `aria-live` status node (run.js:137-140, 181) survives re-renders.
- Setup collapses to a one-line summary.
- DockingPanel is the only shell (ClashDockingPanel.js). It extends the base only through `initialize()` and uses the base `createTitleBar`/`createCloseButton`/`initializeMoveHandlers`. It has no drag/resize/z-order code and no domain state, and holds exactly one visibility listener gated by `disposed`. Construction is transactional with rollback.

**Markers, sealed browsing, bounded DOM**
- Markers-only wording: "Markers" toggle, no colour or theme control, and no theming or selection calls anywhere.
- No ETA or telemetry. Progress shows only fraction, units, found, caveats and elapsed.
- The results list renders only in states `list`/`grouping-unavailable`. The view-model (viewModel.js:360) gives state `running` with no rows while the run is non-terminal.
- The DOM renders exactly `vm.results.rows`. The controller slices with `PAGE_SIZE=50`.

**Soft mode and wording**
- The Soft radio is disabled whenever `!soft.available`. The explanation comes from `SOFT_UNAVAILABLE_TEXT` (a fixed text plus the reason) through the view-model. The clearance field is shown only when `vm.clearance.visible`.
- Renderers write no "No clashes" text. Empty-state and before-run text come from the view-model (viewModel.js:42, 342). "No clash selected" in Region 5 is the selection state, not a result claim.

**Untrusted text and focus**
- All untrusted text goes through `textContent`, and attribute values through `setAttribute`. `el()` rejects `on*` attributes, and `findByKey` avoids selector parsing of keys.
- Focus and caret are preserved across rebuilds by `data-key`.

**Composition**
- index.js passes `engine` raw, and core `narrowEnginePort` (controller.js:38, ports.js:33) narrows it to the listed members.
- index.js does no registration and no unload wiring. It has no `isOTG`. It exports only `createClashPanel`.
- Overlay scene names are scoped per instance.
- `dispose` runs shell → controller → bridge through nested `finally`, so every step runs; it is idempotent; and the controller's `{released, errors}` are folded in. The C-M1 gap is the exception.

**Default gate**
- `npm test` = `npm run test:offline && npm run test:clashpanel:dom`, with no recursion (guarded by domIsolation.test.mjs).
- The offline runner collects only `*.test.mjs`.
- The DOM runner fails closed on a missing playwright package, a Chromium that will not launch, zero files, or a signal-killed child.
- The DOM harness serves only `clashpanel/` and `test/clashpanel/dom/support/` through `page.route`, and returns 404 for any other origin, so there is no network access.

**README fact-check**
- test/README.md, test/acceptance/README.md and clashpanel/README.md match package.json and the scripts:
  - `clashtest-viewer-adapter.acceptance.mjs` exists;
  - `wireModelUnload` is exported from clashtest/viewer/index.js:6;
  - server.js serves only `wwwroot` and `/collision`.
- clashpanel/README states: not SVF2, not production-ready, nothing live-verified. It lists open gates G1 (PG-4, F1–F8), G2 (PG-1, stub assumptions), G3 (PG-2/3/5), H1 (PR-HOST) and H2 (OQ-1/PR-OQ17/PR-BASIS).
- The test READMEs claim nothing about SVF2 or production readiness.

## Counts

Critical 0 · High 0 · Medium 2 (C-M1, which is MUST-FIX; C-R1, which is RECORD) · Low 10 (RECORD) · DROP 8.
