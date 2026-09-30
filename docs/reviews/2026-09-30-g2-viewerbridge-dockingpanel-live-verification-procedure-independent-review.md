# Independent review — G2 ViewerBridge / DockingPanel live-verification procedure

- **Date:** 2026-09-30
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Reviewed state:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd` = `origin/main`
- **Primary artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`
- **Other authority inspected:** the internal G2 review, current handoff, owner-accepted Viewer Clash Panel design, implementation plan §G1–G3, G1 verified-`PARTIAL` closeout/CAL-B record, fixture-screening evidence, and the actual `clashpanel/viewer/*` and `clashpanel/ui/ClashDockingPanel.js` implementation.
- **Repository state before this review:** modified `docs/handoffs/latest.md`; untracked G2 procedure, internal review, and authorization-prompt file. No G2 harness exists and no production change is present.

## Verdict

**Not ready for owner acceptance or harness-implementation authorization.** The procedure is correctly scoped and substantially covers PG-1, but five High correctness/implementability findings must be corrected first. No production/Core/Viewer Adapter/host change is needed; every blocker is confined to this procedure and its future test-only harness contract.

**Findings:** 0 Critical / 5 High / 3 Medium / 2 Low.

## High findings — blocking

### H1 — C7 and C18 impose mutually exclusive scene postconditions

- **Procedure sections:** C7(iii)/(vi), C18, phase P10, cleanup.
- **Repository fact:** `markers.ensureScene()` records ownership only when the bridge itself adds a scene. `disposeShared()` removes only names in `scenesAdded`; therefore a harness-pre-created `clash-panel-markers:<id>` scene containing a foreign sentinel must survive bridge disposal.
- **Contradiction:** C7 requires that pre-existing Panel-named scene and sentinel to survive `clear()` **and** `dispose()`, and says the harness removes them only in cleanup. C18 simultaneously requires `hasScene === false` for **both** Panel scene names immediately after bridge disposal. Both cannot pass in one run.
- **Failure mode:** overall PASS is unreachable even when production behavior is exactly correct.
- **Minimum correction:** make C18 distinguish ownership: the bridge-created outlines scene must be absent; the pre-existing marker scene and foreign sentinel must still exist until harness cleanup; all bridge-owned meshes must be gone. State explicitly that C7's post-dispose assertion is evaluated in C18.

### H2 — overall verdict precedence can downgrade an observed failure to BLOCKED

- **Procedure sections:** §8 rows 2–4 and its Cartesian-product test.
- **Contradiction:** viewer-integrity `PROVENANCE_AMBIGUOUS`/`CAPTURE_UNAVAILABLE` is evaluated as BLOCKED before check/control failures. The procedure's own matrix includes combinations such as `check FAIL + integrity unavailable`; those currently roll up to BLOCKED, despite §8 saying a failure is never reinterpreted.
- **Failure mode:** a real ViewerBridge defect or mandatory-control failure can be hidden behind weaker provenance incompleteness.
- **Minimum correction:** keep fatal/cleanup failures first; keep a true classifier/model-load stop before checks only if the harness does not execute checks after that stop; then evaluate every observed C1–C19/control failure; only afterward map unresolved Viewer identity or missing evidence to BLOCKED/PARTIAL. Add the three mixed negative cases to the offline matrix: check FAIL, control failure, and cleanup failure combined with unavailable identity must all remain FAIL.

### H3 — the crash-durable journal has no executable authorization-record binding

- **Procedure sections:** §4.1 and §11.
- **Gap:** activation defines only `--execute-live-g2` and `G2_LIVE_AUTHORIZED=YES`, but the journal is keyed by “the current authorization prompt's” SHA-256 without defining how the harness receives, locates, validates, or pins that prompt. A future prompt name is intentionally not fixed.
- **Failure mode:** the implementation cannot mechanically decide which digest to compare, so same-authorization replay prevention is underspecified. “Atomic write and fsync” also needs the durable sequence stated: exclusive temp create/write, file fsync, rename, and parent-directory fsync (or an explicitly weaker process-crash-only claim).
- **Minimum correction:** add one explicit authorization-record input (for example `--authorization-record <repo-relative docs/prompts/...>`), validate its location/content identity, persist its normalized path and digest, and define the startup/journal durability algorithm. Preserve the rule that any evidence-write failure after journal consumption leaves the journal consumed and cannot enable a retry.

### H4 — C4 can PASS while its box does not contain the fragment union

- **Procedure section:** C4(ii), D7.
- **Contradiction:** a positive containment deficit between `16·2^-24·S_a` and `2^-10·S_a` is only a `near-tolerance` observation and does not prevent PASS, yet C4's allowed conclusion says the boxes are containing. At coordinate magnitude 1,000, the gross threshold is about 0.98 native units; the rule is origin-sensitive and can hide a materially undersized box.
- **Repository comparison:** accepted G1 `scoreF7` treats `near-tolerance` and `exceeds-envelope` as `NOT_EVIDENCED`, not PASS. CAL-B did not authorize changing that calibration policy.
- **Failure mode:** G2 could claim valid outline/fit bounds while sampled geometry lies outside the reported box.
- **Minimum correction:** retain the gross threshold as a definite FAIL boundary if desired, but make every positive deficit above the declared PASS allowance prevent PASS (`NOT_EVIDENCED` unless separately justified). Do not call a non-containing box containing. This is a technical oracle correction, not an owner/product choice and does not reopen CAL-B.

### H5 — C17 does not define a complete executable verdict oracle

- **Procedure section:** C17.
- **Gap:** C17 lists observations and actions but never states a complete PASS-iff rule for event entry order, bridge callback payload/reason, unloaded-side filtering, surviving-side presentation, selection filtering, clear outcome, and residue. Its dependency text refers to an “expected” event order that the check itself does not normatively adjudicate.
- **Failure mode:** two implementations can retain the same evidence but assign different verdicts; a stale/unavailable-model defect can be recorded yet still pass.
- **Minimum correction:** add an explicit conjunctive PASS condition and failure/blocked mapping for each required observable. Keep the guarded `getNodeName` read observation-only and keep registry/binding/OQ-1 outside the verdict.

## Medium findings

### M1 — cleanup does not independently unload model B

Cleanup lists only `unloadModelA` followed by `verifyViewerModelSetEmpty`, assuming C17 already removed B. If an earlier taint skips C17, C16 restoration fails, or B unload fails, cleanup detects residue but has no independent best-effort `unloadModelB` step. Add guarded, timeout-bounded unloads for every loaded model, each attempted independently before the empty-set check. This is failure containment, not a production dependency.

### M2 — D7 mixes technical oracles, calibration assumptions, and operational time budgets

The numeric set is not one owner/product decision. It includes:

| Value | Classification | Required disposition |
|---|---|---|
| C4 `16u` / `2^-10` and simplified `S_a` | technical oracle + calibration assumption | Correct H4 before harness implementation; retain margins in evidence. |
| C6 matrix delta `1e-9`, frustum `ε=1e-4` | provisional numerical assumptions | Freeze before implementation; N2 makes fit discrimination fail closed. |
| C7 `N_min=25`, hue ±30°, saturation 0.3, value 0.2 | arbitrary/provisional visual calibration | Freeze before implementation, label envelope-limited, and prohibit tuning from the consumed run. |
| First 20 bounds per model / first 50 fit candidates | bounded sampling choices | Acceptable because claims are sample-limited and N2 can yield `NOT_EVIDENCED`; record full candidate counts. |
| 30/180/60/5/15/10 s and 20 min timeouts | operational budgets | Technically reasonable starting values; must be frozen before live execution, with timeout evidence retained. |
| 4 KiB field / 2 MiB ledger caps | evidence-capacity bounds | Technically justified for bounded durable evidence if truncation cannot remove verdict-critical fields. |

The C4 correction is blocking. The other thresholds may remain provisional but must be fixed in the accepted procedure before harness implementation so they cannot be tuned after observing the one live attempt.

### M3 — C2's title-element fallback is not a defined algorithm

C2 names `.docking-panel-title`, then says a different live class will be “discovered” and pinned, without specifying the discovery rule. Define one deterministic DOM/prototype-based rule or require the pinned 7.124.2 selector and fail with retained DOM evidence if absent. This does not block architecture, but it does block an unambiguous executable C2.

## Low findings

1. C3's repeat count (three) and C7's replacement count (five) are bounded confidence samples, not guarantees. This is acceptable if the report states the exact counts and makes no universal reliability claim.
2. E8 correctly prevents misattribution, but “G1's F7/F8 semantics differ from spec F7/F8” is shorthand: G1 deliberately implemented a narrow carve-out from the spec gaps. Prefer “G1's narrow F7/F8 carve-out did not establish the fuller PG-1 bridge behaviours” to avoid suggesting unrelated identifiers.

## Coverage and scope adjudication

### C1–C19 completeness

Subject to H1–H5 and M3, the set covers the G2/PG-1 assumptions actually present in the implementation: pinned SVF2 envelope, real DockingPanel lifecycle, world-bounds reads, unit metadata, aggregate and single-model fit, markers/overlay rendering and ownership, isolation prerequisite/apply/restore/foreign-state behavior, supersession, injected Viewer failures, model-left events, disposal, and prohibited theming/selection calls.

G3 remains excluded: C2 uses a fake controller and only smoke-checks the five-region shell; it does not run a Core test, browse sealed results, exercise Panel workflow/domain state, or validate toolbar/host composition. H1/H2, OQ-1, PR-BASIS, registry identity/re-registration, `createClashPanel`, `server.js` route changes, and simultaneous extension integration remain outside scope.

### Fixture composition

Mechanical + Structure is the correct bounded pair. Two models are genuinely required to test the aggregate `fitToView([{model,selection}])` path and multi-model isolation. Structure's screening evidence records confirmed OTG/SVF2, 543 fragments/468 roots, and all screened existing limits within bounds; it introduces no Adapter/Core dependency because G2 selects dbIds directly and independently checks the bridge-facing behavior it uses. Structure has not passed G1 F1–F8, so the G2 report must not cite it as such or make Adapter/Collision claims.

G1 F7 remained `NOT_EVIDENCED`, while F8 passed for Mechanical. The owner-accepted G1 closeout permits moving on to bounded G2 definition, but G2 must present C4 as new, envelope-limited bridge evidence—not as a retroactive G1 F7 PASS or calibration rule.

### Viewer state ownership and failure injection

The markers-only/no-theming boundary, exact-mesh ownership, guarded isolation, read-and-compare restore, aggregate-fit fallback, single-side fit, model-departure handling, and dispose checks match the accepted design and real code. C15's five injections target real calls and each has a distinct negative-control purpose. Recorder-outermost composition, per-phase restoration, tainting, and the baseline invariant are sufficient once H1/M1 are fixed.

Selection/navigation checks remain absence/read-only bridge checks; workflow navigation stays G3. “Stale binding” is correctly narrowed to a departed-model bridge boundary; binding generation, registry repair, and identity derivation remain H1/H2/OQ-1. OD-12 coexistence remains deferred: G2 should exercise only the accepted isolation guard and must not load Clash Finder or Room Locator.

### Attempt and evidence semantics

The intended rule is sound: journal consumption immediately before the first real model load makes later crash, timeout, cleanup failure, or final evidence-write failure consumed; the journal is never deleted; a new live run requires a new owner authorization. Phase-0 failures remain preflight-only and non-consuming. H2 and H3 must be fixed before that intent is mechanically reliable.

## Internal-review fix verification

| Internal finding | Independent disposition |
|---|---|
| Critical C1 — control-state/roll-up contradiction | **Closed locally**, but overall precedence still has H2. |
| Critical C2 — C13/C15 unreachable `failed` | **Closed** by persistent restore-failure scenario C15(e). |
| Critical C3 — crash durability | **Partially closed; H3 remains.** |
| Critical C4 — timeout contract | **Closed structurally**; numerical durations remain provisional M2. |
| Critical C5 — nonexistent scalar `T_pass` | **Reference corrected, but H4 remains in the new G2 oracle.** |
| High H1 — sentinel not in Panel scene | **Not closed:** remediation introduced H1's C7/C18 contradiction. |
| High H2 — camera/screenshot oracle | **Closed structurally**; calibration is M2. |
| High H3 — C16 wording/order | **Closed for C16**; adjacent C17 still needs H5. |
| High H4 — contamination propagation | **Substantially closed**; cleanup completeness needs M1. |
| High H5 — redaction/size/attribution | **Closed.** |

## D1–D7 adjudication

| Item | Classification | Recommended disposition |
|---|---|---|
| D1 | owner/operational fixture decision | Approve Mechanical + Structure. |
| D2 | owner acceptance-policy decision, after technical correction | Approve the fail-closed four-state model only after H2 precedence is fixed. |
| D3 | technical verification-scope disposition, already constrained by markers-only design | No foreign-theming seed; prove zero Panel theming calls and state foreign-theming preservation as not live-evidenced. |
| D4 | owner authorization/risk decision | Permit the bounded wrappers only after implementation review; require restoration/taint rules exactly as specified. |
| D5 | technical scope correction | Adopt bridge-only selection/model-departure scope; keep workflow in G3 and binding identity in H1/H2/OQ-1. |
| D6 | existing product/integration decision, deferred and non-blocking for G2 | Keep OD-12 option (a) assumed; exercise only the guard, no coexistence test. |
| D7 | technical oracle/calibration/operations package, not a single product choice | Split it; correct H4, then freeze the remaining provisional values and evidence envelope before implementation. |

The owner decisions that remain before a later harness implementation authorization are D1, corrected D2, and D4. D6 remains a deferred host/integration decision, not a G2 implementation blocker. D3, D5, and D7 should be resolved as technical procedure corrections/dispositions rather than delegated to product preference.

## Dependency and authorization result

- No production change and no Core, Viewer Adapter, M4, host, OQ-1, G3, H1, or H2 implementation dependency has appeared.
- Required next step: bounded procedure remediation for H1–H5 and M1–M3, followed by targeted independent re-review of only those changes and affected cross-references.
- The G2 harness is not authorized. G2 live verification is not authorized. Commit/push, G3, H1/H2, OQ-1, host integration, F7 probe/calibration, and production changes remain unauthorized.

**Status: revise the G2 procedure before owner acceptance.**
