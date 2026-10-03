# G2 headless-shell live-plan fix — targeted independent re-review

- **Date:** 2026-10-03
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Baseline:** `main` @ `996305c3efc30021180e04099e6007cc1d9afa5f` (`main == origin/main`)
- **Subject:** only the headless-shell/runtime-binding remediation and directly affected sections of [`docs/research/2026-10-02-g2-live-execution-plan.md`](../research/2026-10-02-g2-live-execution-plan.md)
- **Supporting records:** [`docs/reviews/2026-10-03-g2-headless-shell-plan-fix-internal-review.md`](2026-10-03-g2-headless-shell-plan-fix-internal-review.md), the prior [targeted independent re-review](2026-10-02-g2-live-plan-remediation-targeted-independent-rereview.md), and [`docs/handoffs/latest.md`](../handoffs/latest.md)
- **Governing procedure SHA-256:** `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (unchanged)
- **Dormant harness SHA-256:** `0df40907b054811e34fe7dc55ae166a3f0be34519991193ce28c8ff8d5ce3649` (unchanged)
- **Result:** **0 Critical / 0 High / 0 Medium / 2 Low**
- **Verdict:** the headless-shell correction is accepted. The plan is ready for a documentation checkpoint commit, and the bounded activation-preparation task is ready for separate owner authorization. Authorization-record preparation and live G2 execution are not ready.

## 1. Verified repository and authorization state

- `main == origin/main == 996305c3efc30021180e04099e6007cc1d9afa5f`.
- `G2_DUAL_COUNTER_GATE.resolved === true`; `LIVE_PATH_WIRED === false`.
- The procedure and dormant-harness hashes match the values above. No harness, procedure, test, production, Core, Adapter, Panel, M4, OQ-1, or host file differs from `HEAD`.
- No valid `G2-LIVE-EXECUTION:` authorization record, G2 attempts directory, reservation, journal, or live G2 evidence exists. No attempt is reserved or consumed.
- The working tree contains only the disclosed plan/prompt/review/handoff documentation set. `git diff --check` is clean.

## 2. Actual Playwright runtime target

The correction now matches both the dormant harness and Playwright 1.62.1:

1. The harness calls bare `chromium.launch()` (`clashpanel-viewerbridge.acceptance.mjs:12967-12971`).
2. Playwright 1.62.1 `_validateLaunchOptions` defaults omitted `headless` to `true`.
3. Chromium `getExecutableName` returns `chromium-headless-shell` when `headless` is true and no channel or executable override is supplied.
4. `browsers.json` identifies `chromium-headless-shell` revision `1234`, browser version `151.0.7922.34`.
5. Its macOS-arm64 executable tokens are `chrome-headless-shell-mac-arm64/chrome-headless-shell`, yielding `<root>/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`.

The old headed `chromium-1234`/`Info.plist` check has been removed as a requirement. Remaining headed-bundle references explicitly say it is neither required nor sufficient.

## 3. Browser-root and environment resolution

The plan correctly reproduces Playwright 1.62.1's relevant behavior and makes conservative fail-closed restrictions explicit:

- `getFromENV('PLAYWRIGHT_BROWSERS_PATH')` precedence is the direct variable, `npm_config_playwright_browsers_path`, then `npm_package_config_playwright_browsers_path`; the first defined value wins. A winning empty string selects the default macOS root. The plan correctly handles the case where direct empty masks a non-empty npm fallback.
- Unset/empty selects `~/Library/Caches/ms-playwright`; `0` maps in Playwright to `playwright-core/.local-browsers`; relative values resolve against `INIT_CWD || cwd`. The G2 plan deliberately accepts only unset/empty or one normalized absolute override, rejecting `0`, relative/non-normalized paths, conflicting non-empty sources, and a coexisting `.local-browsers` tree. Those rejections are stricter than Playwright but cannot select the wrong executable or create a false PASS.
- `PWDEBUG` uses the same direct/npm fallback chain. Playwright values other than `0`, `false`, or `console` force inspector/headed mode. Rejecting every non-empty direct/npm `PWDEBUG` value is conservative and safe.
- `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` is read directly by Playwright and can change the path tokens. Rejecting any non-empty override before reservation is correct.
- The current environment has all seven relevant variables unset. The expected marker is a regular file; the expected executable is a non-symlink regular executable, 163,329,264 bytes, with identical realpath. No local-browser tree exists.

The file-only gate is sufficient for the stated pre-reservation claim: exact package versions, exact descriptor/revision metadata, installation marker, and availability/provenance of the exact executable Playwright is expected to select. It deliberately does not claim to prove the executable bytes' runtime version.

## 4. Findings

### Low L1 — `T-same-target` wording conflates accepted and rejected environment cases

Plan §3.2 says the resolver's `E` equals Playwright's selected executable “for each env case,” then includes cases the resolver is required to reject (`0`, relative/non-normalized paths, conflicting sources, `PWDEBUG`, and platform override). A rejected case has no `E`, so literal equality is not a realizable assertion.

This does not change the resolver contract or block the documentation checkpoint. During activation preparation the test must be split mechanically:

- for accepted cases, assert exact path equality with Playwright's `chromium-headless-shell` registry entry; and
- for rejected cases, assert refusal occurs before W2a/W2b and before any Playwright/browser import or launch.

Playwright-core 1.62.1 exposes the needed no-launch oracle through the exported `playwright-core/lib/coreBundle` registry (`registry.findExecutable('chromium-headless-shell').executablePath()`). Public `chromium.executablePath()` is not the correct oracle because it names the headed `chromium` entry. `T-same-target` is therefore **required during activation preparation**, not before this plan checkpoint and not optional.

### Low L2 — the internal review's current-Node statement is stale

The internal review says its shell was Node `v22.23.1`; the independently observed current command environment is `/opt/homebrew/bin/node` at `v26.10.0`. Playwright and playwright-core are both `1.62.1`.

This is an evidence-record accuracy issue, not a plan defect: the plan requires a future hard equality gate for `v22.23.1`, so the current environment would correctly refuse before reservation. The required Node runtime must be selected before any future live authorization is executed.

## 5. Binary identity and SHA disposition

An executable SHA-256 is **not required** by the accepted G2 envelope:

- **Runtime-version correctness:** established definitively after launch by strict `browser.version() === '151.0.7922.34'`.
- **Package/cache provenance:** established before reservation by exact Playwright/playwright-core versions, the exact headless-shell descriptor/revision, marker, resolved root, realpath, file type, non-symlink property, nonzero size, and executable permission.
- **Binary integrity against local tampering:** would require an owner-maintained binary digest, but that is a stronger threat model than the repository currently uses.

Binding the observed SHA would couple authorization to one local installation and force a plan/record update after a legitimate reinstall of the same pinned Playwright browser. The plan correctly records the observed digest as informational and keeps the post-launch version check fail-closed. An owner may add a digest later as defense in depth, but it is not a prerequisite.

## 6. Post-launch and attempt semantics

The two boundaries are consistently separated:

- File/env/package checks fail before W2a/W2b: no D2, reservation, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, browser, Viewer, or fixture; the record remains unspent.
- `browser.version()` runs in Phase 0 after W2b/`AUTH_BOUND` and before W3/`ATTEMPT_CONSUMED`. A mismatch becomes `PREFLIGHT_FAILED`, leaves `consumed:false`, spends the record, loads no Viewer/fixture, and permits no retry with that record.

This matches the accepted attempt semantics. “Record spent” and “attempt consumed” remain distinct.

## 7. `chrome-headless-shell --version` scope breach

Executing `chrome-headless-shell --version` during planning violated the explicit no-execution process boundary. It did not invoke the G2 harness, create/validate an authorization record, reserve or consume an attempt, import Playwright, create a page, load Viewer/fixtures, or produce live G2 evidence. Repository inspection shows no G2 attempt artifacts or code changes.

The output is not needed for plan acceptance: the plan's pre-reservation claims come from package/descriptor/file inspection, and its definitive runtime check remains the future post-launch `browser.version()`. The command therefore does not contaminate the accepted plan evidence and no re-execution, retry, or cleanup is technically necessary. The stronger internal-review claim that it changed “no file or state” cannot be proved globally; the supportable statement is that no repository, authorization, attempt, Viewer, or G2 evidence state was created.

## 8. Readiness and authorization

- **Headless-shell targeting:** fully corrected.
- **Browser-path resolution:** mechanically sound, with deliberate fail-closed restrictions; L1 governs the future test shape.
- **Plan checkpoint commit:** technically ready, including this review and the updated handoff. Commit/push remain unauthorized.
- **Activation preparation:** ready for a separate owner authorization. It must implement and test the existing cleanup-verdict conformance fix, the hard Node/Playwright/headless-shell gates, and `T-same-target`; it must obtain independent acceptance before flipping `LIVE_PATH_WIRED`.
- **Authorization-record preparation:** not ready. It requires the accepted activated harness checkpoint to be committed and clean, with final HEAD/harness hashes recomputed.
- **Live G2:** not ready and unauthorized. Remaining prerequisites are activation-preparation implementation/review; clean checkpoint/digest rebinding; selecting Node `v22.23.1`; separate record issuance; and separate exactly-one-run authorization.

## 9. Exact next action

The next owner decision is whether to authorize a documentation-only checkpoint commit of the plan/reviews/handoff. After that commit, the next technical action is a separately authorized bounded activation-preparation task; no activation flag, authorization record, reservation, browser/Viewer load, or live G2 execution belongs in the checkpoint commit.
