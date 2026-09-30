# G1 F7 calibration study (research only) — Mechanical run `b811888`

**Date:** 2026-09-29 · **Base:** `main` @ `596dab3` (= `origin/main`; only the untracked authorization prompt present) · **Authorization:** `docs/prompts/for-claude-f7-calibration-research-only.md` (research only).
**Disposition: CAL-B — evidence insufficient. G1 stays verified `PARTIAL`.**

No live run, no harness/tolerance/production change, no commit occurred. All numbers below come from the retained JSON `docs/research/evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-result.json` (`checks.F7.fields`) and from source read at `596dab3`. Derived machine-readable analysis: `docs/research/evidence/2026-09-29-g1-f7-calibration-*.json` and the two `.py` scripts beside them.

## 1. Verified basis
- 1,257 censused roots: **873 `agrees` / 26 `exceeds-envelope` / 358 `no-reference-geometry`**; every other class is 0. `boundsScalePerDbId`/`boundsResiduals` hold exactly the 899 = 873 + 26 non-excluded dbIds.
- Model context: `placementIsIdentity = true`, global offset `[-14.79, -59.09, 110.33]`, units ft (0.3048), F4 geometry snapshots resolve for the fragment records; the 438 representative render proxies (one per geometryId) expose `Float32Array` positions — per-fragment proxy equivalence was **not** verified, `S_a` ≈ 30–114 ft (not a large-coordinate case).
- Tolerance semantics (source: `test/acceptance/g1-svf2-f1-f8-verification.mjs` `observeF7` ~5697–6212, `scoreF7` 6227–6252; plan §7.7): `T_pass = 16·2^-24·S_a`, `T_gross = 2^-10·S_a`. Containment residuals `rMin/rMax` classify `disagrees`/`near-tolerance`. Envelope excess `eMin = envMin − nodeMin`, `eMax = nodeMax − envMax`; **any `e > T_pass` ⇒ `exceeds-envelope`. `T_gross` is not applied to the envelope side** (so "beyond T_gross" bands for envelope components are descriptive only).

## 2. The 26 exceedances
| Finding | Value |
| --- | --- |
| Violating components | 55, **all envelope-side** (x.eMin 10, x.eMax 9, y.eMin 13, y.eMax 10, z.eMin 5, z.eMax 8) |
| Containment | holds in all 26 (max containment residual ≈ 0.055×T_pass; 0.88 u·S_a): every Viewer box still contains the vertex-tight reference |
| Excess size | 7.8e-4 – 0.273 ft; residual/T_pass 9.2 – 5600 (per-dbId max: min 10.2, median 2370, max 5600); 147 – 89,604 u·S_a |
| Precision boundary | residual/ulp32(\|coord\|) = 252 – 9.1e6; node-box coordinates all exactly float32-representable → **not ULP-scale** |
| Fragments | each has ≥1 tight-reference fragment and 0 recorded skips; **exact per-root fragment count is not retained** (analysis gives only a lower bound; F1 totals 1,496 fragments over 1,257 roots, ≤2 per root) |
| Size | excess ≈ 13% of node extent (median 0.131, max 0.144); extents 0.35 – 6.1 ft |
| Clustering | all in dbId block 104–725; adjacent/mirrored pairs (130/131, 151/152, 379/380, 488/489, 573/574) have identical excesses; repeated extent (2.081, 1.333, 2.081) at 149/151/152/176/573/581 |

## 3. Exceedances vs the 873 agreements
- **Clean bimodal separation.** Worst agrees residual = 0.0796×T_pass (median 0.0206); exceedances start at 10.18×. Nothing between 0.08× and 10.2×. Agrees behave like true rounding: max containment 1.27 u·S_a, max envelope excess 1.21 u·S_a; 774 containment components bit-identical. The 16u allowance has ~12.6× headroom for roundoff.
- No dbId-level association with `S_a` or coordinate magnitude was detected (Mann-Whitney, **exploratory** — dbIds are correlated (438 distinct geometryIds, mirrored/repeated shapes), so p-values overstate significance and non-significance does not establish absence of scale dependence): S_a p = 0.60/0.19/0.093; \|coord\| p = 0.59/0.18/0.020 for x/y/z.
- **Object extent differs descriptively** (min-axis extent 1.33 vs 0.33 ft; exploratory p = 6.7e-11, same caveat): exceedances are compact 3-D solids.
- In all 26 the envelope is looser than the vertex-tight reference (observed in all 26, but neither necessary nor sufficient for `exceeds-envelope`: 393 agrees are also loose, and an oversized node box could exceed an envelope equal to the reference).
- The Viewer box is **larger than the envelope on some axes and smaller on others** (dbId 149: node extents [2.081, 1.333, 2.081] vs envelope [1.946, 1.337, 1.867]). This rules out "envelope + uniform padding" and points to a *differently shaped* box (candidate causes — none established by repo evidence: box built from an already-rotated box, precomputed SVF2 fragment/node boxes, different descendant aggregation, or different geometry/matrix than the oracle's representative-fragment-per-geometry proxy). Reference extents 1.4142 / 1.5286 fit 45°-rotated geometry, but world matrices are not retained, so rotation is **unconfirmed**.

## 4. Numeric-path review (source-cited)
- **Production side:** `clashpanel/viewer/viewerApi.js:61-74` calls only `tree.getNodeBox(dbId, Float32Array(6))` (object tree, falling back to instance tree). `Array.from` (`:68`) is the sole Float32→Float64 step; non-finite/mis-ordered ⇒ `null` (`:69`). No global-offset, placement or aggregation logic is in repo code — all inside opaque `getNodeBox`.
- **Oracle side:** world matrices = Float64 copy of `fragList.getWorldMatrix` (`collision/viewer/ViewerModelAdapter.js:42-45`); vertices from `getRenderProxy` of one representative fragment per geometryId → `adaptViewerGeometry`, no dequantization; tight reference = active-`ranges` vertices × matrix in float64; envelope = 8 corners of the all-vertex local box × the same matrix. Only `T_pass` slack on the envelope side.
- **Float32 entry points:** positions (Float32Array, 1,496/1,496) and `getNodeBox` output. The Viewer's own matrix storage type is **not established** (see discrepancy below). The plan's "common-mode input rounding" (plan `:1029`, `:1058`) is an assumption that holds only if `getNodeBox` uses the same geometry and matrices as the oracle — the repo cannot show this.
- **Plan/implementation discrepancies (minor, do not change the result):** `worldMatrixElementType` reads the Float64 copy (`:5935`) so it says nothing about Viewer storage (plan `:1094` intends `scratchMatrix.elements`); residuals stored absolute-only, not also in u·S_a units (derivable); `|G|+|P_t|` added once after max rather than per fragment (equivalent).
- **Tension with plan text:** plan `:1087` calls the envelope "the outermost box any bound-the-transformed-local-bbox construction can legitimately produce" and `:1058` says legitimate conservatism "is bounded by the envelope". This run contradicts both for 26 dbIds, but the contradiction is between plan *assumption* and Viewer behavior; it does not by itself show the oracle is wrong.
- **Viewer 7.124.2 contract evidence in repo:** only `docs/research/2026-09-26-viewer-clash-panel-viewer-api-evidence.md:60` — `getNodeBox` world-space status "not established"; classic-SVF agreement "to Float32 quantization" (`collision/README.md:861`). No `knowledge/`/`patterns/` dirs. Nothing on SVF2 `getNodeBox` precision, padding or source.

## 5. Candidate calibration rules (descriptive counts only)
| Rule | 26 exceedances passing | 873 agrees passing |
| --- | --- | --- |
| `passFactor` 16 / 32 / 64 / 128 | 0 | 873 |
| `passFactor` 256 / 1024 | 1 (dbId 379) | 873 |
| max(T_pass, k·ulp32(\|node coord\|)), k = 1–16 | 0 | not computed |
| max(T_pass, k·ulp32(S_a)), k = 1–16 | 0 | not computed |
| relative-to-extent (≈15% needed; 13% passes only 9/26, max excess/extent 0.144) | would pass all 26 — **rejected**: derived from the very cases it must admit and would admit materially wrong boxes | — |

**Quantitatively evaluated:** the `passFactor` sweep (S_a-relative) and the two ULP-derived variants (ULP agreement counts not computed; they add nothing above T_pass for the 26, since the excess is ≥252 ulp32). **Qualitatively rejected, not quantitatively swept:** a fixed absolute tolerance and other transform-aware roundoff bounds — the excess is 2–4 orders above modelled roundoff, so any roundoff-derived bound would need to be that much looser, which is not derivable. **Unevaluated:** cluster/shape-based allowances beyond the extent-relative one below. Any rule that does admit them is a shape-based/extent-based allowance fitted to this fixture, with no derivation from the numeric path, and would also admit genuinely oversized bounds (the failure the envelope check exists to catch). **No defensible, non-overfit rule is identified.**

## 6. The 358 `no-reference-geometry` exclusions
- Each is single-fragment with one `no-active-triangles` skip (line/point/flat geometry; 347 have a zero extent on some axis), so `fragmentBoundsUnion` is null. All in dbId 4609–5202; none in the 899 scored set. All 594 no-active-triangle fragments are distinct (358 here + 236 as the second fragment of an agreeing dbId).
- Exclusion is technically consistent with the algorithm (no triangles ⇒ no vertex-tight reference); evidence does not prove it wrong, so **treatment unchanged**. They are a separate population; `elementWorldBounds` and envelope are non-null, and the Viewer box is never checked against the envelope for them (unscored diagnostic: 60 match exactly, 207 stick out ≤ 4.28e-6 ft).
- **Denominator implication:** a future F7 PASS claim would cover only the 899 scored dbIds (or 1,257 minus explicitly excluded); the 358 would need to be stated as excluded, or given an envelope-only check — *(corrected per independent review M1: the accepted F7 contract already fixes this as 899 scored roots + 358 explicit `no-reference-geometry` exclusions; an owner decision is needed only to change/expand that contract.)*

## 7. Generalizability
A rule is defensible only with a rationale beyond this fixture. Existing evidence is one SVF2 fixture (an earlier run recorded in the handoff showed F7 457 agrees / 10 exceeds-envelope on a different fixture/state; its per-case data was not analyzed here and it is not treated as independent replication). The cause of the excess is unexplained, so no claim can be made about other SVF2 models, coordinate scales, or geometry distributions. The `S_a`-scale test (no scale dependence) is mildly reassuring for scale-invariance but does not explain the mechanism.

## 8. Disposition — **CAL-B (evidence insufficient)**
Not CAL-A: no representation-derived rule reaches the 26 and any rule that does is overfit. Not CAL-C: the calibration *model* (containment tight-to-T_pass; envelope as box-of-corners) is coherent, the oracle is functioning (agrees at rounding level, clean separation), and the mismatch is unexplained rather than proven to invalidate the framing; the plan-text assumption at `:1087` is falsified for this fixture but only as an assumption about Viewer behavior.

**Missing evidence:**
1. Exact fragment membership per root, per-fragment world matrices (rotation/instancing), fragment→dbId/geometryId map, and per-fragment proxy signatures (proxy equality across fragments sharing a geometryId is not established) for the 26.
2. The Viewer's own per-fragment boxes (`fragList.getWorldBounds`/`boxes`) unioned per dbId vs `getNodeBox`.
3. Which source `getNodeBox` reads in SVF2 (live vertex buffer, FragmentList boxes, precomputed node boxes) and its descendant scope vs F1's subtree walk.
4. Per-fragment local AABB, `ranges`, active triangle counts, category/type names for the 26.

**G1 should remain `PARTIAL`** (F1–F6, F8 PASS; F7 `NOT_EVIDENCED`) unless the owner closes it as such or authorizes more evidence.

**Smallest future research action** (requires separate owner authorization — it needs a live Viewer session, so not done here). Minimum specification so it is executable and its outcomes are interpretable:
- Read-only, one immutable observation snapshot per dbId (all reads in one synchronous pass, same model state); target the 26 plus a small matched control sample of `agrees` dbIds (incl. some with loose envelopes).
- Per dbId record: fragment ids; `getWorldMatrix` (Float64 copy); `fragList.getWorldBounds(fragId, THREE.Box3)` per fragment and their union (the repo's adapter convention, `collision/viewer/ViewerModelAdapter.js:47`); `getNodeBox`; per-fragment proxy signature (position array type/stride/offset/count, hash); corner envelope and tight reference recomputed as in `observeF7`.
- Any missing, throwing or non-finite value ⇒ that dbId is `probe-incomplete`, never silently excluded.
- Decision table: (i) `getNodeBox` ≈ union of Viewer per-fragment boxes AND those are looser than the oracle envelope ⇒ mechanism identified (Viewer-side box construction); this still does **not** by itself justify a rule (CAL-A needs independent-model evidence) and remains a design/owner decision on the envelope definition; (ii) `getNodeBox` ≠ union of fragment boxes ⇒ mechanism remains unexplained (CAL-B); (iii) oracle inputs (matrix/proxy) differ from Viewer's for the 26 but not controls ⇒ candidate oracle defect (CAL-C candidate, needs review). No harness tolerance change is needed to run it.

**Open questions for owner:** (0) Is the probe meant only to identify the mechanism for these 26, or to support redesigning the envelope rule (the latter needs broader-model evidence and controls)? (a) Should the 358 get an envelope-only check? (b) Is `T_pass`-only envelope slack intended (plan `:1048` forbids tuning against this run)? (c) If the probe shows `getNodeBox` = union of Viewer per-fragment boxes that themselves are looser than the oracle envelope, is the envelope side to be redefined (a design change, not calibration)?

## 9. Confirmation
No live Viewer/Playwright execution, no G1 rerun, no harness or F7 tolerance edit, no production/Core/Adapter/M4/Panel change, no commit or push. Subagents used: two read-only Opus agents (evidence statistics; numeric-path source review), spot-checked in the main session (`viewerApi.js:61-74`, `observeF7` ~6101–6132, plan `:1050-1089`). Internal review: [`docs/reviews/2026-09-29-g1-f7-calibration-study-internal-review.md`](../reviews/2026-09-29-g1-f7-calibration-study-internal-review.md). Derived-analysis scripts regenerate the retained evidence JSON (`python3 docs/research/evidence/2026-09-29-g1-f7-calibration-analyze.py` and `…-extra.py`; verified equal after path fix).
