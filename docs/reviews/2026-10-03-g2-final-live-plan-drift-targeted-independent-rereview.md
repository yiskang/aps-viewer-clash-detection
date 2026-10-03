# G2 final live-plan drift correction — targeted independent re-review

- **Date:** 2026-10-03
- **Scope:** final documentation-only correction to the governing G2 live execution plan and directly affected handoff/review chain
- **Repository state reviewed:** `main` @ `7ae4147b726e20b8183f0522ffabf61ab75895d6`, equal to `origin/main`
- **Verdict:** **0 Critical / 0 High / 0 Medium / 0 Low**
- **Readiness:** **ready for docs-only checkpoint commit/push**; after that clean checkpoint, the exact two-file activation change is ready for a separate owner authorization

## Repository and scope verification

The repository state matches the expected baseline:

- committed harness SHA-256: `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`;
- accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
- `G2_DUAL_COUNTER_GATE.resolved=true` and the real `LIVE_PATH_WIRED=false`;
- no G2 authorization record, attempts directory/reservation state, Viewer/fixture load, or live-G2 evidence exists;
- the working tree contains documentation, review, handoff, and prompt changes only. There is no harness, test, procedure, production, Core, Viewer Adapter, M4, Panel, OQ-1, or host-implementation diff.

`git diff --check` is clean. No test or scratch simulation was rerun because this correction changes documentation only and the accepted scratch result is unchanged.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

None.

## Targeted adjudication

### 1. §9 step 0 — accepted

Plan §9 step 0 now has three distinct operational states:

1. completed and independently accepted in committed checkpoint `7ae4147`;
2. pending before the real flag flip;
3. pending after the real flag flip.

The completed bucket correctly includes G-8 cleanup/PARTIAL conformance, the hard runtime gates, headless-shell resolution, `T-same-target`, `SELENIUM_REMOTE_URL` redaction, isolated-copy testing, and the reviewed two-edit scratch simulation. None is still described in §9 as implementation work to perform before activation.

The pre-flip bucket contains only the current targeted acceptance, the separately authorized docs-only checkpoint commit/push, and a later separate owner authorization for the real flip. The post-flip bucket contains offline verification, independent review, the activation commit, identity recomputation, authorization-record issuance, and later live-execution authorization. The rest of §9 follows this separation without contradiction.

### 2. Coupled stale-text cleanup — accepted

The corrected wording in §3, §3.1, §3.2, §8, G-7, G-8, G-9, G-14, and §12 consistently treats the committed runtime gates and G-8 conformance as implemented and accepted. G-7 is now only the retained timeout-plumbing Low; G-14 explicitly excludes closed G-8; §12 no longer schedules the accepted work for reimplementation.

No remaining plan wording would direct an activation operator to redo the accepted runtime-gate or cleanup-ownership work.

### 3. G-15 — accepted

The unsupported `g2-live-authorization.md` filename rule is absent. No substitute filename restriction was introduced. The remaining requirements are supported by the existing clean-tree/W1 contract: the record is untracked and is the sole non-superseded `G2-LIVE-EXECUTION:` candidate under `docs/prompts/` matching the supplied path.

The plan also accurately preserves CLI isolation: tests use temporary isolated harness copies and do not invoke the real harness or create real attempt/reservation state.

### 4. Current and historical baselines — accepted

The plan names `7ae4147b726e20b8183f0522ffabf61ab75895d6` as the current activation baseline. Every `996305c…` occurrence is explicitly historical or evidentiary and is not usable as the activation baseline.

The H-reference convention is sufficiently unambiguous: current references default to `7ae4147` unless commit-qualified or labelled historical; §2–§8 references are explicitly labelled as historical where applicable; symbol or constant names remain authoritative locators.

### 5. §10 historical record — accepted

Section 10 explicitly labels its table as historical verification at `996305c` and points to the §9-linked current-baseline activation-preparation reviews for the accepted `7ae4147` evidence. The handoff and this review complete the current authority chain, so the historical table cannot reasonably be mistaken for the current activation checkpoint.

### 6. Exact activation diff — preserved

The future activation remains exactly two repository edits:

1. in `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`, change `LIVE_PATH_WIRED` from `false` to `true`;
2. in `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`, update the single deliberate real-state pin's title and two assertions to expect `true`.

No third implementation or test edit is required by the corrected plan. The actual committed harness still has `LIVE_PATH_WIRED=false`.

### 7. Accepted dispositions — preserved

The correction does not alter G-2, the scratch-only `build:vendor` setup rule, exact Node `v22.23.1` prerequisite, runtime hard-gate behavior, Playwright/browser-root resolution, `T-same-target`, cleanup/PARTIAL precedence, Selenium URL redaction, evidence schema, authorization/attempt semantics, executable-SHA disposition, post-launch `browser.version()` check, scratch-flip result, or CLI-isolation architecture.

The codebase graph independently confirms that `main()` still calls activation parsing, hard runtime gates, authorization validation, attempt-directory scanning/reservation, and post-reservation execution in the expected dependency chain. Direct source inspection confirms the current flag/gate values and hashes.

### 8. Internal-review quality — accepted as supporting evidence

The internal review's reported **0 Critical / 0 High / 0 Medium / 1 Low fixed** is accurate in this bounded scope. Its fixed Low—the nonexistent `§9.2` reference—is now `§9 step 2`. No other stale cross-reference was found that could redirect the activation operator.

## Readiness and authorization

### Docs-only checkpoint

The corrected plan, supporting reviews/prompts, and updated handoff are ready for a **docs-only checkpoint commit and push**. The checkpoint must retain `LIVE_PATH_WIRED=false`; it must not include any harness, test, or procedure change.

### Real flag flip after the checkpoint

After the accepted docs checkpoint is committed and pushed and a clean-tree/current-HEAD check confirms that checkpoint, the project is technically ready for a **separate owner authorization** of the exact two-file flag flip.

No additional harness correction, procedure correction, scratch run, or test migration is required between those gates. During the separately authorized activation work, the operator must use exact Node `v22.23.1`, make only the two reviewed edits, rerun the required offline verification, obtain independent review, commit/push the activated checkpoint, and recompute the final HEAD/harness SHA before any authorization record is issued.

Authorization-record issuance, attempt reservation/consumption, Viewer/fixture loading, and live G2 remain later, separate owner gates.

## Recommended next authorized action

Authorize one docs-only checkpoint commit and push containing the corrected governing plan, its review/prompt records, and the updated handoff while keeping `LIVE_PATH_WIRED=false`. Do not combine that checkpoint with the later two-file activation.
