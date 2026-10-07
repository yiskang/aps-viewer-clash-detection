# Internal review — Viewer Clash Panel Test Setup / Interaction UX Cleanup (2026-10-07)

Reviewer: Codex advisor (medium, read-only) + Claude visual triage. Baseline `060b738`.

**Result: 0 Critical / 0 High / 0 Medium (1 fixed) / 3 Low (fixed or recorded).**

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Medium | `buildDefinition` defaulted `verifiedBasis` to `true`, a fail-open default for callers omitting it | Fixed: default `false`; tests rewritten to assert fail-closed |
| 2 | Low | No race tests for basis verdict transitions | Fixed: 3 controlled-promise tests (stale verdict, verified↔unverified after attestation, pending re-check with attestation) |
| 3 | Low | Units error text not programmatically associated | Fixed: `aria-describedby` |
| 4 | Low | PD-17 amendment wording ambiguous about `verified` | Fixed in spec |

Own findings from tests/headed evidence, fixed: ViewModel basis option objects not frozen; duplicate "Ready to run"/"Completed · Completed"/"Stopped before any results"; duplicated clearance error in readiness list; unit label alignment.

Verified positives: participant change and New test drop the attestation; pending blocks Run; run record captured at admission; non-verified states never display as verified.
