# G2 live-plan remediation — targeted independent re-review

- **Date:** 2026-10-02
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Baseline:** `main` @ `996305c3efc30021180e04099e6007cc1d9afa5f` (`main == origin/main`)
- **Subject:** the bounded remediation in [`docs/research/2026-10-02-g2-live-execution-plan.md`](../research/2026-10-02-g2-live-execution-plan.md)
- **Supporting input:** [`docs/reviews/2026-10-02-g2-live-plan-remediation-internal-review.md`](2026-10-02-g2-live-plan-remediation-internal-review.md)
- **Governing procedure:** SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- **Dormant harness:** SHA-256 `0df40907b054811e34fe7dc55ae166a3f0be34519991193ce28c8ff8d5ce3649`
- **Result:** **0 Critical / 0 High / 1 Medium / 4 carried Low**
- **Verdict:** the PARTIAL wording correction is accepted at the plan level, but the runtime-gate remediation is incomplete. The plan is **not ready for checkpoint commit** until its Chromium pre-reservation contract is corrected.

## 1. Verified state

- `main == origin/main == 996305c3efc30021180e04099e6007cc1d9afa5f`.
- Procedure and dormant-harness hashes are unchanged and match the values above.
- `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`.
- No `G2-LIVE-EXECUTION:` authorization marker exists; the G2 attempts directory and live-evidence set do not exist.
- No Viewer/fixture load or live G2 execution occurred. The working tree contains only the disclosed plan/prompt/review/handoff documentation set; no harness, procedure, test or production file changed.

## 2. PARTIAL verdict remediation

The remediation is consistent across the directly affected plan sections:

- §8 maps a failed cleanup step to `PARTIAL` only when every failed step has `ownership:'resolved'` after re-check.
- unresolved or indeterminate ownership maps fail-closed to procedure row 2 `FAIL`.
- §6.10 keeps exit codes `PASS=0`, `FAIL=1`, `BLOCKED=2`, `PARTIAL=3`; the reader/K remains authoritative.
- §6.11 says a K=`PARTIAL` containing any non-`resolved` cleanup failure is a conformance defect: preserve evidence, reject the verdict, stop and adjudicate; the procedure disposition is `FAIL`.
- C20 `NOT_EVIDENCED` remains a legal row-7 `PARTIAL` cause and is not converted to `FAIL`.

The contradiction is therefore **closed in the plan, but not end-to-end**. The unchanged dormant harness still:

- records a missing or throwing ownership probe as `ownership:'indeterminate'` while leaving `cleanupUnresolvedOwnership=false`;
- gives the real `closeContext` step no `ownershipRemains` probe;
- selects row 7 for any non-empty `cleanupFailures` array without checking that every failure is `resolved`.

The focused cleanup/verdict suites passed **59/59**, confirming the dormant behavior is unchanged; the cleanup suite still explicitly asserts that an indeterminate probe leaves `cleanupUnresolvedOwnership=false`.

### Gate disposition

The harness correction does **not** require a separate earlier milestone or procedure change. It belongs inside the bounded **activation-preparation** task as a prerequisite, exactly as plan §9 step 0(a) now states. Within that task it must be implemented, tested and independently accepted **before** `LIVE_PATH_WIRED` is flipped and before an activation checkpoint is accepted. Owner acceptance of the divergence is not sufficient.

## 3. Medium M1 — the Chromium pre-reservation check targets the wrong installed executable

The Node and package gates are correctly specified:

- `process.version === 'v22.23.1'`;
- both `node_modules/playwright/package.json` and `node_modules/playwright-core/package.json` report `1.62.1`;
- mismatch or unreadable values refuse before W2a/W2b and therefore before reservation, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, browser/Viewer launch or fixture load.

The proposed Chromium check is not sufficient for the harness's actual launch path:

1. The harness calls `chromium.launch()` with no options.
2. Playwright 1.62.1 normalizes omitted `headless` to `true`.
3. Its executable selector returns `chromium-headless-shell` when `headless` is true.
4. The plan instead checks the `browsers.json` **`chromium`** entry and the headed `chromium-1234/.../Google Chrome for Testing.app/Contents/Info.plist`.
5. The actual selected installation is `chromium_headless_shell-1234/.../chrome-headless-shell`, which has no `Info.plist`.

The repository machine demonstrates the distinction: both cache trees exist, both package descriptors currently claim version `151.0.7922.34` / revision `1234`, but they are separate binaries. Checking the headed app cannot establish availability or identity of the headless-shell binary that `chromium.launch()` will use.

Concrete failure mode: the headed Chrome app and its plist satisfy the pre-reservation gate while the headless-shell installation is missing, replaced or inconsistent. W2b then spends the authorization record; Phase-0 `browser-launch` fails or the post-launch `browser.version()` comparison fails. False PASS remains prevented, but the plan's required **non-consuming pre-reservation rejection** is not achieved.

### Minimum plan correction

- State explicitly that the current launch selects `chromium-headless-shell` under default headless mode.
- Make the pre-reservation file-read gate resolve the exact Playwright-selected executable under the effective `PLAYWRIGHT_BROWSERS_PATH`; reject ambiguous/unsupported overrides rather than describing “refuse … then check” in one clause.
- Validate the `chromium-headless-shell` descriptor (`browserVersion=151.0.7922.34`, revision `1234`), installation-complete marker and expected regular executable. Because the headless-shell bundle has no plist, either bind a reviewed SHA-256 for the exact macOS-arm64 executable or explicitly narrow the pre-reservation claim to package/cache provenance and retain `browser.version()` as the definitive actual-version check after launch.
- Preserve the Phase-0 `browser.version()==151.0.7922.34` check. A mismatch there is `PREFLIGHT_FAILED`: the record was already spent at W2b, but `ATTEMPT_CONSUMED` has not occurred and no APS Viewer or fixture has loaded.
- Add activation-preparation tests proving the chosen cache path/executable is the same target Playwright will select, including missing/mismatched headless shell and `PLAYWRIGHT_BROWSERS_PATH` cases.

This is a plan-contract correction. No harness, procedure or production change is authorized by this review.

## 4. Timing and consumption adjudication

The two version checks have different boundaries and must remain described separately:

- Node, Playwright, playwright-core and installed-browser provenance checks: before W2a/W2b; refusal creates no reservation or journal and leaves the record unspent.
- Post-launch `browser.version()` check: Phase 0, after reservation/`AUTH_BOUND`; mismatch writes `PREFLIGHT_FAILED`, spends the record, remains `consumed:false`, and occurs before `ATTEMPT_CONSUMED`, APS Viewer initialization and fixture loading.

Thus a post-launch mismatch does **not** occur “after the attempt-consumption boundary.” It occurs after the record-spending boundary and before the attempt-consumption boundary. The plan itself currently describes this correctly; future wording must preserve that distinction.

## 5. Preserved dispositions

No contradiction was introduced in the previously accepted dispositions:

1. No separate preflight-only mode is required; the manual precheck remains additional defense, not a substitute for hard gates.
2. Model A identity remains the committed URN plus deterministic SHA recomputation; no content/derivative digest is required.
3. `issuedAt`, `expiresAt` and an explicit record version remain optional.
4. Fixed R1–R3 names remain a non-blocking one-attempt durability limitation with mandatory immediate archival.
5. Authorization-record TOCTOU and cleanup-timeout plumbing remain non-blocking Lows; the cleanup-timeout path becomes fail-safe only after the mandatory cleanup-ownership harness correction lands.

## 6. Findings and readiness

- **Critical: 0. High: 0. Medium: 1.** M1 is the wrong Chromium installation/binary in the pre-reservation gate. It blocks acceptance of this central remediation.
- **Low: 4 carried, no new Low:** optional authorization metadata, W1 record TOCTOU, fixed R1–R3 names, cleanup-timeout plumbing.
- **PARTIAL contradiction:** closed in plan wording; still open in the dormant harness and mandatory inside activation preparation before the live flag flip.
- **Hard runtime gates:** Node/Playwright/playwright-core are correctly specified; Chromium is not yet correctly specified for the actual headless executable.
- **Plan checkpoint:** not ready to commit. `git diff --check` is clean, but the Medium requires a bounded plan correction and targeted re-review first.

## 7. Authorization state and next action

- **Activation preparation:** not ready to authorize until the Chromium plan contract is corrected and independently accepted. After that, one bounded activation-preparation task may include the cleanup conformance fix, runtime gates, activation/test migration and independent review; the harness cleanup fix does not need a separate pre-activation milestone.
- **Authorization-record preparation:** not ready. It requires an accepted, committed, clean activated checkpoint and recomputed final HEAD/harness SHA.
- **Live execution:** not ready and remains unauthorized.
- **No new dependency:** no Core, Viewer Adapter, Panel-production, M4, OQ-1 or host work appeared.

The exact next recommended action is an owner-authorized **plan-only Chromium gate correction** limited to the actual default `chromium-headless-shell` selection, cache-path resolution, pre-reservation evidence contract and directly affected handoff/internal-review wording, followed by targeted independent re-review.

Harness/procedure edits, commit, push, activation, authorization-record issuance, reservation/consumption, Viewer launch and live G2 remain unauthorized.
