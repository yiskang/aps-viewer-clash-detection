# Federated Clash Test core — P1 internal Codex review (targeted)

- **Date:** 2026-09-21 · **Branch:** `feature/federated-clash-test-core-engine` · **Scope:** P1 identity only (`clashtest/identity/ids.js`, `clashtest/identity/ModelRegistry.js`, their tests, `test/clashtest/support/leaseWorld*.mjs`), per project `CLAUDE.md` internal-review boundary. No spec or plan-architecture question was raised or reopened.
- **Tool:** `codex-advisor`, effort `medium`, one pass. Request `20260921-162535-54335-613` (raw response in the gitignored `.codex-worker/responses/`).
- **Status:** internal review only — **not** the independent Work review/adjudication gate that `CLAUDE.md` and the owner require before P2.

## Findings and dispositions

| # | File | Severity (Codex) | Finding | Disposition |
| --- | --- | --- | --- | --- |
| C1 | `ModelRegistry.js` `#read` / `#resolveLease` | Medium | With duplicate keys in one `snapshotBindings` call, a world callback that unregisters and re-registers the key during the first position's lease resolution made the second position re-admit the captured Model (different lease object, second `admitModel`), violating the plan's "one admission per live binding / same cached lease" guarantee. Existing tests covered reentrancy and duplicates only separately. | **Accepted, fixed.** Phase 1 memoizes the capture per key; phase 2 resolves each captured binding once and scatters the result to every duplicate position. Regression test `duplicate keys plus a mutation from inside the read…` (`ModelRegistry.snapshot.test.mjs`) fails against the pre-fix logic (mutation-checked) and passes now. |

Codex otherwise reported no conformance gaps against the plan interface summary or the spec identity contract in the reviewed scope. The loop was stopped after this single fix (convergence rule); the fix was verified mechanically, not by a further Codex round.
