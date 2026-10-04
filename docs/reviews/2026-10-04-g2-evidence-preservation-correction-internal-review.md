# G2 evidence-preservation correction — focused internal review

Scope: only the correction for independent-review findings H1/M1/L1 ([review](2026-10-04-g2-immutable-evidence-preservation-independent-review.md)). Self-review by the implementing session; no G2 finding reinterpreted. Findings: **0 Critical / 0 High / 0 Medium / 0 Low**.

| Item | Result |
| --- | --- |
| H1 ignored-log staging | `.gitignore` gained two exact-path negations (lines 491–492) for `operator-log/g2-live.log` and `operator-log/server.log` only; `*.log` otherwise unchanged. `git check-ignore -v` now reports the negation rules; `git ls-files --others --exclude-standard` and `git add -n` list all 10 evidence files plus `MANIFEST.md`. Log bytes untouched. |
| M1 exit artifact | MANIFEST now states `g2-live.exit` exists, is preserved as a distinct file (`EXIT=1`, non-authoritative companion). |
| M1 C20/screenshots | MANIFEST now states C20 was `BLOCKED(dependency:C8)` and never ran; no rendering/screenshot evidence existed at source (R1 `screenshots:[]`, `c20:null`); nothing lost. R1 role text no longer implies a C20 record with content. |
| Hash preservation | 10/10 source = preserved SHA-256 re-verified after the correction; each hash appears in MANIFEST. |
| L1 prompt bookkeeping | Handoff acknowledges the preservation prompt and correction prompt as non-authoritative task artifacts. |
| Scope | Changed: `.gitignore`, `MANIFEST.md`, this review, handoff. No harness/test/procedure/production file changed; `git diff --check` clean. |
