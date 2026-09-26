# Federated Clash Test Viewer Adapter — T3 independent verification

- **Review date:** 2026-09-26
- **Branch / HEAD:** `feature/federated-clash-test-viewer-adapter` @ `c7b5d13a15b8da7f9403a9027530bdd0c6f86d55`
- **Verdict:** **PASS inside the accepted T3 envelope.** The recorded live run satisfies the technical and procedural conditions of `G-VA-T3-EXEC`; the Viewer Adapter milestone is ready for owner closeout. This review does not authorize host integration, Viewer Clash Panel/UI work, a wider content/runtime claim, or any Core/M4 change.
- **Findings:** 0 Critical / 0 High / 0 Medium / 2 Low.

## Evidence boundary

Reviewed directly:

- `docs/research/2026-09-26-federated-clash-test-viewer-adapter-t3-live-acceptance.md`
- `docs/research/evidence/2026-09-26-viewer-adapter-t3-run.log.txt`
- `docs/research/evidence/2026-09-26-viewer-adapter-t3-run-report.json`
- `test/acceptance/clashtest-viewer-adapter.acceptance.mjs`
- Task 13 and the gate table in `docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md`
- `docs/handoffs/latest.md`

No live acceptance was rerun. No production, test, plan, specification, Core, M4, or UI file was changed.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

1. **The raw `.log` is ignored by the repository's global `*.log` rule.** The file exists and was reviewed, but an ordinary `git add` will omit it. The evidence set is not ready for a normal commit until the owner chooses either to force-add this specific log or to authorize a rename plus link updates. The JSON report already carries the complete structured checks, so this is packaging/provenance hygiene rather than a T3 validity issue.
2. **Execution provenance is not cryptographically self-attesting.** The stored log contains one complete execution sequence and one `EXIT=0`, and the report contains one completed result, but the repository cannot prove that no unrecorded retry occurred. The runtime report also does not embed the script hash or the exact `2026-09-26T06:11:59Z` start time stated by the research narrative. The log/report structure and values correspond to the reviewed script, and no contradictory evidence exists. This is a provenance limitation, not a T3 blocker.

## Verification

### Script identity

The working-tree script is clean against HEAD. Its SHA-256 is:

`78d2a5259ed1dd1621180324ca37511f19cc79f9767423419497636a9f8e0328`

That digest is identical for:

- the working-tree file;
- `HEAD:test/acceptance/clashtest-viewer-adapter.acceptance.mjs`; and
- the reviewed Task 13 correction commit `58bebb6:test/acceptance/clashtest-viewer-adapter.acceptance.mjs`.

The on-disk script identified by the execution record is therefore byte-identical to the reviewed version, and the log/report match that script's gate names and output structure. Because the runtime report did not record the script hash, the repository cannot cryptographically attest which bytes the process loaded; the retained execution record plus the clean on-disk identity are the available evidence.

### Gate correspondence and result

The report contains exactly 86 checks, all with `ok: true`; the log prints the same 86 PASS results, `86/86 checks passed`, both final gate labels, and `EXIT=0`. The families correspond to the reviewed Task 13 gates:

| Family | Checks | Verified result |
| --- | ---: | --- |
| imports | 6 | all required browser modules loaded |
| load/environment | 5 | three Audubon models; pinned Viewer URL; Chromium 151; SVF non-OTG and 3D |
| ownership / whole-model reconciliation | 18 | all three models clean and at the OQ-4 counts |
| collision-library differential | 12 | every root compared; no size, owner, digest, library, population, or owner-source mismatch |
| digest-scope agreement | 11 | whole, sampled roots, multi-root, and the two explicit Structure roots agree |
| D-V6/D-V9 negative controls and restore | 6 | all controls detected; capacity rejected before tree callbacks; model restored cleanly |
| live unload / cleanup | 26 | production wiring, late-old-unload, disposed-listener behavior, negative controls, cleanup, console and page gates all passed |

The JSON gate record is `T3: PASS (inside the accepted envelope only)`, `liveUnloadIntegration: VERIFIED_IN_ACCEPTED_ENVELOPE`, with no failing links, no console errors, and no page errors.

### Accepted envelope

The run stayed inside the accepted envelope:

- Audubon Architecture / Structure / Mechanical fixtures;
- all three models report `isOTG: false` and `is3d: true`;
- the loaded Viewer script URL is pinned to `/viewers/7.124.2/viewer3D.js`;
- Chromium is `151.0.7922.34`.

`env.viewerVersion` being `null` is acceptable for this gate. The reviewed script defines the Viewer-version assertion using the loaded, pinned script URL, and that assertion passed. The missing runtime version string remains evidence-quality metadata only; it does not widen or weaken the pinned build claim.

### Required behavior

- **Ownership:** all three whole-model runs have zero owner mismatches, zero unreachable items, zero unattributable items, and the expected population/root counts.
- **Library comparison:** 5,969 roots were compared across the three models with zero size, owner, subtree-digest, or library-throw mismatches; population digests also agree.
- **Digest scope:** whole-model, sampled per-root, and multi-root checks agree; both explicit Structure roots agree.
- **Negative controls:** wrong-owner, hidden-fragment, D-V6 not-loaded, unavailable-tree, and D-V9 over-capacity controls were all detected; the over-capacity control issued zero tree callbacks.
- **Lifecycle and cleanup:** the real Viewer unload event carried the expected model; unregister preceded eviction; replacement registration and late-old-unload behavior passed; disposed wiring did not handle the later unload; partial initialization, independent cleanup, aggregate cleanup failure, final model set, and removed-listener silence all passed.

## Reload digest observation

Disposition: **documented residual requiring future investigation; non-blocking for Viewer Adapter closeout.**

The same-URN Mechanical reload produced:

- equal fragment-id lists for 1,257 / 1,257 roots;
- equal population/root counts;
- a changed population digest;
- changed subtree digests for 1,257 / 1,257 roots.

The digest contract includes more than fragment ids (`ownerDbId` and `geometryId` are digest inputs), while the retained reload summary does not preserve those row-level before/after values. The evidence therefore establishes drift but not its exact input cause. Task 13 explicitly makes the AC-6 reload arm characterization-only and does not assert cross-reload identity. Cross-reload identity and `modelKey`/`modelVersion` derivation remain OQ-1/host-integration work, outside this milestone. The observation must remain linked from the handoff; it does not invalidate same-run enumeration, digest conformance, unload wiring, or the accepted T3 envelope.

## Gate and milestone disposition

`G-VA-T3-EXEC` is **satisfied**. The milestone owner explicitly authorized this delegated execution; the reviewed script executed successfully, its result is recorded under `docs/research/`, and this independent Work review accepts the retained evidence. No additional execution or retry is required.

The Viewer Adapter milestone is **ready for owner closeout** inside the accepted envelope. This does not authorize:

- Viewer Clash Panel/UI or another milestone;
- host integration or OQ-1 identity derivation;
- OTG/SVF2, 2D, non-Revit, calibration, or responsiveness claims;
- AC-15(g) PairId role-symmetry evidence;
- reopening frozen Core, P5, or M4 issues.

AC-15(g) PairId role-symmetry is explicitly excluded by both the reviewed plan and the script. OTG/SVF2, 2D, non-Revit, cross-reload identity, readiness sufficiency, and calibration are likewise disclosed exclusions or characterization gates, not silently missing T3 requirements.

## Commit readiness

The Markdown research record, JSON report, this review, prior implementation review, and handoff are content-ready. The complete artifact set is **not ready for an ordinary commit** because `docs/research/evidence/2026-09-26-viewer-adapter-t3-run.log.txt` is ignored by `.gitignore:93` (`*.log`). Resolve only that packaging choice at commit time; do not rerun T3.
