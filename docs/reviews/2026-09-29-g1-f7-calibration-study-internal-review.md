# Internal review — G1 F7 calibration study (research only)

**Date:** 2026-09-29 · **Base:** `main` @ `596dab3` · **Reviewed:** [`docs/research/2026-09-29-g1-f7-calibration-study.md`](../research/2026-09-29-g1-f7-calibration-study.md) · **Reviewer:** Codex (`codex-review spec`, medium; request `20260929-235021-91530-6231`) · Scope: evidence extraction, numeric-path reasoning, candidate-rule derivation, overfitting/generalizability, CAL disposition. No harness/tolerance/production change.

**Verdict on disposition:** CAL-B (keep G1 `PARTIAL`) judged reasonable; initial readiness "requires major revision" for evidence wording, probe spec and missing deliverables. All findings below were remediated in the study (single pass; not re-sent to Codex — remediation was wording/spec narrowing, no change to disposition or numbers).

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Critical | Review artifact and handoff update absent | Fixed: this file + `docs/handoffs/latest.md` updated |
| 2 | Critical | "exactly 1 fragment" and "all 1,496 fragments Float32Array" overstated (only a lower bound is retained; positions observed via 438 representative proxies) | Fixed: narrowed wording; exact fragment membership and per-fragment proxy signatures added to missing evidence |
| 3 | High | Future probe not executable (no snapshot, APIs, failure rule, controls, decision table) | Fixed: minimal probe spec + decision table added; still requires separate owner authorization |
| 4 | High | Mann-Whitney treats correlated dbIds as independent | Fixed: labelled exploratory; "do not differ" reworded to "no association detected" |
| 5 | High | Candidate-rule coverage described as exhaustive; ULP agreement counts not computed | Fixed: split into evaluated / qualitatively rejected / unevaluated; ULP agreement counts remain uncomputed (stated) |
| 6 | Medium | Scripts had machine-specific paths and output names differing from retained files | Fixed: repo-relative I/O, retained filenames; regenerated outputs compared equal to retained JSON (4/4) |
| 7 | Medium | "Envelope looseness necessary" mathematically wrong | Fixed: "observed in all 26, neither necessary nor sufficient" |

Open clarifications from the reviewer (probe purpose; proxy equivalence per geometryId; what outcomes would justify CAL-A/C; F7 PASS denominator) are carried as owner questions in the study §8.

**Residual uncertainty:** cause of the 26 envelope excesses is unexplained; single fixture; per-fragment matrices/boxes not retained.
