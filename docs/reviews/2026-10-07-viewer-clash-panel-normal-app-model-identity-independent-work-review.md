# Viewer Clash Panel Normal-App Integration + Model Identity Cleanup — Independent Work Review

**Date:** 2026-10-07  
**Role:** Independent Work visual/product reviewer  
**Verdict:** **Not ready for checkpoint; bounded compatibility remediation required**  
**Findings:** **0 Critical / 1 High / 0 Medium / 3 Low**

## 1. Repository state independently verified

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `main`
- **HEAD:** `2529402392e948db4ebba52c521a827fe5f206d0`
- **Origin relation:** `main == origin/main`
- **Working tree before this review artifact/handoff update:** dirty and uncommitted: 19 modified/deleted tracked paths plus the untracked owner prompt, upstream final report, and nine-image evidence directory. Nothing was committed or pushed by this review.
- **Scope check:** production changes are confined to the Viewer Clash Panel, normal Viewer bootstrap/host composition, and CSS. No `collision/`, Viewer Adapter, Core/M4, G2 procedure/evidence, C6/C8 research, or G3 implementation path changed.
- **Graph verification:** the index matched the reviewed HEAD and recorded no coverage issue for the 18 relied-on production/test/acceptance paths or the targeted host/view-model/viewer-options scopes. Source and tests were also read directly; this graph signal is supporting evidence, not completeness proof.

## 2. Governing and review inputs

- **Owner scope:** `docs/prompts/for-claude-clash-panel-normal-app-integration-model-identity-cleanup.md`.
- **Governing design:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, including the new §24 addendum.
- **Implementation plan:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md` (unchanged).
- **Upstream package final report reviewed, read-only:** `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md`.
- **Visual evidence:** all nine PNGs under `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity/`.
- **Handoff:** `docs/handoffs/latest.md`.

The handoff, final report, and retained evidence were treated as inputs rather than proof. The upstream final report was not modified.

## 3. Verdict and readiness

The normal-app and loaded-model-identity changes are internally coherent, but the package is **not ready for a checkpoint commit/push**. The new flag-free SVF2 default independently reproduces failures in both existing product acceptance suites, contradicting the owner scope's explicit requirement to preserve Room Locator and Clash Finder behavior.

The following areas are accepted:

- The Clash Panel extension is part of the normal Viewer path; `?clashPanelDemo=1` only adds deterministic fixture bootstrap behavior.
- Normal and demo flows use one metadata-first naming path. Display names do not determine identity, and the old demo URN-to-name registry is removed.
- `${urn}#${loadSeq}` distinguishes loaded Viewer Model instances, including duplicate loads of one URN. The host registers/unregisters those keys without moving identity logic into Panel core.
- Set A/Set B overlap is computed from `modelKey`, including element-only entries. Same loaded instance in both sets reaches the existing same-model Core decomposition; equal display names on different instances do not imply self-clash.
- The retained nine-image set supports normal/demo catalog behavior, duplicate-name distinction, same-instance overlap, mixed selections, running/stopped states, 491-result Hard completion, and narrow presentation.

Those accepted areas do not override the compatibility blocker below.

## 4. Findings

### Critical

None.

### High

#### H1 — The flag-free SVF2 default breaks two existing Viewer features the owner required this package to preserve

- **Affected:** `wwwroot/viewerOptions.js:20-35`; Room Locator and Clash Finder normal-app behavior; owner prompt line 44; design addendum §24.2.
- **Failure mode:** `resolveViewerOptions()` now returns `svf2:true` for every URL, including flag-free and `?svf2=0`, so the normal app always initializes `AutodeskProduction2` / `streamingV2`. Both pre-existing acceptance suites fail against that default:
  - `npm run test:acceptance`: the bathtub display-name search returns 0 instead of 1 and the flow then reaches a `fitToView` TypeError.
  - `npm run test:acceptance:clash-finder`: the documented Structure dbId owns no fragment under the SVF2 fixture, producing `fragment-not-loaded`, an empty clash-pair set, and cascading isolation/framing/witness failures.
- **Contradiction:** the owner-authorized package says, “Preserve existing default app behavior such as Room Locator / Clash Finder.” The owner's later decision to retain SVF2 and not weaken the suites defines the remediation boundary; it does not make the regressions checkpoint-safe.
- **Evidence:** both suites were run independently once against the current unchanged tree and local server. The observed failures match §24.2 and the upstream report. No acceptance script, default, fixture, or production path was changed by this review.
- **Minimum correction:** a separately owner-authorized, bounded compatibility pass that makes Room Locator and Clash Finder operate on the SVF2 default while retaining the SVF2 default and preserving the suites' intended assertions. Then run the focused/offline/DOM gates, both acceptance suites, and a targeted independent re-review. Do not resolve this by reverting the default or weakening/changing the acceptance suites without explicit owner direction.

### Medium

None.

### Low

#### L1 — The optional fallback-label tier is not wired by the production host

- **Affected:** `wwwroot/extensions/clashPanelHost.js:84-112` and host construction.
- **Effect:** `createHostCatalog` accepts one `fallbackLabel`, but `createClashPanelHost` never supplies it. The design/report's metadata → optional fixture fallback → `Model N` sequence therefore has no production caller for the optional middle tier. Wiring one shared value would also give multiple metadata-less models the same label.
- **Minimum correction:** either remove the unused tier from the current contract or define a per-model fixture-only fallback source. Non-blocking.

#### L2 — Element-only overlap copy is model-level but reads like whole-set equality

- **Affected:** `clashpanel/core/viewModel.js:89-96` and the setup overlap note.
- **Effect:** disjoint element selections from the same model correctly create same-model/self-clash semantics, but the note says the model “is in both sets.” It is not false at the model-identity level, yet it can imply the same selection exists on both sides.
- **Minimum correction:** use wording such as “Both sets include elements from X; same-model comparisons are enabled.” Non-blocking.

#### L3 — Extension stripping can truncate legitimate dotted model names

- **Affected:** `wwwroot/extensions/clashPanelHost.js:70-78`.
- **Effect:** the generic last-dot removal turns a metadata label such as `Tower v2.1` into `Tower v2`, even when `.1` is not a file extension.
- **Minimum correction:** strip only a recognized model/source extension or only metadata fields known to be filenames. Non-blocking.

## 5. Visual adjudication

All nine retained PNGs were inspected independently at original resolution:

- **PASS: 9**
- **FAIL: 0**
- **INCONCLUSIVE: 0**

The visual evidence supports the package's Panel-specific claims. Duplicate names are distinguishable, although the current `…<modelKey suffix>` presentation can expose opaque loaded-instance characters; that is acceptable for this bounded package because the suffix is deterministic and identity-safe. The normal-app screenshot demonstrates a populated normal catalog and Panel surface; no separate owner screenshot escalation is required.

The images do not prove Room Locator or Clash Finder compatibility. The independently run acceptance suites are the governing evidence for H1.

## 6. Independent verification performed

### Source and architecture

- Verified branch, HEAD, origin relation, dirty-tree inventory, diff scope, and `git diff --check`.
- Read the changed Viewer bootstrap/options, host catalog, demo loader, Panel view-model/setup, specification addendum, and directly affected tests.
- Traced loaded Viewer Model objects through host registration/catalog identity into Panel selection and existing Core same-model pair-space behavior. No Core or Viewer Adapter extension is required by the accepted identity/self-clash path.
- Verified that demo and normal flows share the host catalog path and that demo-specific names are no longer declared as product identity.

### Automated tests

- Focused changed-area suite: **118/118 pass**.
- Panel DOM suite: **95/95 pass**.
- Full offline suite: **5,245 total / 5,244 pass / 0 fail / 1 existing todo**.
- `git diff --check`: clean.

### Compatibility checks

- Room Locator acceptance: **FAIL**, independently reproduced at the bathtub name-search/fit step.
- Clash Finder acceptance: **FAIL**, independently reproduced from the SVF2 fixture/dbId mismatch with no reportable pair set and cascading expected-state failures.
- Each acceptance suite was run once. No retry was used to manufacture confidence, and no tracked path changed as a result.

## 7. Evidence and report assessment

- The upstream final report accurately discloses the package scope, test totals, nine-image evidence, three open Low findings, and the two acceptance-suite regressions. No repository evidence required an upstream report correction.
- The report correctly labels the compatibility regressions as blocking debt, but its “ready for independent review” status is only a review gate. It is not checkpoint acceptance.
- The retained screenshots and final report are adequate review inputs. The independent verdict and exact gate are recorded in this review rather than backfilled into the upstream report.

## 8. Protected boundaries

This review did not modify production code, tests, the governing specification/plan, the upstream final report, evidence, acceptance procedures, authorization records, or G2/C6/C8/G3 work. It did not commit or push. No G2 retry, record reset/issuance, attempt reset, collision change, Viewer Adapter/Core/M4 change, or new milestone is authorized by this review.

## 9. Exact next gate

The authorized independent review is complete. The package is **not ready for checkpoint commit/push** while H1 remains.

**Recommended next action:** the owner may authorize one bounded Room Locator + Clash Finder SVF2 compatibility remediation that retains the flag-free SVF2 default, preserves the acceptance suites' intended assertions, changes only directly necessary product/tests/docs, and returns for targeted independent re-review.

**Authorization state:** this review artifact and handoff update are complete; no further work is currently authorized.

**Must not begin without explicit owner authorization:** H1 remediation, Low polish, upstream-report correction, commit/push, acceptance-suite weakening, default reversion, G2/C6/C8 work, G3, or any further product/milestone scope.
