# Evidence: Architecture self-clash real-model headed profile (2026-10-07)

Supports [`docs/research/2026-10-07-architecture-self-clash-real-model-profile.md`](../../2026-10-07-architecture-self-clash-real-model-profile.md).

Scenario: normal app (`http://localhost:8080/#<URN_ARCH>`, no demo flag), SVF2 `Audubon_Architecture_clash_test`, APS Viewer 7.124.2, Playwright MCP Chromium 154 running headed. In the real Clash Panel: Hard, Set A = Architecture, Set B = Same as Set A. Both runs were stopped with the Panel's Stop button.

- **Run F** (full profile): 12 units evaluated.
- **Run L** (lite profile, used to measure instrumentation overhead): 11 units evaluated.

Product sources on disk were **never edited**. The marks were applied only inside the profiled browser, by a Playwright `page.route` rewrite of the served module text. `instrumentation.patch` is the exact diff of what the browser ran.

| File | Role | SHA-256 |
| --- | --- | --- |
| `instr-replacements.mjs` | Source of truth for the 11 gated marks (anchor/replacement table) | `5b3641e9f1740664d1fe0f16ad9dbf341f0d180e5da4d81fc7a4ef77785542de` |
| `build-instr.mjs` | Builds the patched scratch copies and the two install scripts from the table | `515315660d09310412b7cebafb773f1997e20ee6ac2ded4fe73d350cc3dbae51` |
| `install-profile-full.js` | Playwright `run_code`: init script (full profile) plus route rewrite | `9c448084494da10ad13b915afa8a3fe128d1709985532d8bd341115555926cea` |
| `install-profile-lite.js` | Same, minimal-instrumentation variant | `6cecc7814e79c60c17b8dc710a03b6270e7bd8c962cc37da4485fc3aec0bf1be` |
| `instrumentation.patch` | Unified diff, original → served, for `LocalUnitExecutor.js`, `scopeDigest.js` and `Run.js` | `e81109de2d08cc45fbc0f84bd18002c655c135e4e4901f4fce3bd2da1cc6dc14` |
| `profile-full.json` | Raw `window.__CLASH_PROFILE` from run F, plus environment fields. It is stored as a JSON-encoded string, as captured. | `756d9cf04c75e373228a66be10aa3c7e9a92fca998d1e48aa7ef143dafd513cb` |
| `profile-lite.json` | Same for run L | `87a0037bd722c1f719a46b7b60ed4e58c4b561397d0c203caf26f6d4896107a1` |
| `analyze.mjs` | Derives every number in the report from the two raw profiles | `0bd017c51d05882926069d8e92099e35a4046eaf7edeb77c28d995a3f927b046` |
| `summary.json` | Output of `node analyze.mjs`: per-unit table, latency distribution, phases, Stop timing | `01b5dd0eff6a278a95b49838495e3d66125d67f96ccc14e7f27a1b4c775be87d` |
| `console-full.log` | Browser console, run F (0 errors; 1 pre-existing `getInstanceTree` deprecation warning) | `fbda115b41873c5fb849d153b9aabb61ec38444a2c4a01e04177d1173e5eaad3` |
| `console-lite.log` | Browser console, run L (0 errors; same warning plus "slow network" font info) | `f6cf34e87fd79f62bf207a7cd4f16f688763dd9eeffab7e97ef377d014b1cd9e` |
| `full-profile-in-progress.png` | Run F while running (`units 11/4294`) | `60ccd93e090d627d837be778e90fe2fbb4899afaf1639666bf000e903099e070` |
| `full-profile-after-stop.png` | Run F after Stop: Stopped, cancelled, partial, 1,858 clashes, 20,505 diagnostics | `7fa53236d7e7e9780f9e75032021c85d7048a9f666fca74a0a8898e7fa2ccfa6` |
| `lite-profile-in-progress.png` | Run L while running | `40af154196a704c2bd08db69372730d3ea48a9d1bd9c1b52c249e33a78c11638` |
| `lite-profile-after-stop.png` | Run L after Stop | `f5f82a1d5085f47ba35b6b1ccdca04c5ecd474dd7e3624b1718e05aa9308555f` |

To verify the hashes, run `shasum -a 256 $(ls | grep -v '^README.md$')` in this directory.
