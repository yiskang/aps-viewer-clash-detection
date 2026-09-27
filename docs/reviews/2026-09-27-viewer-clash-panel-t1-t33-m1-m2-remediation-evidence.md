# Viewer Clash Panel T1–T33 — M1/M2 bounded remediation: evidence record

- **Date:** 2026-09-27
- **Authorization:** owner's bounded T1–T33 remediation (fix the grouped-Results ARIA defect; obtain a principled disposition of the baseline timing-sensitive test). It does **not** authorize G1–G3, H1–H2, SVF2, OQ-1, host integration, Core/Viewer Adapter/M4 changes, or any next milestone.
- **Branch / HEAD:** `feature/viewer-clash-panel-t1-t33` @ `d381e582188bb16e05e0f59c8c84d2ec38ac0a3b` (nothing committed by this remediation; changes are in the working tree). Baseline `e302b39720244b1085863220d75ac41e99075bac`.

## 1. M1 — grouped Results ARIA (fixed, uncommitted)

- **Defect:** grouped Results was one `ul role=listbox` owning `li role=presentation > button[aria-expanded]` group headers interleaved with `li role=option` rows; the header button became a non-option child of the listbox.
- **Fix (`clashpanel/ui/render/results.js`, smallest structural correction, no UX redesign):** in the grouped view each group toggle is a plain `div.clash-group-row > button` **outside** any listbox, and each group's option rows form their own `ul role=listbox` (`aria-label` = the group label) placed immediately after the header. Wrapper: `div.clash-groups[role=group][aria-label="Clash results"]`. A page that starts mid-group keeps a leading `listbox` labelled "Clash results"; a collapsed group emits no (empty) listbox. The flat / `grouping-unavailable` view is unchanged (one `listbox` "Clash results" of options). The group button, its `data-key`, `aria-expanded`, click → `group/toggle`, and option `tabindex`/Enter/Space/click → `nav/select` are unchanged; DOM order gives Tab order header → its options → next header. No view-model, core, or viewer change.
- **RED → GREEN (`test/clashpanel/dom/results.dom.mjs`, 5 new tests):**
  - RED verified: the structural test failed against the old markup (`listbox` children were `['presentation','option','option','presentation','option','presentation']`, expected option-only per listbox); GREEN after the fix.
  - The other four new tests are behavior-preservation guards that pass before and after by design: Tab order (`g|gA → gA|r0 → gA|r1 → g|gB → gB|r2`), Enter/Space on header → `group/toggle`, Space on option → `nav/select`, focus preserved across grouped re-render (header and in-group option), mid-group page + collapsed group shape, flat view unchanged.
  - Full DOM suite after the fix: 82/82 (77 + 5).
- **Not addressed (out of scope, per authorization):** focus-loss-when-control-disables and long-name `<select>` truncation findings.

## 2. Canonical gate — run once after the fix

- **Command:** `npm test` (= `npm run test:offline && npm run test:clashpanel:dom`), run **exactly once**, no retries, from the repository root.
- **Environment:** Node `v22.23.1`, macOS (Darwin), Playwright/Chromium via the repo devDependency; run started 2026-09-27 05:39:20 UTC on HEAD `d381e58` + the M1 working-tree change.
- **Result: exit 0.**
  - Offline: `# tests 3587`, `# pass 3586`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 1` (the pre-existing `KNOWN GAP … extreme single-geometry aspect ratio` TODO).
  - DOM: `# tests 82`, `# pass 82`, `# fail 0`, `# todo 0`.
- **The test cited by review M2** (`test/query/ContainmentModeQuery.test.mjs:64–80`, "default scheduler makes frameBudgetMs live for the witness term…", asserts `elapsed < 1000` ms) **passed: `ok 3184`, `duration_ms: 16.6`**.
- **Full log:** [`2026-09-27-viewer-clash-panel-t1-t33-m1-m2-remediation-canonical-npm-test.log.txt`](2026-09-27-viewer-clash-panel-t1-t33-m1-m2-remediation-canonical-npm-test.log.txt) (22,983 lines, sha256 `59b3762d04249a3203c9b973d78a6c1c7d5a58e01a4fca3c4f9913a51f405306`).

## 3. M2 timing-test disposition

- The aggregate gate passed on the first and only run, so the authorized conditional **baseline comparison against `e302b39` was not needed and was not performed**.
- Honest scope of that statement: this is one green run. The independent review observed the same test failing (aggregate red; 11/12 when run alone), and this record neither reproduces nor explains that failure. The test and the collision code it exercises remain byte-unchanged from `e302b39` (no Core/collision change, threshold not relaxed, test not skipped/todo'd, no retries). Whether the test is intermittently timing-sensitive on the baseline is **unestablished**; if it fails again in a future canonical run, the owner-specified bounded baseline comparison (branch vs `e302b39`, same machine/Node/command/file) is the pre-authorized next step.
- **Awaiting independent Work re-review** of M1 (fix + tests) and this canonical-gate evidence.

## 4. Boundary confirmation

Work remained limited to T1–T33 remediation of M1/M2. **No** G1–G3, H1–H2, SVF2 verification, OQ-1, host integration, Core / collision / Viewer Adapter / M4 change, commit, push, or next-milestone work was started.
