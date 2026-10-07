# Evidence closeout — SVF2 Clash Finder compatibility (2026-10-07)

Durable, bounded copies of the final live acceptance and M3 performance evidence for the integrated package
(final report `docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md` §10–§14).
Produced on the **final integrated working tree** (HEAD `2529402` + uncommitted package; see `HEAD.txt`), SVF2 default,
dev server `npm start` on :8080, Viewer 7.124.2, Audubon fixtures. Originals live in gitignored
`test/acceptance/results/` and `test/performance/results/`; these copies are the repository evidence. Integrity: `SHA256SUMS.txt`.

| File | What it is | Result |
|---|---|---|
| `clash-finder-run-report.json` / `clash-finder-run.log.txt` | `npm run test:acceptance:clash-finder` (SVF2) | **257/257**, 16 N/A (not counted); 0 console/page errors; `modelFormat: svf2`; informational diagnostics asserted (2 × `fragment-null-geometry`) |
| `room-locator-run-report.json` / `room-locator-run.log.txt` | `npm run test:acceptance` (SVF2) | **13/13** |
| `m3-gate-svf2.json`, `m3-gate-svf.json`, `m3-gate-svf2-criteria.json` / `m3-gate-run.log.txt` | `npm run test:performance:gate:m3` (two formats, post no-surface amendment) | **allPass**: (a) build accounting PASS (96 builds = 96 distinct keys per world); (b) peak derived memory 365,880 B vs 7,595,514 B SVF canonical (0.048×) PASS; (c) SVF2/SVF wall time 1.31 / 1.03 / 1.36 / 0.96 PASS; (d) legacy SVF worst single call **7.3 ms → GO** in this run |

Semantics notes (nothing weakened):
- The Clash Finder report is the *re-baselined* suite (format-local Soft baselines, informational diagnostics asserted visible, roof present under SVF2). Its byte-identical hash matches the report the targeted independent review inspected (`f4425dfb…aae2a0`), as does Room Locator's (`5c0b9075…877645`) — the suites are deterministic and these are re-runs on the same code.
- M3 SVF2 report contains **0** `clearance-anisotropic-scale-unsupported` diagnostics (post-amendment); the earlier retained pre-amendment report had 212 (review finding M1). Diagnostics now: 2 × `fragment-null-geometry`, 288 `clearance-hard-clash-precheck-inconclusive` (SVF2); 461 inconclusive (SVF).
- Criterion (d) is a timing measurement and varies run to run: the previous gate run recorded 9.6 ms (CAUTION, 1/532 spans over budget, p99 5.8 ms), this run 7.3 ms (GO). Both are recorded; the independent review's disposition (accepted non-blocking CAUTION) is unchanged and no threshold, constant, or production code was touched.
- The N/A checks, the conditional incompleteness-caveat check and the load-sensitive 34/33 pair counts are unchanged from the reviewed suite (review Low L1).

Reproduce: `npm start` (APS credentials in `.env`), then `npm run test:acceptance:clash-finder`, `npm run test:acceptance`, `npm run test:performance:gate:m3`.
