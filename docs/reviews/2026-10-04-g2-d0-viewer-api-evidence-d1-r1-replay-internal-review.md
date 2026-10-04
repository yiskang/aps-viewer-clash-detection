# Internal review — G2 D0 Viewer API evidence + D1 R1 replay

- **Artifact:** [research](../research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md)
- **Reviewer:** Codex (`codex-review spec`, medium), request `20261004-162811-62485-14490`; one focused pass. The D0 T4 reasoning also had a prior Codex advisor pass (request `20261004-162251-55510-16991`; three corrections applied before drafting).
- **Scope reviewed:** source/API accuracy, public vs internal distinction, lag-inference strength, replay math, fact/inference labeling, D2 recommendation, T4 framing, C6 margin, scope discipline.
- **Result as reported:** 1 Critical / 3 High / 2 Medium / 0 Low. Reviewer confirmed the call path, T4 description, and math-vs-camera separation as accurate.

| # | Reported | Finding | Disposition |
|---|---|---|---|
| 1 | Critical | Internal review and handoff update absent | **Accepted as sequencing; resolved** by this document and the handoff update (review ran before they existed). Not a content defect. |
| 2 | High | "Exact / assumption-free" N2 attribution unsupported | **Accepted, fixed.** Reworded "strongly consistent with"; assumptions listed (B:111 bounds, aggregate-fit padding unpublished, no-op not excluded); lag classification downgraded to "moderate-to-strong pattern, unproven cause"; matrix confidence lowered to Medium. |
| 3 | High | 0.9 fill derived from the disputed sample (self-referential) | **Accepted, fixed.** 0.9 labelled an observed similarity metric only; independent derivation of aggregate-fit padding deferred to D2; C6 rejection restated on grounds independent of 0.9. |
| 4 | High | D2 criteria prove model sufficiency, not live cause | **Accepted, fixed.** Decision gates added: D2 = mechanical possibility + discriminator behavior; not live root cause; T4 candidate design may follow D2; implementation/procedure re-acceptance requires instrumented live evidence. |
| 5 | Medium | Listener removals presented as completion events | **Accepted, fixed.** Relabelled "inferred completion timestamps / indirect proxy" with the assumption stated. |
| 6 | Medium | Source/replay not reproducible from retained artifacts | **Accepted, fixed.** Reproducibility appendix added; replay scripts and output copied to `docs/research/2026-10-04-g2-d1-replay-scripts/` (new files only). The ~11 MB Viewer bundle is not committed; digest and symbol anchors given. |

**Open after review:** 0 Critical / 0 High. Remaining items are explicit research gaps (home camera, B:111 box, per-frame samples, no-op fit H4, listener registrant), not defects.

**Not re-reviewed:** no second Codex pass; the fixes were wording downgrades and additive sections, and repo rules bound internal loops after remediation.
