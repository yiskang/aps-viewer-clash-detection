# Final whole-branch review — fix wave report (A-1, B-1, C-M1)

Branch `feature/viewer-clash-panel-t1-t33`. Start HEAD 5d02623. Final HEAD d381e58. `git status --short` is empty (this report sits under the git-ignored `.superpowers/`).

Commits, in order:
- `50b0ac0` fix(clashpanel): offer release-and-retry when a stuck release of the Panel's own set blocks Run
- `9f3bcb1` fix(clashpanel): restore the Panel isolation for models still loaded after a model leaves
- `d381e58` fix(clashpanel): fold ViewerBridge teardown failures into createClashPanel dispose AggregateError

Every commit ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and has no `Claude-Session:` trailer. Files were staged with explicit `git add <paths>`. Nothing was pushed. Only files under `clashpanel/**` and `test/clashpanel/**` changed. No existing test was edited or weakened.

## A-1: a stuck release of the Panel's own set blocks Run

**Change**
- `clashpanel/core/residency.js` gains an additive, read-only accessor `stuckRunIds()`. It returns a frozen snapshot of the stuck entries' runIds. The rest of the residency API and its behaviour are unchanged.
- `clashpanel/core/runReport.js`: `mapAdmissionError(error, { heldRunId, ownRunIds = [] })`. The new option is additive. A `ResultCapacityError` whose blockers include the held runId or any id in `ownRunIds` now maps to `release-and-retry`. A malformed `ownRunIds` is ignored.
- `clashpanel/core/controller.js`: the admission catch passes `ownRunIds: stuckRunIdsOf(c)`. The helper `stuckRunIdsOf` is guarded (it checks that the member exists and uses try).
- `onReleaseAndRetry` is unchanged. Its existing path, `startRun({acknowledgeUnsaved:true})` → `retireDisplayed` → `residency.release()` → `retryStuck()` → `engine.startRun`, retries the stuck release before admission.

**Tests (3 new offline tests)**
- `test/clashpanel/core/controller.setupRun.test.mjs`: "A-1: capacity 1 + a STUCK release…". The run is saved and leased. `failNextLeaseRelease`, then Clear: run-1 is stuck. Run is rejected by capacity. Checks:
  - the banner does not say "other runs";
  - the banner offers `RUN_RELEASE_AND_RETRY`;
  - dispatching it retries the stuck release (run-1 is no longer resident) and the new run is admitted (`preparing`, 3 start calls, no admission or release banner).
- `test/clashpanel/core/residency.test.mjs`: the `stuckRunIds()` snapshot is frozen and empties after recovery.
- `test/clashpanel/core/runReport.test.mjs`: the `ownRunIds` mapping, a runId that is not ours, and malformed input.

**RED (before the fix):** the controller test failed with `actual: 'The clash engine is at capacity: its result slots are held by other runs. Try again after they are released.'`, which is expected not to match `/other runs/`.

**GREEN:** the covering core suites passed 99/99. All `test/clashpanel/**/*.test.mjs` passed 610/610.

## B-1: the Panel's isolation is stranded after a model leaves

**Change** (in `clashpanel/viewer/isolation.js` only). A new helper `projectOnto(normalized, inScene)` keeps only the entries whose model is present.

`restore()` now works like this:
- It reads isolation as before. An unreadable read is still `failed` / `UNREADABLE_AT_RESTORE`.
- It then makes ONE `getAllModels()` read. If that read throws or does not return an array, the result is `'failed'` with the new note `ISOLATION_NOTE.SCENE_UNREADABLE_AT_RESTORE`, and the record is KEPT.
- The ownership check compares current, target and prevTarget, all projected onto the models in that read. When the check fails, the outcome is the same as before (`'none'` only for an unconfirmed record at the projected pre-image, otherwise `'skipped-external'`), and the record is dropped.
- When the Panel still owns the isolation and the projected current state already equals the projected pre-image, there is no write. The result is `'restored'` and the record is dropped.
- Otherwise `restoreTo` writes only the PROJECTED pre-image, and its post-throw compares use the same projection.

Other rules:
- `apply()`: the ownership-continues check at ~:114 uses the same projection, against the `inScene` read the function already makes.
- There is no clear-all fallback anywhere.
- A difference on a model that is still loaded stays foreign.

**Tests (5 new offline tests, appended to `test/clashpanel/viewer/ViewerBridge.transaction.test.mjs`).** Each one calls the fake's `removeModel()` before an awaited `clear()`.
- (i) A single isolated model departs (prior m3:[42]): `'restored'`, the prior is back, and a second `clear()` returns `'none'` (record dropped).
- (ii) Two models are isolated with prior `[{m1,[7]},{m2,[8]}]`, then m2 departs: `'restored'` to `[{m1,[7]}]`, and the last write never names m2.
- (iii) m2 departs and a still-loaded m1 was changed by someone else: `'skipped-external'`, no write, and the foreign state is kept.
- (iv) `getAllModels` throws at restore: `'failed'` with `SCENE_UNREADABLE_AT_RESTORE`, no write, and the record is kept, because the next `clear()` returns `'restored'` to the prior.
- (v) An extra test for the `apply()` half. m2 departs, then `present` runs on m1 only. Ownership continues, so the later `clear()` restores the ORIGINAL prior and not the leftover `[{m1,[1]}]`.

**RED:** I ran the new tests against the HEAD `isolation.js`. It was copied back temporarily through a scratchpad file. I did not use `git checkout`/`stash`. Results:
- (i) failed with `actual: 'skipped-external'`;
- (ii) failed with `actual: 'skipped-external'`;
- (iv) failed with `actual: 'skipped-external'`;
- (v) failed;
- (iii) passed, which is correct because it pins behaviour that must not change.

**GREEN:** 5/5. The full transaction file passed. All `test/clashpanel/**/*.test.mjs` passed 615/615, and every existing isolation, transaction, matrix and noTheming test passed unchanged.

## C-M1: createClashPanel().dispose() swallows bridge teardown failures

**Change** (in `clashpanel/index.js` only). After the bridge dispose step, and still inside the innermost `finally`, `disposeAll()` appends `bridgeTeardownErrors(bridge)`. That helper:
- skips when `inspectDisposal` is not a function;
- turns a throwing `inspectDisposal` into an error;
- passes each `listenerErrors` entry through as-is (wrapping a non-Error value);
- creates one `Error('createClashPanel: viewer teardown: <note>')` per `releaseNotes` entry.

Every `releaseNotes` entry is a failure note: `BRIDGE_NOTE.REMOVE_FAILED` or an `ISOLATION_NOTE`.

What stays the same:
- The AggregateError is still thrown only after ALL steps ran.
- `dispose` still returns the same memoized promise.
- The construction-rollback path is unchanged.
- ViewerBridge's dispose contract is untouched: idempotent, never rejects, resolves undefined.

I updated the jsdoc sentence to name the folded bridge teardown failures. `clashpanel/README.md` did not need an edit: it already says "if any step failed … `dispose()` rejects with an `AggregateError`", and that is now accurate.

**Test (1 new DOM test).** In `test/clashpanel/dom/composition.dom.mjs` I appended "C-M1: bridge teardown failures…". No existing test changed. The test runs: run → done → select with markers → Isolate on. Then the fake viewer's `removeEventListener` is patched to remove the listener and then throw, and `setAggregateIsolation` is patched to throw. Then `panel.dispose()` is called twice. Checks:
- both calls return the same promise, and both reject with `AggregateError`;
- the inner errors include "removeEventListener failed" and "Isolation could not be restored";
- meshes, viewer listeners, catalog listeners and leases are all 0, and the panel is gone from the DOM.

**RED:** before the fix the test failed at `assert.equal(r.error?.name, 'AggregateError')`, because dispose resolved.

**GREEN:** `composition.dom.mjs` passed 11/11.

## Final verification: `npm test` (one command, exit 0)

```
# tests 3587   (offline: pass 3586, fail 0, todo 1)   = 3579 + 8 new offline (A-1: 3, B-1: 5)
# tests 77     (DOM:     pass 77,   fail 0, todo 0)   = 76 + 1 new DOM (C-M1)
```

The single todo is the pre-existing KNOWN GAP (extreme aspect ratio). There were no EPERM spike-server failures. `git status --short` is empty.

## Deviations
- A-1: besides the residency accessor, the fix adds an optional `ownRunIds` option to `mapAdmissionError` in `runReport.js`. `heldRunId` keeps its old meaning. I did it this way so the "own blocker" rule stays in the one function that owns the capacity wording. I also added two small unit tests beyond the one the brief required (residency and runReport).
- B-1:
  - I added a new note constant, `ISOLATION_NOTE.SCENE_UNREADABLE_AT_RESTORE`, for the new failure path where the scene read is unreadable.
  - I added test (v) for the `apply()` projection.
  - Reviewer B suggested editing the existing `transaction.test.mjs:209` so that it also removes the model. I did not, because the brief forbids altering existing tests. The new tests (i)–(v) cover that row instead.
  - In the B-1 sequence the fix was applied just before the tests were written. RED was therefore shown by restoring the HEAD `isolation.js` from a scratchpad copy, not by running the tests before the edit.
- C-M1: I edited the jsdoc only. The README was not edited because it was already accurate.

## Concerns / notes for the handoff (not fixed, out of scope)
- In the restore path, when ownership still holds and the state already sits at the projected pre-image, there is now no write. That includes the old case where target == pre-image, which used to re-write the pre-image idempotently. The outcome is still `'restored'`, and no existing test depended on the write.
- `bridge.dispose()` still swallows any throw from `markers.removeAll()` / `markers.disposeShared()` itself, because those are not recorded in `inspectDisposal()`. B-2 is still RECORD: a dispose-time restore failure is now REPORTED to the host, but the bridge still cannot retry it after dispose. The `ViewerBridge.js:115-117` comment overclaim was left untouched. B-7 (the `inspectDisposal` settled flag) still stands, but `index.js` reads it only after `await bridge.dispose()`, so it does not affect this fix.
- Live `getAggregateIsolation` semantics after a model unload remain gate G2.
- I did not use codex-advisor/codex-review or the native advisor in this wave. The B-1 fix follows the conditions that reviewer B's codex consult had already confirmed.
