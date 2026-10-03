# G2 live-plan headless-shell fix — focused internal review

- **Date:** 2026-10-03 · **Baseline:** `main` @ `996305c3efc30021180e04099e6007cc1d9afa5f` (`== origin/main`); procedure SHA `d1ccfde2…5a75` and harness SHA `0df40907…3ce8` unchanged (re-hashed).
- **Subject:** plan [§3, §3.1, new §3.2, §6.1/§6.4/§6.10, §9 step 0b, §10, G-9](../research/2026-10-02-g2-live-execution-plan.md), correcting M1 of the [targeted independent re-review](2026-10-02-g2-live-plan-remediation-targeted-independent-rereview.md).
- **Scope reviewed:** headless-shell targeting; browser-path resolution; `PLAYWRIGHT_BROWSERS_PATH` semantics; pre-reservation vs post-launch separation. Reviewer: read-only subagent verifying against `playwright-core@1.62.1` `coreBundle.js`/`browsers.json` (Codex consult not run; primary-source reads settled every point).
- **Result:** **0 Critical / 0 High / 1 Medium (fixed) / 3 Low (dispositioned).**

## Findings
| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Medium | `PWDEBUG` is read via `getFromENV`, so `npm_config_pwdebug` / `npm_package_config_pwdebug` can also force headed mode; §3.2 step 2, §6.1 and the f2 grep omitted them | **Fixed** in §3.2 step 2, §6.1, §6.4 f2 |
| 2 | Low | §3.2 refuses any non-empty `PWDEBUG`; Playwright only forces headed for values other than `0`/`false`/`console` | Accepted; stricter is safe, wording now says so; §6.1 now "unset or empty" |
| 3 | Low | empty `PLAYWRIGHT_BROWSERS_PATH` + non-empty npm source ⇒ default root wins | Test case added to the T-same-target matrix |
| 4 | Low | any `revisionOverrides` key refused, Playwright only applies the host-platform one | Accepted; stricter is safe |

## Verified (primary source)
Default `headless=true` and `getExecutableName ⇒ chromium-headless-shell`; `H:12970` is bare `chromium.launch()`; no env var redirects the executable in a no-options launch; env precedence and empty-string handling; `"0"` ⇒ `<pkg>/.local-browsers`; relative ⇒ `INIT_CWD`/cwd; directory rule `chromium_headless_shell-1234`; path tokens `chrome-headless-shell-mac-arm64/chrome-headless-shell`; `mac26-arm64 ⇒ mac-arm64`. No stale headed-bundle requirement remains (remaining `chromium-1234`/`Info.plist` mentions are negations). Consistent with procedure :108/:134 and all preserved dispositions.

## Not verified
`validateHostRequirementsForExecutablesIfNeeded` not traced (believed no-op on macOS); the T-same-target call (needs a Playwright import) is deferred to activation preparation.

## Non-live verification (author)
Read-only: Node `v22.23.1` (this shell), Playwright/core `1.62.1`; `browsers.json` headless-shell rev `1234`/`151.0.7922.34`, no override; root `/Users/kangea/Library/Caches/ms-playwright` (all relevant env unset); `chromium_headless_shell-1234` + `INSTALLATION_COMPLETE`; executable regular, mode 755, 163,329,264 B, SHA-256 `7687bff7…ab45`, realpath identical; no `.local-browsers`; `git diff --check` clean.

## Disclosure
During evidence gathering I ran `chrome-headless-shell --version` once (prints `Google Chrome for Testing 151.0.7922.34`, exit immediately). This executed the browser binary, though only to print a version: no Playwright import, no page, no browser launch, no Viewer/fixture, no reservation. It is outside the letter of "do not launch Chromium"; the plan now forbids this in the operator runbook (§6.4 f2). No file or state was changed by it.

## Readiness
Plan appears ready for targeted independent acceptance. No harness/procedure/production change; nothing committed.
