# Evidence: Architecture self-clash, post-Option-D/E real-model headed profile (2026-10-07)

This folder supports [`docs/research/2026-10-07-architecture-self-clash-post-d-e-profile.md`](../../2026-10-07-architecture-self-clash-post-d-e-profile.md).

**Setup.** The app ran in normal mode (`http://localhost:8080/#<URN_ARCH>`, no demo flag) on SVF2 `Audubon_Architecture_clash_test`. Viewer: APS Viewer 7.124.2. Browser: Playwright MCP Chromium 154, headed. The test used the real Clash Panel with Hard mode, Set A = Architecture, and Set B = Same as Set A.

**Runs.**

- **Run F** (full profile) evaluated all **4,294 / 4,294** units and completed: 4,770 clashes, 57,130 caveats. Progress was sampled at the head, middle and late stages.
- **Run M** (lite profile) was stopped with the Panel's Stop button after 1,707 units.
- **Run H** (lite profile) was stopped with the Panel's Stop button during the in-flight head unit `3b.1`.

**Instrumentation.** No product source on disk was instrumented. The marks were applied only inside the profiled browser, by a Playwright `page.route` rewrite of the served module text, gated by `window.__CLASH_PROFILE`. `instrumentation.patch` is the exact served diff.

**What the browser ran.** The browser ran the working tree **before** the two post-review edits described in report §11:

- the fallback to `snapshot()` when `counters()` is absent;
- the `(k not evaluated)` suffix on the units counter.

Neither edit changes the measured runs. The engine aggregator always has `counters()`, and no unit failed or was skipped. Because of the first edit, the `counters()` anchor in `instr-replacements.mjs` no longer matches the current `clashtest/run/Run.js`. To rebuild against the current tree, change that anchor's `find`/`replace` to the line `const diagnostics = typeof aggregator.counters === 'function' ? aggregator.counters() : aggregator.snapshot();`.

| File | Role | SHA-256 |
| --- | --- | --- |
| `instr-replacements.mjs` | Source of truth for the 14 gated marks: post-A marks, plus `counters()`, the seal `snapshot()` and `addUnit` timing | `dec44ab083e0eb407aa0412c89330477ee319663c6df1df06d38db88a55fa1c1` |
| `build-instr.mjs` | Builds the patched scratch copies and the install scripts (post-A copy plus a page-wide `longtask` PerformanceObserver) | `a8c3cae53eef9d3341dc96a645156f6cc41eb99bf9d6ca02a688ac2d7822ee21` |
| `install-profile-full.js` | Playwright `run_code`: init script (full profile) plus route rewrite (run F) | `5c5fffb9559eae9a604175f4d1b5c07701413f7c7c7550d9015425b5f0619d45` |
| `install-profile-lite.js` | Same, minimal-instrumentation variant (runs M and H) | `b4bf9f075ccbfba36c0fe5ce781cbc622f54eed209a76f3905f22173d19624d0` |
| `instrumentation.patch` | Unified diff, original → served, for `LocalUnitExecutor.js`, `scopeDigest.js` and `Run.js` | `a402cdb6060b95d1c6574a6814eba3871c66a8a2442f4291f0463a095ce72752` |
| `profile-full.json` | Raw `window.__CLASH_PROFILE` from run F, with environment fields, Panel run details and the 56 middle/late progress samples (JSON-encoded string, as captured) | `6347cd03769c3b72502128161f8daba96276e72e9799a0f3d50b7007a882cc22` |
| `profile-stop-mid.json` | Same, for run M | `8d3496f359e8a85649b70089b9d610e3c6f9608d1514a9aacf097d6ce3937288` |
| `profile-stop-head.json` | Same, for run H | `76082501a5c38efe2a00ab503c65bceb0ed59a82e46850f8d611903e0a806088` |
| `progress-head-samples.json` | Run F head-phase Panel progress samples (units 0–158) against the true settled units and the pair-space % | `827d6c2942679b35058501652da3c17c572f8902e5105aeea6e0af0242e7dd07` |
| `analyze.mjs` | Derives every number in the report from the raw profiles. It also reads the post-A `../2026-10-07-self-clash-post-option-a-profile/profile-full.json` for the before/after and per-unit equivalence | `7865bc964c84bb86b9e2aedc3757805de8af0da99909ae7c0b5d083dc10d3b66` |
| `summary.json` | Output of `node analyze.mjs` | `cfa6cc7ca64e61cfa90b0c42dbe4bd3074bf29df7550bd262f0b447cd82a055d` |
| `offline-pre-vs-post-d.mjs` | Offline end-to-end Option D probe: real engine, real `CollisionWorld`, production Viewer enumerator. Prints hashes of the sealed set, the diagnostics and the per-unit progress | `9d9c67ee4c575f99a07679c96edeaa327e606dfaf773ff432402ab013a3e00cb` |
| `offline-pre-vs-post-d.txt` | Its output against a pre-D scratch tree (HEAD `dcdab38` `Run.js` + `diagnostics.js`) and against the post-D working tree. All hashes are identical. | `2ad02a10fc37b8269e203f6a99b9eeb8ad6d213a460c498d4ec454f94c1d3bff` |
| `console-full.log` | Browser console, run F: 0 errors. Warnings: 1 pre-existing `getInstanceTree` deprecation and 3 three-mesh-bvh "coplanar triangles". | `d6b0bb35291bdf0ff3b5068e41408713d89dff4513e8209ccce15195ec49dd5a` |
| `console-stop-mid.log` | Browser console, run M (0 errors) | `f9246ac1c5aa63694881c310c04e94e05af0b963a6cdb3b64a09fcee0bb87314` |
| `console-stop-head.log` | Browser console, run H (0 errors) | `f6cf34e87fd79f62bf207a7cd4f16f688763dd9eeffab7e97ef377d014b1cd9e` |
| `progress-head.png` | Run F at unit 48: "1% of units · units 48/4294" (pair space is 66.7% at this point) | `c27863397bc5132df52e99b9d8ef3720d5411c29da2e188c44e210a9f032f50b` |
| `progress-middle.png` | Run F at unit 2,063: "48% of units" | `db2985f97373dbededa6a9a9a389c3f0b3f1e310da2933e76370f340f57cf0a5` |
| `progress-late.png` | Run F at unit 3,931: "92% of units" | `458817e1e2554f5e491685c953f8fca13329f3e7e65a79e3eb1dc4dc9a3e1d54` |
| `full-run-completed.png` | Run F completed: 4,770 clashes, Coverage full, Integrity caveated | `af70d02ca1b2d6181e4ed1317dce4b17b32250dab6d56dcc092540b7c8666def` |
| `stop-mid-after-stop.png` | Run M after Stop: Stopped, partial, 3,786 clashes | `1e11ecd20cf9707d914aa54fcfdffa4e665e5e4573aae6f917ff535950d6ec3a` |
| `stop-head-after-stop.png` | Run H after Stop during head unit `3b.1`: 926 clashes | `551a7e0020a9ed7cc5a36f395f402ad518250f6816457e3ddc581c4f6394efcd` |

Two console logs are byte-identical to post-A console logs: `console-stop-mid.log` matches post-A `console-lite.log`, and `console-stop-head.log` matches post-A `console-full.log`. The console export has no timestamps, and these sessions logged the same messages.

To verify the hashes, run `shasum -a 256 $(ls | grep -v '^README.md$')` in this directory.
