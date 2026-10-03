# G2 activation preparation — focused internal review

- **Date:** 2026-10-03 · **Baseline:** `main` @ `87dac9d63feab7b13e9b2dba2d9e7cba20d266ea`. This review covers the **uncommitted** activation-preparation working tree: 21 modified acceptance files including the harness, plus the untracked files `test/acceptance/support/{g2-harness-copy,g2-runtime-gate-fakes}.mjs`, `*.runtime-gates.test.mjs`, `*.live-path-isolation.test.mjs` and the authorizing prompt.
- **Authority:** [`docs/prompts/for-claude-g2-activation-preparation-only.md`](../prompts/for-claude-g2-activation-preparation-only.md); [live execution plan](../research/2026-10-02-g2-live-execution-plan.md) §3.1, §3.2, §8, §9.
- **Boundary:** the activation-preparation diff only. This was not an unrestricted review of the pre-existing harness. No live action was taken. `LIVE_PATH_WIRED=false` (H:119) and `G2_DUAL_COUNTER_GATE.resolved=true` (H:3714). No authorization record, no attempt, no browser, Viewer or fixture.
- **Result:** **0 Critical / 1 High (fixed) / 2 Medium / 6 Low.** Line numbers (H = harness) refer to the final working tree.

## Method

1. Read the harness diff and every new or changed test and support file relevant to the dimensions below. Harness areas: runtime gates H:202-451; `main()` gate call H:13632; row 2 / row 7 H:4444-4504; `runCleanup` H:7351-7386; Phase-0 `browser-launch` H:13224-13235.
2. Checked Playwright semantics against the primary source, `node_modules/playwright-core/lib/coreBundle.js` (1.62.1):
   - `getFromENV` (:7806)
   - `calculatePlatform` (:8144-8171)
   - registry root, `"0"`, relative and default-cache handling (:32815-32836)
   - `_validateLaunchOptions` headless default and `PWDEBUG=inspector` (:39625)
   - `SELENIUM_REMOTE_URL` (:39409, plain `process.env`)
   - the env-var inventory. No other variable redirects the executable for a bare `chromium.launch()`.
3. Ran the real resolver read-only on this host (no Playwright import, no spawn). Result: `ok:true`.
   - Node `v22.23.1`; playwright and playwright-core `1.62.1`; Darwin `27.0.0`; Apple CPU.
   - Root `default` = `/Users/kangea/Library/Caches/ms-playwright`.
   - E = `…/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`, 163,329,264 B.
   - Descriptor `1234`/`151.0.7922.34`, no `revisionOverrides`.
   - Playwright resolves to `<repo>/node_modules/playwright/index.mjs`.
4. Ran the focused G2 suite before and after the fix. Snapshotted `git status --porcelain` before and after each run, and checked for any real attempts directory or record.
5. Ran one `codex-advisor` (medium) consult (see "Second opinion").

## Findings

| # | Sev | Where | Finding | Disposition |
| --- | --- | --- | --- | --- |
| H1 | **High** | H:296-306 (package reads) vs H:13644 (`import('playwright')`) | **Shadow-package bypass of the §3.1 Playwright gate.** The gate read only `<repoRoot>/node_modules/{playwright,playwright-core}/package.json`. The later bare `import('playwright')` resolves from `test/acceptance/`, so Node finds `test/acceptance/node_modules/playwright` or `test/node_modules/playwright` first. Both paths are git-ignored (`.gitignore:480 node_modules/`, confirmed with `git check-ignore`), so the Phase-0 clean-tree check would not see them. The post-launch `browser.version()` is **not** a sufficient backstop: a shadow Playwright of another version that launches the same `151.0.7922.34` binary passes it. The run would then continue on an unapproved Playwright after the record is spent, and R1 `runtimeEnvelope.playwright` (root path, H:13223) would misrecord the version. The gate meets the plan's literal file list but breaks the §3.1 invariant that every actual runtime value is detected (Codex concurred). Nothing like this exists today. | **Fixed** (see "Fixes applied"). |
| M1 | Medium | H:13632 → H:13224-13235 | **Time-of-check/time-of-use (TOCTOU) gap** between the pre-reservation gate and the post-B3 import/launch. Packages, `browsers.json`, the install tree or the executable can change after the gate passes. Chromium drift is caught by the post-launch `browser.version()` (`PREFLIGHT_FAILED`, `consumed:false`, record spent). Package drift after the gate is not re-checked after import. | **Accepted residual.** This is inherent to a file-level pre-check (plan §3.2 "Residual limit"). Mitigation: operator pre-check §6.4 f/f2 and no concurrent installs. |
| M2 | Medium | whole diff | **Flip simulation not run.** The claim that only the single pin (`live-path-isolation.test.mjs:50-53`) needs editing at the flip was **not tested empirically**: a scratch-copy flip simulation was blocked by this session's permission classifier. Static evidence supports the claim: the shared `forceLivePathWired` helper; the static guard `live-path-isolation.test.mjs:150-191`, whose planted violations all trip it; and every remaining `LIVE_PATH_WIRED` assertion in tests runs on a forced copy. | **Verification gate** for the activation change: run the flip in an isolated copy before or within the authorized `LIVE_PATH_WIRED=true` change. |
| L1 | Low | H:306, H:329-339 | **Extra stricter refusals beyond the plan:** nested `playwright-core`, `SELENIUM_REMOTE_URL`, and the host check (Darwin major ≥ 20 + Apple CPU). Each mirrors Playwright 1.62.1 source (`calculatePlatform` :8144-8171, `launch` :39409). None refuses the intended host (the live resolver run returned `ok:true`). The plan's runbook (§6.1, §6.4 f2) does not mention `SELENIUM_REMOTE_URL`, so an operator could hit a non-consuming refusal it does not foresee. | Accepted: fail-safe, pre-reservation, record unspent. Optionally add it to the runbook grep. |
| L2 | Low | H:329 | `process.arch!=='arm64'` is refused, but Playwright keys only on OS release + CPU model; an x64 Node under Rosetta would still get the arm64 executable. Stricter than Playwright, and it matches plan §3.2 step 1. | Accepted. |
| L3 | Low | H:403-407 | `realpath(E)===E` refuses any symlinked ancestor of the root (e.g. `/tmp/...` on macOS), which Playwright itself would launch. This is exactly plan §3.2 step 6, and the default root on the target host has no symlink. | Accepted (plan-literal). |
| L4 | Low | H:419-436 | The O1/stderr report prints env values verbatim. For example, a credentialed `SELENIUM_REMOTE_URL` would land in the operator log. | Accepted; the runbook expects these variables unset. |
| L5 | Low | H:7376-7379 (pre-existing) | `ownershipRemains()` is judged by truthiness, so a probe returning `undefined` or `0` maps to `resolved`. The probes actually wired (H:13078-13103) return booleans or throw, so no current path reaches PARTIAL this way. | Accepted; not introduced by this diff. |
| L6 | Low | H:13358 | On a post-launch mismatch, the detected version is carried in the `PREFLIGHT_FAILED` journal `reason` string and in in-memory `state.runtimeEnvelope.chromium`. No R1 is produced on the Phase-0 path, whereas plan §3.1 item 3 says "journal detail and R1 `runtimeEnvelope`". Attempt semantics are unchanged. | Accepted; wording-level divergence only. |

## Fixes applied (H1)

| File | Lines | Change |
| --- | --- | --- |
| `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` | 266-267 | New injectable seam `resolvePlaywrightEntry`, defaulting to `() => import.meta.resolve('playwright')`. This is resolution only, with no module evaluation, from the harness file itself, so it targets the module `main()` will import. |
| same | 307-322 | New check: the resolved `file:` URL is realpath'd and must lie inside realpath(`<repoRoot>/node_modules/playwright`). Otherwise, or if resolution throws or returns a non-`file:` value, it refuses with `runtime-version-mismatch` at step `playwright-resolution` (pre-W2a, no write). `detected.playwrightEntry` is recorded. |
| same | 426 | The O1 report line for `playwright` now also prints `resolvedEntry`. |
| `test/acceptance/support/g2-runtime-gate-fakes.mjs` | 11, 76-77, 104-106 | The fake world gets a `node_modules/playwright` dir and `index.mjs`, and a `resolvePlaywrightEntry` seam pointing inside it. |
| `test/acceptance/clashpanel-viewerbridge.acceptance.runtime-gates.test.mjs` | 26, 45-46, helper call sites | `ROOT_PW(repoRoot)` seam for temp-repo cases. |
| same | 262-308 | Two new tests. (1) Real Node resolution from an isolated harness copy, using the default resolver: no shadow passes; shadows under `test/acceptance/node_modules` and `test/node_modules` refuse; zero writes. (2) A throwing, non-file, `null` or out-of-package resolver refuses. |

The intended host still passes: real resolver `ok:true`, entry `<repo>/node_modules/playwright/index.mjs`. The static no-import, no-spawn guard over the gate functions still passes.

## Dimension verdicts

- **Runtime hard gates (§3.1): conforms after H1** (subject to M1).
  - Strict equality for Node `v22.23.1`, `playwright`/`playwright-core` `1.62.1` (`name` also checked), and headless-shell `1234`/`151.0.7922.34`. The headed `chromium-1234` is never gated.
  - Called once in `main()`, after W1 (record + startup scan) and before `buildBindingRecord`, W2a, W2b and the import (H:13632). The order is pinned by static tests in `activation.test.mjs` and `runtime-gates.test.mjs`.
  - The gate functions contain no import, require, spawn, exec, write or `--version`. The default fs seam exposes only four read methods.
- **Browser, path and env resolution (§3.2): conforms.**
  - Source precedence is `PLAYWRIGHT_BROWSERS_PATH`, then `npm_config_…`, then `npm_package_config_…`. A defined-but-empty value falls back to the default root, matching `getFromENV` + `if (envDefined)`.
  - Refused: differing non-empty sources; `"0"`; relative paths; non-normalized paths (`..`, `//`, trailing `/`, NUL); a `.local-browsers` dir alongside the default root; any non-empty value in the three `PWDEBUG` sources or `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`.
  - Descriptor: exactly one entry, no `revisionOverrides`.
  - Install: marker is a regular file; E is a regular non-symlink file, realpath-equal, size > 0, `X_OK`.
  - No scanning and no guessing between candidates.
- **T-same-target: conforms.**
  - The oracle is `playwright-core/lib/coreBundle` `registry.registry.findExecutable('chromium-headless-shell').executablePath()`, run in a child `node -e` with exactly the case's env and no launch. It is **not** the public `chromium.executablePath()`.
  - Every plan case is classified, and coverage is checked against the plan paragraph.
  - Accepted cases assert path equality. Rejected cases assert pre-reservation refusal and do not assert path equality.
  - An oracle sanity test proves the case env is actually applied. Oracle cases skip on hosts other than darwin/arm64; they ran here.
- **Cleanup-ownership verdict (§8, G-8): conforms.**
  - A missing probe, a throwing probe and a not-configured step each record `ownership:'indeterminate'` **and** set `cleanupUnresolvedOwnership=true`.
  - Row 2 also fires on any failure whose ownership is not exactly `'resolved'`. Row 7's cleanup reason applies only when **every** failure is `'resolved'`.
  - Covered by the G-8 tests in `cleanup.test.mjs` and `verdict.test.mjs`. C20 `NOT_EVIDENCED` still gives row 7 PARTIAL.
  - No new verdict state or row. The only addition is one row-2 reason string, which no whitelist references.
- **Activation and pinning test safety: conforms** (flip simulation: M2).
  - There is a single pin. Every other suite forces the flag on copies written to realpath'd `os.tmpdir()` roots, which are asserted to lie outside the repo, and each copy's `REPO_ROOT` is checked to be its own root.
  - CLI tests never spawn the real harness. A loud guard enforces this, and a test proves the guard fires. `GIT_CEILING_DIRECTORIES` is set.
  - Authorization-shaped fixtures exist only in isolated roots and carry fake HEAD/SHA values. Real `main()` is never called on the real module (static guard). A test shows a coincidental record in another tree is never consumed.
- **Post-launch `browser.version()`: conforms.** Strict equality is checked inside `p0('browser-launch')`, before `context-create`. A mismatch or missing value goes to `Phase0Failure` → `PREFLIGHT_FAILED` with `consumed:false`; browsers are closed best-effort and the exit code is 1 (H:13353-13367). Attempt semantics are unchanged.
- **Procedure consistency: unchanged.** `git diff --stat` of the procedure is empty, and its SHA-256 is `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- **Journal and evidence side effects: none found.** The gate runs pre-W2a and writes nothing. After the suite, `git status --porcelain` was identical, with no `test/acceptance/results/clashpanel-viewerbridge-g2-attempts` and no `^G2-LIVE-EXECUTION:` record under `docs/prompts/`.

## Schema-carry statement

R1 `runtimeEnvelope` and the journal/reservation binding keys (`BINDING_KEYS`) are fixed whitelists. The extra §3.2 provenance therefore goes **only** to stderr (operator O1 log), via `formatG2RuntimeGateReport`, and into `G2RefusalError.detail` on refusal. That provenance covers: root source, root, D, E, marker, executable size, descriptor values, env sources, OS release, the CPU flag, and the resolved Playwright entry. No schema was extended and no procedure semantics changed, consistent with plan §3.2 step 8.

## Residual limits

- **Executable SHA not bound.** The pre-reservation gate proves provenance and availability only. A replaced binary under the correct names is caught only by the post-launch `browser.version()`, by which point the record is spent. See plan §3.2 "Residual limit"; the owner may elect to bind SHA-256 `7687bff7…ab45` later.
- **TOCTOU** between the gate and import/launch (M1). The H1 fix checks resolution at gate time; it cannot prevent a change made afterwards.
- `NODE_OPTIONS` loaders/`--import` hooks could still intercept resolution. That is operator-environment territory, outside this gate.
- Flip simulation not run (M2).

## Second opinion

`codex-advisor` (medium, request `20261003-140256-15845-3749`) was asked about the shadow-resolution severity and to look for any other Critical/High defect.
- It rated the shadow resolution **High**. The decisive point was that the post-launch check does not catch a shadow Playwright that launches the same browser build.
- It recommended a resolution-only `import.meta.resolve` check confined to the realpath of `<repoRoot>/node_modules/playwright`, with a test seam. That is what was implemented, and both shadow locations are tested.
- It found no other Critical/High: the intended host passes, copy isolation is sound, and indeterminate ownership cannot reach PARTIAL.

I independently re-checked each claim against the source before acting on it.

## Verification (this review)

| Command | Result |
| --- | --- |
| `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` (before fix) | exit 0; 899 / 899 pass |
| same (after fix) | exit 0; **901 tests, 901 pass, 0 fail, 0 skipped** |
| `git status --porcelain` before vs after each run | identical |
| real attempts dir / `^G2-LIVE-EXECUTION:` under `docs/prompts` | none |
| `git diff --check` | clean |
| procedure `git diff --stat` / SHA-256 | empty / `d1ccfde2…5a75` |
| harness SHA-256 (final working tree) | `c9ba6a54d754a00c1afc1bb417d434b7fd84ced9736dad5e29e86add2eeae649` (HEAD: `0df40907…3ce8`; pre-review working tree: `26dcc39f…6f95`) |

## Readiness

No Critical/High blocker remains at this abstraction level. H1 is fixed. M1 is an accepted residual, and M2 is a verification gate for the flip. Lows are dispositioned. Ready for independent Work review of activation preparation. Nothing has been committed and the live path is still disabled.
