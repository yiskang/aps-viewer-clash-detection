# Clash Tests Manager — CTM-7 F-1 Option B remediation Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `85aee231289dab39b7d98a63c9f2067b57db01b6`  
**Origin relation:** `HEAD == origin/main`  
**Working tree at review start:** uncommitted/unpushed Option B package plus the prior untracked CTM-7 validation package; tracked changes are `clashpanel/core/testsManager.js`, `test/clashpanel/core/testsManager.core.test.mjs`, spec §26.6/AC-M10, plan CTM-7 and the handoff  
**Governing decision:** owner-selected F-1 **Option B** — hide is visibility-only while the same model key remains computationally available; unload/unregister/binding loss is unavailability; new-key reload never rebinds an old test  
**Read-only upstream input:** `docs/research/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-final-report.md` (SHA-256 during review `271bd5a755211ba4cc21683d3f54d5c857b2ededd5920de3825a166c82222581`, preserved unchanged)  
**Prior authority:** `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-independent-work-review.md`  
**Verdict:** **Option B remediation accepted; no implementation blocker remains. One bounded headed Scenario H revalidation is still required before CTM-7 closeout.**  
**Findings:** **0 Critical / 0 High / 1 Medium / 0 Low**

## Scope and method

This review independently inspected `CLAUDE.md`, the handoff, the governing spec and implementation plan, the accepted Manager implementation/accessibility/layout reviews, the prior CTM-7 Independent Work Review, the upstream remediation report, the complete source/test/docs diff, the existing pinned Viewer API research and G2 C16 live evidence, and all three H-revalidation support files. Handoff and upstream reports were treated as navigation and claims, not proof.

Structural tracing used the codebase-memory graph for `testsManager.onModelLeft` and its impacted composition/test surface, followed by direct reads of every material source. The graph coverage check reported no recorded issue for the relied-on production, test, host, renderer, API-evidence and evidence-support paths. No headed run or production/test remediation was performed by Work.

## Verdict and readiness

The code change is the smallest sufficient Manager-side correction for the authorized product rule. It adds a post-dispatch microtask invalidation for `reason:'removed'` and prevents that reason from creating a departed-key overlay. It does not change the editor Run gate, Core, Viewer Adapter, collision, ViewerBridge payloads, host registration, result residency, public API or any deferred L1–L8 behavior.

The bounded implementation is accepted for offline/DOM scope. This is not headed proof: the real Viewer/Manager/editor agreement after hide remains the next separately authorized Scenario H gate. The evidence-support package is suitable as a starting point, but its inferred selectors and field assumptions require the fail-closed preflight in Medium M1 before any H evidence may be cited.

## Root-cause adjudication

### What the repository evidence establishes

The corrected mechanism is materially supported by independent repository evidence:

- the pinned Viewer 7.124.2 source investigation in `docs/research/2026-09-26-viewer-clash-panel-viewer-api-evidence.md` records that `hideModel` calls `impl.removeModel` directly, fires `MODEL_REMOVED_EVENT`, skips `BEFORE_MODEL_UNLOAD_EVENT`, and `showModel` re-adds the model;
- retained G2 C16 live evidence records exactly one `MODEL_REMOVED` listener entry, zero `BEFORE_MODEL_UNLOAD` entries, one ViewerBridge callback with `reason:'removed'`, and successful restoration;
- the original headed CTM-7 evidence proves that, after hide, the editor's catalog/registry-based readiness remained runnable while the Manager retained a missing/changed derived row until a later event;
- host `catalog.list()` synchronizes from `viewer.getAllModels()`, while Manager derived rows are cached by `catalogEpoch`; `setupValidation` independently reads that catalog plus the registry binding;
- the faithful-order unit test removes the model before the `removed` event, computes the transient missing state, silently re-adds it, and proves that only the new microtask invalidation clears the stale cached row.

Together these facts support the package's sequence: event-time removal, synchronous silent re-listing, and no later notification that would invalidate the Manager cache. The exact decoded Viewer bundle excerpt used by the package investigation was scratch-only rather than retained in this package, so the future headed H run remains the definitive runtime confirmation of the repaired end state; that evidence limitation does not make the bounded fix unsafe.

### Prior-review discrepancy

The prior Independent Work Review correctly identified the externally observable contradiction and recommended Option B, but its detailed claim that `removed` marked the still-listed key as `departed` was materially wrong for the observed real hide sequence. At the `MODEL_REMOVED` callback the key is absent from the Viewer-backed catalog, so the old `listedKeys(...).has(key)` condition does not add it to `departed`. The persistent defect was the cached transient missing derivation after a silent re-list, not the departed overlay.

The prior review remains preserved as historical evidence. Its product verdict and owner gate were sound; only the causal detail is superseded by this review.

## Implementation assessment

### Exact production diff

`clashpanel/core/testsManager.js` is the only production file changed: **+7/−1**.

1. `event.reason === 'removed'` no longer adds the key to `departed`.
2. The normal synchronous invalidation still occurs, so a genuine removal is immediately represented.
3. A `removed` event schedules one `queueMicrotask(() => invalidate(m))`; after the synchronous Viewer call returns it rereads the current catalog/binding state.
4. `unload` still departs a key observed while listed. A following `removed` event never clears that departure.
5. `invalidate` is already disposal-safe, so a queued callback after manager disposal is a no-op.

This remains fail-safe under the relevant orderings:

- hide: the second read sees the same key/model/binding and clears only the transient missing/changed derivation;
- a real removal or unload: the second read still sees the model absent or departed, so it stays missing;
- unload after hide: `unload` establishes departure before any queued reread can make the row available;
- new-key reload: the old key remains absent and no rebind occurs;
- same-key recovery after an observed removal: existing catalog-change reconciliation remains the authority.

No event-order path found can turn a truly unavailable model into a stable available row. The extra invalidation may briefly compute the transient missing ViewModel inside the synchronous hide event, but the accepted product contract concerns the stable post-call state and the future headed gate must verify that no user-observable stale state remains.

## Behavioral and test-quality adjudication

The four new tests are useful and accurately bounded:

- **Faithful-order reproducer:** non-vacuous. With the prior implementation, silent re-add leaves the cached row `models-missing`; the post-`Promise.resolve()` `setup-complete` assertion fails for the intended reason. It covers two records, completed-summary freshness on the original record, and a following real unload.
- **Already-listed fake:** not a Viewer-order reproducer, but correctly named contract coverage for a removed-only event whose authoritative read is already available. It covers active/inactive rows and no show-time flap.
- **Unload ordering:** useful fail-safe coverage that `unload` remains authoritative in both relayed-event orders and that a later `removed` event does not un-depart.
- **Hide → unload → new key:** useful coverage for hidden-model unload and no automatic rebinding.

Existing unchanged tests retain removal-without-event and same-key re-entry coverage. The new tests do not execute the real editor Run control or real Viewer timing; those are correctly assigned to headed Scenario H rather than duplicated with more fakes. No missing offline race/order case rises to a blocker.

## Governing documentation reconciliation

Spec §26.6 and AC-M10 now encode the owner-selected distinction:

- hide-only with the same catalogued/bound key changes neither readiness nor “models changed”;
- actual unload/binding loss remains unavailable;
- same-key re-entry after observed removal remains recoverable;
- new-key reload never rebinds.

The plan's CTM-7 row carries the same rule without expanding CTM-7 or authorizing execution. Historical reports/reviews remain unchanged. No unrelated spec or plan scope was rewritten.

## Finding

### Medium M1 — the future H helper preflight is not yet fail-closed for inferred selector/field drift

`capture-helper.js`, `CAPTURE-SCHEMA.md` and `PROTOCOL.md` are isolated documentation/evidence support and are not imported or served by production. They durably define the schema, read-only capture logic, settle rule, H0–H10 command order and manifest convention. Their files are syntactically valid and individually hashable.

However, several DOM/private-surface assumptions were reconstructed rather than run: the Manager selectors, `_host.panel.controller`, `vm.test.draft.revision`, overlay-scene internals and the numeric `hideModel`/object `unloadModel` command signatures. More importantly, `problems == []` checks only Viewer/host/root/editor existence. It can remain empty when a Manager selector drifts and yields `count:0` or null fields. The documented smoke check alone could therefore permit vacuous F-1 assertions.

This does **not** block acceptance of the Option B production/test remediation. It is a mandatory gate inside the future headed H package and blocks citing any headed H result until it passes.

**Minimum fail-closed preflight before the first H mutation:**

1. retain and hash the exact helper/schema/protocol used; verify helper syntax and schema id;
2. capture H0 in the known configured state and assert non-null Manager/editor/catalog/Viewer carriers, the expected nonzero test/model counts, exact known test IDs/names, non-null readiness/status/Run fields, and matching model IDs/keys across catalog/editor/Viewer reads;
3. verify every selector/private field used by the F-1 oracle against the live DOM/VM; unsupported optional fields must be explicitly excluded, never silently accepted as null;
4. verify the pinned runtime and the exact `hideModel`/`showModel`/`unloadModel` argument forms before mutation;
5. abort without producing a PASS verdict if any required carrier, selector, signature or settle condition is unavailable. Every cited capture must have `problems:[]`, `settle.stable:true` and `settle.timedOut:false`.

The bounded H authorization may include this preflight. Failure ends that package without a Scenario H acceptance claim; it does not authorize helper, product or Viewer remediation.

## Verification reproduced

- Focused `node --test test/clashpanel/core/testsManager.core.test.mjs`: **29/29 pass**.
- Canonical `npm test`: **exit 0**.
  - offline: **5,617 total / 5,616 pass / 0 fail / 1 existing todo**;
  - DOM: **136/136 pass**.
- `git diff --check`: clean.
- Evidence helper: `node --check` passes.
- Production diff: only `clashpanel/core/testsManager.js` (**+7/−1**).
- Protected Core outside that file, ViewerBridge, Viewer Adapter, collision, ports, host `wwwroot`, server, package and scripts: zero diff.
- `main` and `origin/main`: both `85aee231289dab39b7d98a63c9f2067b57db01b6`.

The first canonical-gate attempt was blocked before tests by the review sandbox denying `pretest` vendor refresh. The identical gate was rerun with repository write access and passed; this was an environment permission issue, not a product/test failure. The vendor refresh created no tracked diff.

## Protected boundaries

No headed H revalidation, CTM-8, L1–L8 remediation, persistence/history/background-run work, resize/separate-panel work, Core/Viewer Adapter/collision work, G2/C6/C8/G3/R20-1 work, commit or push was performed. The upstream remediation report and prior CTM-7 artifacts were not edited by Work.

## Gate and authorization state

**Remediation readiness:** accepted; no Critical/High or implementation-blocking Medium remains.

**Exact next gate:** **owner authorization of one bounded Scenario H headed revalidation package only**, including the fail-closed evidence-helper preflight above and retaining/hashing the helper, schema, settle conditions and command sequence actually used.

**CTM-7 status:** not closed until that bounded headed H result receives its own independent review. **CTM-8 remains unauthorized.** L1–L8 remain deferred.

**Must not begin without explicit owner authorization:** headed H/preflight execution; helper remediation beyond the bounded preflight; CTM-8; L1–L8; production/test/spec/plan changes; upstream-report correction; commit/push; persistence/history/background runs; resize/separate-panel work; Core/Viewer Adapter/collision; G2/C6/C8/G3/R20-1; or another package/milestone.
