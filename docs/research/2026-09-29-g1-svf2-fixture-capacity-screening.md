# G1 SVF2 fixture capacity screening (existing models only)

- **Date:** 2026-09-29 (runs 13:16:43Z–13:17:44Z)
- **Scope:** owner-authorized bounded screening task. Find an **existing** model in this repo/account that could serve as a future G1 SVF2 fixture under the **existing** G1 capacity limits. This is **not** a G1 live-run authorization.
- **Repository state:** `main` @ `030dc60` (= `origin/main`); harness, production, Core, Adapter, M4 and Panel code unchanged; limits unchanged.
- **Evidence:** [result JSON](evidence/2026-09-29-g1-svf2-fixture-capacity-screening-result.json) · [screening script](evidence/2026-09-29-g1-svf2-fixture-capacity-screening-script.mjs) · [manifest-listing script](evidence/2026-09-29-g1-svf2-fixture-capacity-screening-manifest-listing.mjs)

> **This is screening, not G1 evidence.** No F1–F8 run occurred. No harness `--execute-live-f1-f8` invocation or `G1_F1_F8_LIVE_AUTHORIZED` was used. No controls, F3, F6, F7 or F8 were run, and `runHarness`/`computeOverall` were never called. There were no uploads, translations, retranslations, derivative creations or deletions. The recorded RAC finding still stands: `racbasicsampleproject.rvt` has `maxSyncTriangleCount` **21,845 > 12,000**. This screening does not change that finding or any limit.

## Result

| Candidate | SVF2 status (`isOTG`/`isSVF2`, classifier) | Fragments (population) / roots | Max frags per dbId / per root | Max children per node | Distinct geometries | Max active triangles | Responsible geometry / dbId (node) | Limit comparisons | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Audubon_Mechanical_clash_test.rvt` | true/true, `CONFIRMED_SVF2` | 1,496 / 1,257 | 2 (dbId 153) / 2 (dbId 153) | 262 | 438 | **4,228** | geom 2 / dbId 4593 ("Round Duct [921809]"), 1 instance | All 5 within; 4,228 ≤ 12,000; 0 oversized | **SUITABLE_G1_FIXTURE** |
| `Audubon_Structure_clash_test.rvt` | true/true, `CONFIRMED_SVF2` | 543 / 468 | 3 (dbId 249) / 3 (dbId 249) | 48 | 416 | **7,140** | geom 10 / dbId 6293 ("SMBH-W-Wide Flange [269361]"), instanced by dbIds 6292, 6293 | All 5 within; 7,140 ≤ 12,000; 0 oversized | **SUITABLE_G1_FIXTURE** |
| `linked_model_clash_test.rvt` | true/true, `CONFIRMED_SVF2` | 8 / 8 | 1 / 1 | 6 | 5 | **1,588** | geom 3 / dbId 3391 ("Model Text [299153]"), instanced by 3390, 3391 | All 5 within | SUITABLE_G1_FIXTURE (trivially small) |
| `main_model_clash_test.rvt` | true/true, `CONFIRMED_SVF2` | 9 / 9 | 1 / 1 | 5 | 9 | **1,348** | geom 5 / dbId 3175 ("Model Text [348941]"); 5 geometries tie at 1,348 | All 5 within | SUITABLE_G1_FIXTURE (trivially small) |
| `Audubon_Architecture_clash_test.rvt` | true/true, `CONFIRMED_SVF2` | fragList 5,435 (isLoadDone true); roots n/a | n/a | n/a | n/a | n/a | n/a | not measurable: F1 `resolveRoots` threw `EnumerationInconsistencyError` (`tree-reachable-fragment-unattributable`, fragId 4601, cls `N`); harness `scoreF5` → `BLOCKED` / `F1-failed-non-capacity` | **INSUFFICIENT_EVIDENCE** |
| `racbasicsampleproject.rvt` (reference, **not re-screened**) | true/true, `CONFIRMED_SVF2` (baseline live run) | 789 / 467 | 17 (dbId 430) / 17 | 43 | — | **21,845** | — | `maxSyncTriangleCount` 21,845 > 12,000 | **OVER_EXISTING_LIMIT** (reference only) |

The five limit checks are the harness `scoreF5` `limitChecks`. Each passes when the observed value is ≤ the limit, the same strict-`>` breach semantics the harness uses:

| Candidate | maxCollisionInstancesPerEpoch (20,000) | maxFragmentsPerDbId (5,000) | maxFragmentsPerRoot (5,000) | maxChildrenPerNode (10,000) | maxSyncTriangleCount (12,000) | harness `scoreF5` |
| --- | --- | --- | --- | --- | --- | --- |
| Audubon Mechanical | 1,496 | 2 | 2 | 262 | 4,228 | PASS |
| Audubon Structure | 543 | 3 | 3 | 48 | 7,140 | PASS |
| linked_model | 8 | 1 | 1 | 6 | 1,588 | PASS |
| main_model | 9 | 1 | 1 | 5 | 1,348 | PASS |
| Audubon Architecture | — | — | — | — | — | BLOCKED (F1-failed-non-capacity) |
| RAC (retained baseline) | 789 | 17 | 17 | 43 | **21,845 ✗** | FAIL (existing-limit-exceeded) |

Supporting observations for the four measured candidates:

- **Load and population:** every load completed. `isLoadDone()` was reached in 2–5 s, and F2 accounting balanced with 0 class-N, 0 class-U and 0 loaded-but-unreachable fragments.
- **F1 cross-checks:** population digest EQUAL; 0 owner mismatches; 0 unreachable; 0 size, owner or subtree-digest mismatches; 0 digest-oracle errors.
- **F4 chain:** 0 render-proxy failures, 0 adapter failures and 0 weld-consumer failures or exceptions. Every distinct geometry was welded successfully by the real browser-realm `compactAndWeld`, with 0 geometries at `geometry-too-large-for-sync-build`.
- **Environment:** the Viewer script SHA-256 matched the harness `EXPECTED_VIEWER_SHA256`, and there were no page errors.

These are screening observations, not F1/F2/F4 verdicts.

### Recommendation (screening result only; fixture choice needs an owner decision)

- **Primary: `Audubon_Mechanical_clash_test.rvt`.** It has the largest measured population (1,496 fragments and 1,257 roots) and the most headroom: 4,228 triangles is about 35% of 12,000. Every measured existing limit is satisfied.
- **Alternate: `Audubon_Structure_clash_test.rvt`.** It has 543 fragments and 468 roots, similar in scale to RAC. Its 7,140 triangles are about 60% of the limit.
- **Other clash models:** `main_model_clash_test.rvt` and `linked_model_clash_test.rvt` satisfy the limits but have only 8–9 fragments each. They are probably too small to exercise G1 checks meaningfully, for example the F7 calibration census or multi-fragment control targets. This screening did not assess that.
- **Answer to the 12,000 question:** yes. Four existing, already-translated models satisfy `maxSyncTriangleCount` ≤ 12,000 and the other four measured existing limits under the pinned G1 runtime envelope.

Switching the harness `MODEL_URN` to a new fixture, and any new live G1 run, are separate owner decisions. Neither is authorized by this task.

### Audubon Architecture note

`Audubon_Architecture_clash_test.rvt` is confirmed SVF2. However, the accepted F1 enumeration path (`createViewerElementEnumerator().resolveRoots(binding,'whole')`) threw `EnumerationInconsistencyError` with reason `tree-reachable-fragment-unattributable` (fragId 4601, class `N`). This happened even though `model.isLoadDone()` was already `true`.

Capacity therefore could not be measured through the accepted path, and the harness's own `scoreF5` classifies this as `BLOCKED`, not as a capacity breach. The model was not reloaded (one attempt only). It is recorded as `INSUFFICIENT_EVIDENCE`. The enumeration inconsistency may matter to G1 in its own right, but this screening did not investigate it further.

## Candidate discovery

1. **Repository references.** URNs cited in the repo (`*.js`/`*.mjs`/`*.md`/`*.json`/`*.html`, `node_modules` excluded) are:
   - RAC (`racbasicsampleproject.rvt`);
   - `Audubon_{Architecture,Structure,Mechanical}_clash_test.rvt`;
   - `A250-E-MB-CND-STR-03.ifc`.

   The earlier [prerequisite check](2026-09-27-viewer-clash-panel-g1-svf2-prerequisite-check.md) also named `linked_model_clash_test.rvt`, `main_model_clash_test.rvt`, Snowdon Towers and `rac_advanced_sample_project.rvt`. It tested them only under the production initializer (`isOTG:false`), which does not decide SVF2 status under `AutodeskProduction2`/`streamingV2`.
2. **Bucket listing (read-only).**
   - **Server endpoint:** the existing `GET /api/models` endpoint returned 100 objects.
   - **Sizes and manifests:** a Node script reused the existing `services/aps.js` read-only `listObjects`/`getManifest` functions (GET only). It is saved as the manifest-listing script in evidence.
   - **Result:** 62 of 100 objects have a successful `svf2` derivative with a 3D viewable. The rest are `svf`-only, `ifc`-only, failed, or have no manifest (2 × HTTP 404).
   - **Why a live load is still required:** as recorded before, a manifest `svf2` label alone does not decide what loads. The manifest was used only to skip pointless loads.
   - **Mutation caveat:** `listObjects` calls the existing `ensureBucketExists`. That makes a bucket-details GET, which could create a bucket only on a 404. The bucket exists, so no create occurred.
3. **Selection.** The screen started with this project's own clash fixtures, all of which have `svf2` manifests with 3D viewables: the three Audubon models, `main_model_clash_test.rvt` and `linked_model_clash_test.rvt`.
   - **Stopping point:** screening stopped after these five because two clearly suitable, non-trivial candidates (Audubon Mechanical and Audubon Structure) had full evidence.
   - **Not loaded:** the other 57 SVF2-manifest bucket objects (small IFCs, other Revit and Navisworks files), the RAC fixture (reference only) and `A250-E-MB-CND-STR-03.ifc`.

## Method

The script is `docs/research/evidence/2026-09-29-g1-svf2-fixture-capacity-screening-script.mjs`. It ran from the session scratchpad; the copy in evidence is byte-identical and imports the harness by absolute repo path.

It does not reimplement the harness. It **imports** the accepted harness module `test/acceptance/g1-svf2-f1-f8-verification.mjs` and uses the harness's own:

- page setup: `BARE_PAGE_HTML` (pinned Viewer `7.124.2`, `Initializer({env:'AutodeskProduction2', api:'streamingV2'})`, `GuiViewer3D`), `buildBootstrapScriptSource`/`buildRealPageDeps` (registry extended only with two read-only screening helpers), `/clashtest/**` routing via `handleClashtestRoute` with the `/clashpanel/**` route mirrored, and `installG1Modules(SERVED_MODULE_ENTRY_POINTS)`, which includes `/collision/geometry/activeRangeCompaction.js`;
- load path: `startLoad` with `documentLoadStarter` and `loadDocumentNodeStarter` (`loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), {})`);
- classifier: `captureModelFormatSignals`, `buildFormatSignalShim` and `readFormat`;
- measurement: `setupSharedSessionResources`, `observeF1`, `observeF2`, `observeF4` (`getRenderProxy → adaptViewerGeometry → compactAndWeld`) and Node-side `scoreF5`, which supplies the existing limits from `collision/constants.js`.

Importing the harness does not run its `main()`, because of the `isDirectInvocation` guard.

Per candidate, the script used one attempt in a fresh Chromium browser:

1. Bootstrap the page and install the modules.
2. Load the model and classify it.
3. Stop if the classifier did not return `CONFIRMED_SVF2`.
4. Wait up to 180 s for `model.isLoadDone()`. This is a screening addition; the harness does not wait for it. It makes sure the whole population is loaded before the census.
5. Run Phase 2.5, then F1, F2, F4 and F5 scoring.
6. Run an in-page read of F4's retained `f4Geometry`, `f4FragmentGeometryId` and `f1PopulationRecords` to name the argmax geometry, its representative fragment and dbId, its instances and its node name. `observeF4` returns only the maximum, not who is responsible.

There were two script invocations: run 1 with `main_model_clash_test`, and run 2 with the other four candidates. No candidate was loaded twice. Run 1 also served as the script's first real exercise, and it succeeded.

## Runtime envelope

| Item | Value |
| --- | --- |
| Node | v22.23.1 |
| Playwright | 1.62.1 (repo `node_modules`) |
| Chromium | 151.0.7922.34 (Playwright bundled) |
| Viewer | 7.124.2, `viewer3D.js` SHA-256 `12b9fe49…97c02e` = harness `EXPECTED_VIEWER_SHA256` (verified per candidate) |
| Initializer | `env: 'AutodeskProduction2'`, `api: 'streamingV2'` |
| Server | `npm start` (port 8080), used only for `GET /api/auth/token`, `GET /api/models` and static `/collision`/`/vendor`; stopped with `pkill` afterwards |
| Timestamps (UTC) | run 1 `2026-09-29T13:16:43.2Z → 13:16:54.8Z`; run 2 `13:17:06.4Z → 13:17:44.2Z` (per-candidate `startedAt`/`finishedAt` in the JSON) |

## Limitations

- This is a single-run screening. It does not replace a G1 F1–F8 run, and its F1/F2/F4 observations are not G1 verdicts. F3, F6, F7, F8 and all controls were not run, so suitability for those checks (for example, the F7 calibration band) is unknown.
- The `isLoadDone()` wait is not part of the harness flow. A future harness run without it could observe a different class-N population. For every measured candidate, loading finished within 2–5 s, before Phase 2.5 would plausibly begin.
- Only 5 of the 62 SVF2-manifest bucket objects were loaded. The others are unscreened.
- `maxActiveTriangleCount` is computed per distinct geometry, over the representative fragment's render proxy, exactly as in `observeF4`.
- Audubon Architecture's capacity is unknown because of the F1 enumeration exception described above.
- The persisted files contain no tokens or secrets. URNs are the same kind of base64 object IDs already cited in the repo.

## Owner-clarified interpretation

- The screening establishes only that `Audubon_Mechanical_clash_test.rvt` (recommended) and `Audubon_Structure_clash_test.rvt` (alternate) meet the measured format/capacity prerequisites (confirmed SVF2/OTG, max active triangles 4,228 and 7,140 ≤ 12,000, other measured limits within bounds). It is **not** proof that either passes F1–F8.
- `Audubon_Architecture_clash_test.rvt` is confirmed SVF2 but screening is incomplete (`EnumerationInconsistencyError` / `tree-reachable-fragment-unattributable`, fragId 4601). This is a **separate research residual**, not a blocker to selecting another fixture.
- RAC (max active triangles 21,845 > 12,000, `OVER_EXISTING_LIMIT`) is not suitable as an overall-G1-PASS fixture under the current contract.
- `linked_model_clash_test.rvt` and `main_model_clash_test.rvt` are suitable but very small.
