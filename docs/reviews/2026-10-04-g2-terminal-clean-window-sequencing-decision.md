# G2 terminal clean-window sequencing decision

- **Type:** owner-authorized bounded sequencing/governance exception (documentation only). Not a change to harness logic, the accepted G2 procedure, or any implementation/test file.
- **Authority:** owner prompt `docs/prompts/for-claude-g2-terminal-sequencing-governance-checkpoint-commit-push-only.md` (2026-10-04), resolving the High blocker in the [superseding-record independent verification](2026-10-04-g2-superseding-authorization-record-independent-verification.md).
- **Baseline before this checkpoint:** `main == origin/main == 8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`; harness SHA `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`; accepted procedure SHA `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`; `LIVE_PATH_WIRED=true`; `G2_DUAL_COUNTER_GATE.resolved=true`.

## 1. Why the exception is necessary

Independently verified live-run ordering (see verification §5):

`record/runtime validation → AUTH_BOUND reservation → Phase 0 git-tree check → ATTEMPT_CONSUMED → Viewer/model activity`

Consequence: the record is spent at the durable `AUTH_BOUND` write, before Phase 0 checks the Git tree. Phase 0 allows only untracked `docs/prompts/` entries. Any other repository write made after final issuance but before the live attempt (a review, handoff, plan, test, or source change) makes Phase 0 fail after the record is already spent. No retry is allowed. The mandatory post-issuance review/handoff writes have caused this twice. Therefore every durable governance write that changes HEAD must complete **before** final issuance.

## 2. Terminal clean-window rule

Applies to the **final authorization-record issuance and exactly-one live G2 sequence only**:

1. All governance docs/reviews/handoff updates that must affect HEAD are completed, reviewed, committed, and pushed **before** final issuance.
2. The final authorization record is issued against that resulting clean committed HEAD.
3. After final issuance, verification until the live attempt is restricted to **read-only / non-repo-mutating checks**.
4. No `docs/handoffs/`, `docs/reviews/`, plan, prompt, test, source, or other repository file may be created or modified before the single live attempt.
5. The final record itself remains an allowed untracked `docs/prompts/` artifact under the current clean-tree classifier.
6. The live attempt proceeds only after an explicit, separate owner authorization.
7. Immediately after the live attempt reaches its terminal state, persist: issued-record verification, live evidence, independent review, handoff update, and any required closeout artifacts.

## 3. Record lifecycle disposition

| Record | ID | SHA-256 | Disposition after this checkpoint |
| --- | --- | --- | --- |
| Historical 1 | `g2-live-20261004-dbd97137` | `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae` | Historical, natively superseded. |
| Current superseding | `g2-live-20261004-8a8d49f6` | `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461` | Technically valid and unspent, but historical-only once this checkpoint changes HEAD (bound to `8a8d49f6…`). |

- Both records remain untracked, unstaged, uncommitted, byte-identical, unmoved, and undeleted.
- The next (final) record must use a new authorization ID, bind the new checkpoint HEAD, supersede `g2-live-20261004-8a8d49f6`, and become the sole active candidate.
- The final record is **not** issued by this checkpoint.

## 4. Non-goals / unchanged

No harness, test, procedure, or production change. No attempt reservation/consumption, Viewer/fixture load, or live G2. Live execution remains separately unauthorized. G3/H1/H2/OQ-1/host work is not authorized.

## 5. Next gate

Separate owner authorization to issue one final superseding authorization record against the new HEAD under the terminal clean-window rule. Exactly-one live G2 remains a later, separate gate.
