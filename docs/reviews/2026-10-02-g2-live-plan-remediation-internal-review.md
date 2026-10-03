# G2 live-plan remediation — focused internal review

- **Date:** 2026-10-02 · **Baseline:** `main` @ `996305c3efc30021180e04099e6007cc1d9afa5f` (== origin/main) · procedure SHA `d1ccfde2…5a75`
- **Subject:** [plan](../research/2026-10-02-g2-live-execution-plan.md) as remediated under `docs/prompts/for-claude-g2-live-plan-remediation-only.md`, against the [independent review](2026-10-02-g2-live-execution-plan-independent-review.md) (H1, M1) and procedure §8 rows 1-8.
- **Reviewer:** read-only Opus subagent; supporting input only, not independent-gate authority.
- **Result:** **0 Critical / 1 High / 0 Medium / 5 Low** — the High and all Lows were fixed in the plan (documentation only).

## Corrections made
1. **H1 / PARTIAL contradiction — resolved in the plan.** Plan §8 and §6.10-11 now state only procedure-valid mapping: PARTIAL only for row-7 causes (incl. C20 `NOT_EVIDENCED`, N2/N8 `NOT_DISCRIMINATING`, N6/N8 `NOT_APPLICABLE`, or a failed cleanup step with ownership **resolved on re-check**); indeterminate cleanup ownership ⇒ row 2 FAIL (fail-closed); a K reading PARTIAL with any non-`resolved` cleanup ownership is a conformance defect to be adjudicated, not accepted. Consistency note maps outcomes to procedure rows; no new verdict state. Residual: the dormant harness still diverges (G-8); mechanical conformance is a mandatory activation-preparation item (§9 step 0a). No procedure amendment.
2. **M1 / runtime gates — specified in plan §3.1.** Node `v22.23.1`, Playwright `1.62.1`, Chromium `151.0.7922.34` are hard preflight gates in the activated harness (not manual), rejecting mismatch/unavailable, before reservation/`AUTH_BOUND`/`ATTEMPT_CONSUMED`/Viewer/fixture load. Retained as refusal output (stderr/O1) pre-reservation, and in `PREFLIGHT_FAILED` detail for the Phase-0 re-check. Versions bound via harness SHA; record schema unchanged. OS/APFS stay attested/recorded (Work disposition).

## Finding HA (High) and fix
My first §3.1 draft detected Chromium by importing Playwright and spawning the executable `--version` before W2a. The reviewer showed this contradicts the accepted procedure (:108 W1 touches no browser; :134 Playwright import/launch only after `AUTH_BOUND`; source-order tests pin it), which would have forced a procedure amendment. **Fix:** pre-reservation checks are reads/pure only (`process.version`; both Playwright `package.json`; `browsers.json` `browserVersion`/`revision` + installed bundle `Info.plist`; refuse on path overrides); `browser.version()` strict equality stays in Phase-0 `browser-launch` (→ `PREFLIGHT_FAILED`). Playwright import is not moved.

## Lows fixed
La dangling §13 ref; Lb T8 "only if unresolved" now includes indeterminate; Lc G-7 "fails safe" qualified until step 0a; Ld consistency note includes non-row FAILs; Le OS row "operator-attested", G-6/G-7 labels aligned with Work (Low).

## Checks
Preserved dispositions not reopened (no preflight-only mode, Model A identity, optional metadata, fixed R1–R3, other Lows). Activation boundary intact: `resolved=true`, `LIVE_PATH_WIRED=false`; activation, record issuance and execution each separately authorized. Reviewer's cross-references resolve after La fix. No harness/test/procedure/production change.
