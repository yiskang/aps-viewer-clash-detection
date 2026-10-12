# CTM-8 rebuild-cost calibration — evidence (CTM8-P0-v4)

Calibration observations only; **tested points are calibration observations, not product limits.** No limit, budget, threshold or pass/fail is derived.

- `protocol-version.txt`, `environment.json`, `commands.md`, `launch{0,1,2}.meta.json` / `.done.json`, `raw-console-launch*.log`, `launch-exit-codes.log`
- `raw/headless-launch{0,1,2}.jsonl` — 8,100 sample records (2,700 per launch: 2,340 measured + 360 warm-up), every record `status: OK`
- `raw/headless-launch{0,1,2}.cells.jsonl` — 84 cell results per launch (252 total, all COMPLETED), with manifests/fixture hashes and GC covariates
- `summary/headless-matrix.{md,json}` — per-launch (authoritative), headline = median of launch medians, separate POOLED, paired R-GROUP-WARM − R-WARM, descriptive per-unit-cost ratios
- `headed/` — Family R headed corroboration (9 real points, 216 samples); Family M HM-REC UNAVAILABLE (see `headed/blockers.md`)
- `anomalies.md`, `MANIFEST.md`, `checksums.sha256`

Reproduce: `node test/calibration/ctm8/run-campaign.mjs --launch <0|1|2> --out <dir>` (three separate processes), then `node test/calibration/ctm8/summarize.mjs --in <dir>`. SKEWED and `-PULL` were not executed.
