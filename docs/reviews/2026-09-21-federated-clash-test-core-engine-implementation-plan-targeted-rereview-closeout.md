# Federated Clash Test core-engine plan — targeted re-review closeout

- **Scope (targeted only):** spec erratum A1; P7.4 Step 3a; P7.8 Steps 17a/17b; master §6 line (e); directly affected traceability (AC-16, AC-19 rows, P7.11 Step 3 walk); the two post-round-2 Step 3a / P7.10 edits. **Not** a full design or plan review.
- **Baseline:** [`…-plan-remediation-review.md`](2026-09-21-federated-clash-test-core-engine-implementation-plan-remediation-review.md) (3 High, 2 Medium) and the owner dispositions of 2026-09-21 (AC-16 "Option 2" / erratum A1; AC-19 (b′)/(d′) closed in core; `migration-failed` accepted as a non-blocking deferral).
- **Reviewer:** Codex via `codex-advisor` (read-only). Request ids below; raw responses live in `.codex-worker/responses/<id>/` (not committed).
- **Branch / HEAD:** `feature/m4-performance-worker-decision-design` / `e29efec23a407b002358f43d35d1a2a2704ab113` (working tree uncommitted).

## Rounds

| # | Request id | Result | Disposition |
|---|---|---|---|
| 1 | `20260921-102756-30939-29127` (high) | A1, AC-19 (b′)/(d′) steps, 20,000-instance test, G-CAL classification, migration-failed deferral + P7.11 exception: **sound**. 2 High + 1 Medium + 1 Low in Step 3a / G-PLAN count (permissive cause assertion + constant-Set; bounded-work test observed a separate `validateTest` call; `set === null` skip; "four" vs five lines) | All fixed (exact `planningGaps` equality per arm; persisted copy required; "five") |
| 2 | `20260921-104226-40760-11203` (medium) | RunSpec shape consistent, no new architectural defect. Open: (a) resolver tested only directly, not as engine-constructed (High); (b) P7.10 did not pin factory absence from the barrel (Medium) | Fixed: `createStoredDefinitionResolver` factory; P7.10 absence pin |
| 3 | `20260921-110051-51954-444` (medium) | P7.10 absence pin **sound**. Wiring test **not sound**: built via a second constructor, so a divergent public path could pass | Fixed: single constructor + non-barrel `withStoredDefinitionValidator(validate, fn)` seam; test drives the PUBLIC `createClashTestEngine` |
| 4 | `20260921-110612-55952-8429` (medium) | Wiring test: **sound**; no findings | — |

## Verdict

**Targeted re-review complete — no remaining blocking findings in the scoped areas.** Remaining verified facts: AC path check 94 citations / 0 missing; `git diff --check` clean; `clashtest/` and `test/clashtest/` absent. All conclusions are plan-level: no implementation exists, so wiring/behavior claims are unexecuted.

## Limits of this review (for G-PLAN line (a))

- It covers only the scoped areas above; the rest of the plan was last reviewed by the [remediation review](2026-09-21-federated-clash-test-core-engine-implementation-plan-remediation-review.md), which found the remaining original findings resolved. Whether the two together satisfy master §6 (a) "no blocking plan findings against the current plan text" is the milestone owner's call.
- It does not authorize implementation and does not fill any master §6 checkbox.
