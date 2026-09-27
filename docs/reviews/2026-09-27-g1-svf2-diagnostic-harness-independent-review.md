# Bounded independent review — G1 SVF2 non-production diagnostic harness evidence

- **Date:** 2026-09-27
- **Scope:** adjudicate the evidence in `test/acceptance/g1-svf2-initializer-diagnostic.mjs`, `docs/research/2026-09-27-g1-svf2-diagnostic-harness-result.md`, `docs/research/evidence/2026-09-27-g1-svf2-initializer-diagnostic-result.json`, and the related `docs/handoffs/latest.md` entries. Does not re-run anything, does not modify production code, does not run F1–F8, does not start G2/G3/H1/H2/OQ-1/host integration.
- **Method:** three independent checks run in parallel, then adjudicated together — (1) a fresh Claude subagent re-deriving every claim directly from the source/JSON files (not from the write-up's prose); (2) `codex-review` (type `code`, effort `medium`) on the harness script itself; (3) `codex-advisor` (effort `medium`) on the three substantive adjudication questions (sufficiency of a single run, whether SwiftShader could produce a false positive, whether the isolated-harness pattern is faithful for F1–F8). Per this repo's CLAUDE.md, Codex was used as the independent reviewer/advisor rather than the native advisor tool.
- **Not committed** — consistent with the two preceding G1 diagnostic tasks in this chain, this review and its handoff update are left in the working tree pending explicit push/commit authorization.

## 1. Isolation from production — CONFIRMED

Independently verified (subagent, direct grep/read; corroborated by codex-review's own read):
- The harness imports only `playwright`, `node:fs/promises`, `path` — no reference to `wwwroot/` anywhere except explanatory comments.
- Not referenced anywhere in `package.json` scripts, `server.js`, or `routes/*.js`. `page.route('**/__g1-diagnostic__', ...)` is a client-side Playwright interception, never an Express route.
- `wwwroot/viewer.js:23` is byte-for-byte unchanged: `Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, ...)` — no `api` key, confirmed no other `Initializer(`/`AutodeskProduction2`/`streamingV2` string exists anywhere under `wwwroot/`.
- `git status` confirms every new/changed file is uncommitted, as claimed.

## 2. Controlled comparison — CONFIRMED

Verified from the script source itself (not the write-up's prose): the diagnostic's `Autodesk.Viewing.Initializer({ env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken }, ...)` (lines 73–75) is the only change from production's initializer. `VIEWER_VERSION = '7.124.2'` matches `wwwroot/index.html`'s pinned URLs exactly. `MODEL_URN` is the pre-existing Room Locator model; a full grep for `POST`/`upload`/`translate` in the script finds zero mutating calls — its only network activity is the pre-existing `GET /api/auth/token` and read-only `Document.load`/`loadDocumentNode`.

## 3. Retained evidence — CONFIRMED, no embellishment

Read directly from the JSON (not the doc's table): `runtime.isOTG: true`, `runtime.isSVF2: true`, `runtime.is3d: true`, `loadOutcome: "success"`, `consoleErrors: []`, `pageErrors: []`, `model.priorLegacyResult: {isOTG: false, is3d: true}`. Run duration 10.49s (doc's "~11 seconds" is accurate, not inflated). The subagent additionally diffed the git-ignored raw script output against the retained `docs/research/evidence/` copy — **byte-for-byte identical**, ruling out post-hoc editing. No hidden error/warning field exists in the JSON; the write-up's summary table reproduces every value exactly.

## 4. Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | **High** | The harness's H2/H4 classifier (`g1-svf2-initializer-diagnostic.mjs:165-173`) misclassifies edge cases: `isOTG()===false` with `isSVF2()` unavailable should be H2 (decisive negative evidence exists) but the code produces H4; if *both* APIs are unavailable it should be H4 but the code's final `else` produces H2. (codex-review) | **Accepted as a real defect — does not affect the recorded H1 result** (both `isOTG` and `isSVF2` were `true` in this run, so the `if (otgTrue \|\| svf2True)` branch is unambiguously correct here). **Must be fixed before this harness pattern is extended for F1–F8**, since F1–F8 will re-assert this same precondition per Finding 4 below. |
| 2 | Medium | `Document.load`'s structured rejection (`{code, message, errors}`) is discarded on failure — only a stringified message survives into the report (codex-review). | **Accepted** — a real evidence-quality gap for failure paths, irrelevant to this successful run. Should be fixed before F1–F8, where a load failure's exact cause will matter. |
| 3 | Medium | Setup/cleanup ordering risk: browser/page creation happens before the `try`, and a failed `page.close()` in `finally` can prevent `browser.close()` and report writing (codex-review). | **Accepted** — a real robustness gap for future reuse; did not manifest in this clean run. |
| 4 | Medium | F7/F8 scope-boundary wording tension (design table's full ViewerBridge-behavior list vs. the G1 authorization's narrower carve-out excluding isolation/fit/markers/DockingPanel) resurfaces and should be stated explicitly in the eventual F1–F8 report, not just the prior diagnosis doc (codex-advisor). | **Accepted, already known** (first raised in `2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md`) — carried forward as a requirement for whoever authors the F1–F8 harness, not a defect in this diagnostic. |
| 5 | Low | The H1 disposition logic uses `isOTG===true \|\| isSVF2===true` (OR); the authorization's own prose doesn't specify AND vs. OR (subagent). | **Accepted as a latent ambiguity, immaterial here** — both flags were true, so the branch taken is correct regardless of the OR/AND question; worth resolving explicitly (not urgently) alongside Finding 1's fix. |
| 6 | Low / informational | The same versioned CDN Viewer bundle URL was not cryptographically diffed between the historical legacy run and this diagnostic run, and Viewer 7.124.2's internal `isOTG()`/`isSVF2()` implementation was not independently source-inspected — the conclusion rests on Autodesk's documented semantics plus the live result, not on decompiled verification (codex-advisor). | **Accepted as a stated limitation**, not a defect — does not undermine the demonstrated result for this fixture. |

No Critical findings.

## 5. Adjudication of the seven requested questions

1. **Genuine isolation from production:** confirmed (§1).
2. **Controlled comparison:** confirmed (§2).
3. **Retained evidence shows the claimed values, no errors, no fallback signal:** confirmed (§3).
4. **Is the evidence sufficient to close the fixture prerequisite and establish H1?** **Yes.** This is an existential gate ("does at least one existing model load as true SVF2/OTG under a corrected initializer") — codex-advisor's reasoning, accepted: a single successful run against one model is sufficient to answer an existential question; it would not become more true with repetition, and the authorization's own text imposes no minimum fixture/run count. SwiftShader (software WebGL rendering, confirmed in use in this sandbox) is a rendering-backend concern and does not plausibly affect `isOTG()`/`isSVF2()`, which are documented as identifying the loaded derivative/runtime pipeline rather than anything about how it is subsequently rasterized. **H1 is independently confirmed.**
5. **May G1 F1–F8 proceed using this isolated harness, without production changes, upload/retranslation, OQ-1, host integration, or G2/G3?** **Yes, on the same isolated-page *pattern* — but not by reusing this exact script unchanged.** A purpose-built F1–F8 harness must: fix Findings 1–3 above; install F3's readiness-event listeners *before* triggering model load (not just wait for `isLoadDone()`); preserve one coherent event history for F6's unload/reload characterization; exercise the actual repository Adapter/collision modules (not just read `isOTG`/`isSVF2`); and explicitly scope F7/F8 to the narrower authorization carve-out (Finding 4) rather than the design table's full list. None of this requires touching `wwwroot/viewer.js`, uploading/retranslating a model, or starting OQ-1/host integration/G2/G3.
6. **Is changing production `wwwroot/viewer.js` a separate, unimplied decision?** **Yes, confirmed.** All three independent checks agree the production initializer is unchanged and that this diagnostic says nothing about whether real users of the app now receive SVF2 content — that remains a distinct, unauthorized-here host/runtime integration question (D2 from the prior diagnosis). `docs/handoffs/latest.md`'s existing hedged wording ("resolvable", never "resolved" or "accepted") was independently checked and found accurate, not overstated.
7. **Does the Agent Kit finding still stand?** **Yes, unchanged** — this review did not re-examine the Agent Kit (out of its bounded scope); AK-3 (knowledge absent) and ROUTING_NOT_TRIGGERED_BY_CURRENT_RULES from `docs/research/2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md` stand as previously recorded.

## 6. What this review does NOT authorize

Building the F1–F8 harness described in §5(5), fixing the classifier bugs in Findings 1–3, changing `wwwroot/viewer.js`, or starting G2/G3/H1/H2/OQ-1/host integration. All of these require separate, explicit owner authorization, consistent with every prior task in this chain. No production code was modified by this review; no F1–F8 verification was run.
