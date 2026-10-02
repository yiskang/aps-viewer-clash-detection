# G2 Post-C1 Failed-Run Evidence Correction — Internal Review (2026-10-02)

Scope: pre-C1 vs post-C1 failed-run semantics, truthful gate/history retention, `phaseRunFailure` provenance validation, directly affected reader/closeout tests. Reviewer: Codex advisor (medium, read-only) + targeted tests. Authority: owner prompt `docs/prompts/for-claude-g2-post-c1-failed-run-evidence-correction-only.md`; input: [independent re-review](2026-10-02-g2-failed-run-evidence-closeout-independent-rereview.md) (H1/M1/L1).

## Result: 0 Critical / 0 High (1 re-classified) / 3 Medium (2 fixed, 1 open) / 3 Low (open)

Verified: a failed run cannot become PASS-eligible or commit a PASS K (row 3, row 8 requires null, R1 schema forces FAIL, reader W-5); the gate stage is decided from Node's own retained gate (`state.authoritativeGate`), never a page claim; K/closeout, marker retention, cleanup provenance, allocator and ordinal-leak checks unchanged.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| H1* | High→Medium | A page-supplied `partial` history could omit or inject valid-looking check/control records; erasure is rejected only where attributed spy/event/snapshot evidence names the item. | **Re-classified Medium, open.** The page's check/control verdicts are already trusted in full for a COMPLETED run, so the partial adds no new trust boundary; C1 must agree with Node's gate; closed gate ⇒ never `post-c1`. Mechanical inventory binding (labelled per-check/control end ordinals) would shift all page ordinals and is outside this bounded scope — owner/Work decision. Documented in procedure §9. |
| M2 | Medium | Failure `phase`/`activeCheck`/`activeControl` were page-claimed. | **Fixed:** `authenticatedFailureRun` takes them from Node's validated ingest row of the failure's own `phase-run-failure` ordinal; a seq with no such ingested ordinal is discarded (Node-observed, attribution null). Tests: final-transfer "v2 review M2". |
| M3 | Medium | `failureSeq > gateSeq` enforced only for `post-c1`; untransferred gate facts unanchored. | **Fixed:** enforced for both post-C1 stages; untransferred `gateSeq` is a primary seq allocation (uniqueness/leak checked). Test "v2 review M3". The untransferred gate *outcome* still has no independent anchor in R1 (Low). |
| (self) | Medium | Node-made gate-dispositions for a CLOSED gate could never satisfy G-e (dispositionSeq before cleanup marker). | **Fixed by design:** a closed gate is never `post-c1`; it is `post-c1-untransferred`. Test "(5) CLOSED gate". |
| (self) | Medium | post-c1 branch accepted foreign `phase-run-<x>` reasons / flipped status. | **Fixed:** `failed-run-check-foreign-reason`, `failed-run-control-foreign-reason`, `failed-run-post-c1-gate-not-open`. |
| L1 | Low | Completed RPC with missing result labelled `phase-run-completed`. | **Fixed:** status `invalid-result`. Test in mainflow. |
| L2 | Low | Operation detail with null `operationId` is not cross-validated. | Open. |
| L3 | Low | With every item already produced, nulling/editing `phaseRunFailure` with recomputed hashes still derives FAIL (hash-consistency ≠ authentication; same trusted-filesystem model). | Open. |
