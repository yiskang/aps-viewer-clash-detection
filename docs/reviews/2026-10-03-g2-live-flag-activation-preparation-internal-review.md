# G2 live-flag activation preparation — focused internal review

- **Date:** 2026-10-03 · **Baseline:** `main` @ `7ae4147b726e20b8183f0522ffabf61ab75895d6` (`== origin/main`), tree clean except the untracked authorizing prompt.
- **Authority:** [`docs/prompts/for-claude-g2-live-flag-activation-preparation-only.md`](../prompts/for-claude-g2-live-flag-activation-preparation-only.md). This does **not** authorize the real flip, a record, or live execution.
- **Result:** **0 Critical / 0 High / 0 Medium / 2 Low.** Prior activation-preparation review item **M2 (flip not simulated) is now closed.**

## Method

1. Verified baseline: branch/HEAD/origin, tree, harness SHA `d34d470c…9c39`, procedure SHA `d1ccfde2…5a75`, `G2_DUAL_COUNTER_GATE.resolved=true` (H:3716), `LIVE_PATH_WIRED=false` (H:119), no authorization record under `docs/prompts/`, no attempts directory.
2. Scratch copy via `git archive HEAD` (no worktree) at `<session scratchpad>/flipsim`, `node_modules` symlinked read-only. No real-repo path is hardcoded in `test/` or `scripts/`.
3. Scratch-only edit, two files (diff below). Ran all 43 focused G2 files and the offline aggregate.
4. Read-only runtime/gate verification in the real repo; only the offline `runtime-gates` suite was run there.

## Exact scratch diff (diagnostic only; not applied to the real repo)

```diff
--- test/acceptance/clashpanel-viewerbridge.acceptance.mjs
@@ -119 +119 @@
-const LIVE_PATH_WIRED = false;
+const LIVE_PATH_WIRED = true;
--- test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs
@@ -50,3 +50,3 @@
-test('PIN (single, deliberate): the real harness currently declares LIVE_PATH_WIRED = false (dormant)', () => {
-  assert.equal(livePathWiredDeclaration(REAL_SOURCE).value, false);
-  assert.equal(REAL.LIVE_PATH_WIRED, false);
+test('PIN (single, deliberate): the real harness currently declares LIVE_PATH_WIRED = true (flipped)', () => {
+  assert.equal(livePathWiredDeclaration(REAL_SOURCE).value, true);
+  assert.equal(REAL.LIVE_PATH_WIRED, true);
```

## Simulation results

- Focused G2: **903/903**, 43 files, all rc=0 (activation 11, preflight 7, cli 11, live-path-isolation 11, runtime-gates 60, mainflow 114).
- Offline aggregate: **5,149 total / 5,148 pass / 0 fail / 1 existing TODO** (matches baseline). A first run on a fresh archive showed 7 failures, all because `wwwroot/vendor` is not in the archive; `node scripts/sync-vendor.mjs` (local copy, no network) resolved them. They are environmental, not flip-related. `npm test` runs this via `pretest`; `node scripts/run-tests.mjs` alone does not.
- **Literal flip + the single pin is sufficient.** No other file or test expectation needed change.
- Real validation / real `main()` on the activated harness: none observed. The CLI test spawns only an isolated copy (empty tmp cwd, clean env, resolve hook refusing playwright/chromium) and asserts it never spawns the real harness. Fixtures live under `os.tmpdir()`; no new g2 file appeared outside it. No attempt/reservation state or authorization record created anywhere. Suites stayed offline; no browser/Viewer launched.

## Exact future real activation diff (NOT applied)

1. `test/acceptance/clashpanel-viewerbridge.acceptance.mjs:119`: `const LIVE_PATH_WIRED = false;` → `const LIVE_PATH_WIRED = true;`
2. `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs:50-52`: the single pin and its title `false (dormant)` → `true (flipped)`.
3. Nothing else. Then re-run offline suites, independent review, commit; recompute harness SHA afterward (it will change by construction).

## Runtime prerequisites

- Selected test binary: Node **v22.23.1** (`/Users/kangea/.nvm/versions/node/v22.23.1/bin/node`), the only nvm version installed; the default command environment may instead resolve `/opt/homebrew/bin/node` **v26.10.0** (independent review observed this), so the exact binary must be explicitly selected. Later selection: `nvm use 22.23.1`, verify `node -v` == `v22.23.1`. No `.nvmrc`/`.node-version`; `engines` is only `>=20`.
- `playwright` 1.62.1, `playwright-core` 1.62.1 (lockfile-pinned). Headless-shell rev 1234 / 151.0.7922.34 present (inferred from `browsers.json` + `INSTALLATION_COMPLETE`; binary not executed here).
- The committed gate rejects a Node mismatch (`runtime-gates.test.mjs:238-239`: `v26.10.0`, `v22.23.0`, `v22.23.10`, unprefixed, padded, empty, null → refuse at `node-version`, no writes). 60/60 pass.

## Activation-boundary safety (after a future flip, before any record)

- `main()` order (H:13602-13650): W0 → `LIVE_PATH_WIRED` → dual-counter gate → W1 record validation/attempts scan → hard runtime gates → binding → W2a/W2b reservation → `import('playwright')`. With no record, W1 (or W0 without the interlock) refuses before gates, reservation and import. Hard gates precede reservation and import once a record exists.
- Offline tests cannot consume a live authorization (isolated copies/roots); cannot create real attempt state; Viewer/fixture does not start; a coincidental filename cannot trigger the production path (CLI tests use isolated copies; the plan's rule that the record must not be named `g2-live-authorization.md` and must be the sole candidate remains).
- No violation found.

## Authorization-record boundary (prerequisites only; nothing prepared)

After a separately authorized flip and clean reviewed commit: clean committed activation HEAD (`Baseline-HEAD` = final run-time HEAD); recomputed harness SHA bound as `Harness-SHA256`; `Procedure-SHA256` = `d1ccfde2…`; both model URN SHA-256s; exact `Runtime:` line (Node v22.23.1 etc.); `G2-LIVE-EXECUTION: AUTHORIZED EXACTLY ONE ATTEMPT` marker; record untracked under `docs/prompts/`, sole non-superseded candidate; clean-tree identity (untracked `docs/prompts/` allowed; log outside repo); `npm test`/`test:offline` must not run while an issued record exists. Plan:125-142, 160-171.

## Findings

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| L1 | Low | Live execution plan §9 steps 1-2 and hazard G-15 (plan:~236-239) are **stale**: they describe ~20 suites failing at load and `cli.test.mjs:92-96` spawning the real harness. Post activation-preparation (`7ae4147`), the helper forces the flag per copy and the CLI test is isolated; only one pin changes. Plan also cites `H:118`; actual is `H:119`. | Doc-only. Correct the plan wording in a separately authorized change; the safer reading (one pin) is now empirically proven. |
| L2 | Low | The non-flipped baseline of the pin was not re-run in scratch (pin passes after edit; baseline pass already established by the committed 903/903). Headless-shell build is inferred from metadata, not executed (execution is out of scope here). | Accepted. |

No plan/harness/test correction is required before the flip itself.

## Verdict

A real flip appears **ready for independent review and a separate owner authorization decision**. Not authorized by this task.

## Immutability confirmation

Real repo: `LIVE_PATH_WIRED=false`; harness SHA unchanged `d34d470c…`; procedure SHA unchanged; no authorization record; no attempts directory; no Viewer/fixture load; no live G2; no commit; no push. Tree changes: this review, the handoff section, and the untracked authorizing prompt only.
