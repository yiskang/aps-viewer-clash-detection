# Evidence: Architecture self-clash post-Option-A real-model headed profile (2026-10-07)

Supports [`docs/research/2026-10-07-architecture-self-clash-post-option-a-profile.md`](../../2026-10-07-architecture-self-clash-post-option-a-profile.md).

Scenario: normal app (`http://localhost:8080/#<URN_ARCH>`, no demo flag), SVF2 `Audubon_Architecture_clash_test`, APS Viewer 7.124.2, Playwright MCP Chromium 154 headed. Real Clash Panel: Hard, Set A = Architecture, Set B = Same as Set A. Every run was stopped with the Panel's Stop button.

- **Run F** (full profile): 3,034 units evaluated, Stop in the tail.
- **Run L** (lite profile): 628 units, Stop in the tail; instrumentation-overhead comparison.
- **Run S2** (lite profile): 2 units, Stop during the in-flight head unit `3b.1`.

Product sources on disk were **never instrumented**. The marks were applied only inside the profiled browser by a Playwright `page.route` rewrite of the served module text (`instrumentation.patch` is the exact served diff), gated by `window.__CLASH_PROFILE`. The only product change in this package is the Option A executor change (`clashtest/execution/LocalUnitExecutor.js`), which the browser ran from the working tree.

| File | Role | SHA-256 |
| --- | --- | --- |
| `instr-replacements.mjs` | Source of truth for the 12 gated marks, adapted to the Option A checkpoint | `fca1957641ad0d5a0cfd628ee62b8ac5a5f39906e97bfd7f5086cba48ed0c919` |
| `build-instr.mjs` | Builds patched scratch copies and the install scripts (unchanged copy of the pre-A script) | `515315660d09310412b7cebafb773f1997e20ee6ac2ded4fe73d350cc3dbae51` |
| `install-profile-full.js` | Playwright `run_code`: init script (full profile) plus route rewrite | `3727eff593f86d46eb1acc89c25e480d64f6c921efc307081ab2d7552922452e` |
| `install-profile-lite.js` | Same, minimal-instrumentation variant (runs L and S2) | `2a6f5e9269b17071e74f178fec5e60f378073acb1a3be899e776606e8b67f582` |
| `instrumentation.patch` | Unified diff, original → served, for `LocalUnitExecutor.js`, `scopeDigest.js`, `Run.js` | `75bf29deda7fe81e21d25deabd3546a5d59b9aef93db062774527ee26241513b` |
| `profile-full.json` | Raw `window.__CLASH_PROFILE` from run F plus environment fields (JSON-encoded string, as captured) | `7da426219a0da907fbcb14bfb93d39ef1497a6984f79badec72744f5225f0c7c` |
| `profile-lite.json` | Same for run L | `a7ae4182362198994cdb3e80d450cce031624b4d6f41e4e7162a95ac916d08b6` |
| `profile-stop2.json` | Same for run S2 | `f1d2b8c69cf5bac1d01909a6fcad0c4eda5496d59bc5e86b7ff20c5603b8eae5` |
| `analyze.mjs` | Derives every number in the report from the raw profiles; also reads the pre-A `../2026-10-07-self-clash-real-profile/profile-full.json` for the integrity comparison | `22b788fbe5f8070de15dccedc48ee60ec86c1bd73ca9329f526fd39d5168da73` |
| `summary.json` | Output of `node analyze.mjs` | `43d4d5655fd01312a8fb8f7fe64299bc41ade8402e1f7fdd4c04eaa6b8cca781` |
| `console-full.log` | Browser console, run F (0 errors; 1 pre-existing `getInstanceTree` deprecation warning; font "slow network" info) | `f6cf34e87fd79f62bf207a7cd4f16f688763dd9eeffab7e97ef377d014b1cd9e` |
| `console-lite.log` | Browser console, run L (same) | `f9246ac1c5aa63694881c310c04e94e05af0b963a6cdb3b64a09fcee0bb87314` |
| `console-stop2.log` | Browser console, run S2 (same) | `fbda115b41873c5fb849d153b9aabb61ec38444a2c4a01e04177d1173e5eaad3` |
| `full-profile-in-progress.png` | Run F while running | `988c7ef19fad414d8d07017d424d793fed4539fa98bd3acf8b83e914f61cf5dc` |
| `full-profile-after-stop.png` | Run F after Stop: Stopped, cancelled, partial, 4,395 clashes, 1,260 not evaluated | `d0f266f403cb140389f69c9366c1e28e8c0e95b68ec6e2c68080277248e8bc7b` |
| `lite-profile-in-progress.png` | Run L while running | `aded091661811ef3731b7ba464e5c623a0497fbbe6cd28aaab0d61cc68221508` |
| `lite-profile-after-stop.png` | Run L after Stop | `1d3269b93a035bd454d7e78134c00fd2db28df5d74e4292071e6586caad0fb21` |
| `stop2-head-after-stop.png` | Run S2 after Stop during head unit `3b.1` | `20cb4e5cdcb91c7f5be092b05545e2b9e03b74c8ce2a58e72b341217ee1f7956` |

Note: two console logs are byte-identical to pre-A console logs (`console-full.log` = pre-A `console-lite.log`; `console-stop2.log` = pre-A `console-full.log`). The console export has no timestamps and these sessions logged the same messages.

To verify the hashes, run `shasum -a 256 $(ls | grep -v '^README.md$')` in this directory.
