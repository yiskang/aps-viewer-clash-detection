# Clash Tests Manager — CTM-7 Scenario H evidence: owner ratification record

**Date:** 2026-10-11
**Decision owner:** milestone owner
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
**Branch / HEAD / origin:** `main` / `85aee231289dab39b7d98a63c9f2067b57db01b6` / `HEAD == origin/main`
**Working tree (verified at record time):** uncommitted/unpushed. Tracked modifications are the accepted Option B package only (`clashpanel/core/testsManager.js`, `test/clashpanel/core/testsManager.core.test.mjs`, spec, implementation plan) plus `docs/handoffs/latest.md`. Untracked files are CTM-7 prompts, reports, reviews and evidence. This record changes none of them except the handoff.

## Reviewed artifacts

- [Scenario H headed revalidation Independent Work Review](2026-10-11-clash-tests-manager-ctm-7-scenario-h-headed-revalidation-independent-work-review.md): INCONCLUSIVE, 0 Critical / 1 High / 0 Medium / 2 Low. The High is an authorization/workflow defect, not a product defect.
- [Option B remediation Independent Work Review](2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-independent-work-review.md): accepted.
- Upstream [Scenario H final report](../research/2026-10-11-clash-tests-manager-ctm-7-scenario-h-headed-revalidation-final-report.md), read-only, and [evidence](../research/evidence/2026-10-11-ctm-7-scenario-h-revalidation/SCENARIO-LOG.md) (18-entry manifest).

## Owner decision

**Ratify the retained post-fix Scenario H evidence** (Option A).

1. The disclosed preflight workflow deviation is accepted as an owner-ratified governance exception **for this evidence package only**.
2. The retained post-fix preflight and H0–H6 evidence are valid CTM-7 gate evidence.
3. **H0–H5 are accepted as gate-valid PASS evidence.**
4. **H6 remains INCONCLUSIVE.** The host reload path mints a new key, so no same-key-after-unload product path exists, and none was invented.
5. CTM-7 may now proceed to **owner closeout/checkpoint disposition**. D (held-unsaved) and J (fault/recovery) stay recorded as prior INCONCLUSIVE coverage.

## Why no fresh rerun is required

The Independent Work Review found the technical evidence sound. Its basis:

- The capture helper was unchanged. No product mutation occurred before the retained passing preflight.
- Final preflight passed 21/21, of which 19 checks assert live values.
- All 16 captures have `problems:[]`, `settle.stable:true` and `settle.timedOut:false`.
- All nine PNGs were independently inspected and agree with the structured state.
- The manifest verifies 18/18.
- H1–H5 give positive and negative controls: hide-only stays Ready, unload blocks, and a new key does not rebind.

The deviation concerned who could authorize a retry. It did not concern the quality of the evidence.

## What this decision does not erase or extend

- The first preflight crash, the edit of `preflight.js`, the reruns and the continuation into mutations remain a **disclosed workflow deviation**. They are not erased or recharacterized.
- This ratification is **specific to this evidence package**. It is **not** a general retry or preflight-repair policy. Future packages must stop and return to the owner when a required preflight item fails.

## Unremediated items (recorded, not authorized for work)

- **Low L1:** the H5 editor validation copy omits old-key disambiguation (`Model … is not registered.`).
- **Low L2:** the retained `PROTOCOL.md` is the pre-run planned protocol, not the executed record. `SCENARIO-LOG.md` is the executed record.
- The ~2 ms unpainted Mechanical DOM intermediate was not measured at H1/active-test or for assistive technology. No stable Option B defect is established.
- CTM-8 remains **unauthorized**. L1–L8 remain **deferred**.

## Not authorized by this decision

No code, test, spec or plan change. No helper or preflight edit. No H5 copy fix. No protocol-wording fix. No upstream report edit. No headed rerun. No CTM-8 or L1–L8 work. No commit. No push. No other package or milestone.

## Next gate

Owner closeout/checkpoint disposition for CTM-7. Nothing further is authorized until the owner gives it.
