# CTM-8 headed blockers (CTM8-P0-v4 §9)

## B-1 — Family M HM-REC: predicate not executable through the public instrumentation route

**Status:** all six HM-REC points are **UNAVAILABLE — §9.3 HM-REC predicate not executable through the public instrumentation route (manager VM/list DOM not reachable without a private-state read or production seam); owner ruling required**. The six points are `M.N_tests` ∈ {5, 25, 100} × `n_models` ∈ {1, 3}. Nothing was timed. No test records were created; that untimed step was optional and was skipped.

The coordinator ruled that no substitute predicate may be used, because one would change the accepted protocol.

Source-level findings:

1. **Only the editor ViewModel is reachable.** The handle `viewer.getExtension('Autodesk.Sandbox.ClashPanel')._host.panel.controller` is the public editor facade, not the Tests Manager (`clashpanel/index.js:134–139`): `getViewModel: () => manager.getViewModel().editor` and `subscribe: (cb) => manager.subscribe((vm) => cb(vm.editor))`. §9.3's semantic predicate needs `manager.tests[k].name`, `tests[k].testId` and `manager.count`, which are not on that surface. The manager object is local to `createClashPanel`. Reaching it would need a private-state read or a production seam, and §9.1 / §16 / §17 authorize neither.
2. **The list DOM is empty in editor view.** HM-REC's trigger runs in **editor view** (the target record is opened, then its setup-name input is filled). In that view `renderManagedPanel` (`clashpanel/ui/render/manager.js`) sets `list.hidden = m.view !== 'list'` and runs `rebuild(list, doc, () => {})`, so `.clash-manager-list` is empty. The DOM predicate "the list item for `idK` shows the new name" therefore cannot hold during the timed window.
3. **The quiet window on `.clash-manager-list` would mean nothing.** That region is empty and static in editor view, so "no mutation in `.clash-manager-list` for 250 ms" would hold trivially and would not bound the render the protocol means to time.

A DOM-equivalent candidate was identified but **not used**, per the ruling: the manager header `.clash-manager-active` text `Test: <name>` plus the `[data-key="manager-view-list"]` text `All tests (N)`, both rendered from the manager ViewModel. An owner decision is needed on whether to (a) amend §9.3 HM-REC to such a predicate, (b) authorize a seam, or (c) leave HM-REC headless-only.

## B-2 — Environment precondition at package start (resolved)

When this package started, `http://localhost:8099` was **not** the app. It served an unrelated Adminer container (OrbStack), and no `node server.js` was running. The project's Playwright policy also allows only `http://localhost:8080/`. The parent then started `node server.js` on :8080 (pid 96055). All headed work ran against :8080. Nothing was lost.

## Not blockers (recorded so they are not mistaken for gaps)

- **HV-2 (Focus) expected post-state not met as written.** See README "HV-2 observation". The camera after Focus equals the camera before Focus at all 9 points (finite). The settled pre-state of HV-2 was already the group fit produced by HV-1's `presentGroup`. This is recorded as an observation and nothing was remediated.
- **No Family R point was NOT EXECUTED.** The 5,000 and 10,000 targets are **NOT REACHABLE HEADED** (see `reachability.md`). That is a reachability disposition, not a blocker.
