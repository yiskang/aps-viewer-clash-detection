# G2 immutable live-evidence preservation — independent review

Reviewer: ChatGPT Work. Review date: 2026-10-04. Scope was limited to the preservation snapshot, its manifest, the retained source evidence and operator files, the preservation internal review, the prior independent verdict review, and the handoff. No live execution, evidence mutation, record issuance, attempt reset, remediation planning, commit, or push occurred.

## Verdict

The local preservation inventory is complete and all 10 source/copy pairs are byte-identical. The snapshot is **not yet ready for an immutable checkpoint commit** because both copied `.log` files are ignored by Git and would be silently omitted by normal staging. A bounded manifest/checkpoint correction is required first.

## Findings

| ID | Severity | Finding | Required disposition |
|---|---|---|---|
| H1 | **High** | `operator-log/g2-live.log` and `operator-log/server.log` match their sources but are ignored by `.gitignore:93` (`*.log`). They do not appear in `git status --untracked-files=all` or `git ls-files --others --exclude-standard`. A normal checkpoint commit would contain only 8 of the 10 evidence files while the manifest claimed all 10 were preserved. | Before checkpoint staging, explicitly ensure these exact two files are included—most narrowly by an owner-authorized forced add of the two immutable copies, or by a separately reviewed narrow ignore-rule/path correction. Verify the staged tree contains all 10 evidence files plus the manifest. |
| M1 | **Medium** | The manifest's missing-artifact wording is internally inaccurate: it says no separate exit-code artifact was created although `g2-live.exit` is preserved; it also says C20 rendering evidence exists within R1 although R1 has `screenshots:[]`, `c20:null`, C20 `BLOCKED(dependency:C8)`, and N8 `NOT_APPLICABLE`. | Correct the manifest before checkpoint: identify `.exit` as the separate non-authoritative exit-status companion, and state that C20 never ran and no rendering/screenshot evidence existed at source. |
| L1 | **Low** | Preservation work also added the untracked authorization prompt `docs/prompts/for-claude-g2-immutable-live-evidence-preservation-only.md`, but the handoff's preservation scope listed only the snapshot, preservation review, and handoff. | Include the prompt in the working-tree/checkpoint accounting or explicitly exclude it in the future commit authorization. |

No Critical finding. No preservation byte mismatch was found.

## 1. Repository and live-attempt state

- Repository/branch: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, `main`.
- `HEAD == origin/main == 75a3ccb9ba160f8afcf3c9b39a301f352b273c08`.
- Harness SHA-256 remains `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`.
- Procedure SHA-256 remains `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- The attempt remains consumed and durably closed at `FAIL (row 3)`; the reservation/journal/K set is unchanged. No later authorization record, retry, reset, or harness/test/procedure/production remediation is present.

## 2. Preservation inventory

The directory contains exactly 11 files: 10 evidence/supporting files plus `MANIFEST.md`.

| Preserved file | Class |
|---|---|
| `R1-clashpanel-viewerbridge-g2-result.json` | authoritative raw payload evidence |
| `R2-clashpanel-viewerbridge-g2-summary.md` | generated, non-authoritative summary |
| `R3-clashpanel-viewerbridge-g2-closeout.json` | authoritative closeout manifest |
| `attempts/g2-live-20261004-75a3ccb9.reservation.json` | authoritative attempt reservation |
| `attempts/g2-live-20261004-75a3ccb9.journal.json` | authoritative attempt journal |
| `attempts/g2-live-20261004-75a3ccb9.commit.json` | authoritative K terminal commit |
| `operator-log/g2-live.log` | non-authoritative operator log |
| `operator-log/g2-live.exit` | non-authoritative exit-status companion |
| `operator-log/server.log` | non-authoritative supporting server log |
| `governance/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md` | supporting governance artifact |

No expected local copy is missing and no unexpected file is present inside the preservation directory.

## 3. Byte-for-byte verification

Every source/copy SHA-256 pair matches:

| Artifact | SHA-256 |
|---|---|
| R1 | `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148` |
| R2 | `5282f01c82c404cf8e39cf68fbf55288bac8509fb6b9adf6fb499f68d71d0da4` |
| R3 | `8de72bb0c6cf5883ad5bdd96ffe06a0d8c4c6fd769ee8984865c412a804728f0` |
| Reservation | `ee513025dc2a8bb04d9f15bd15d3e5f31d814464d34edf5f355ada09507d06d2` |
| Journal | `0486d39547a9854c849ebb13b014bf3c286ef9078f0b4ed405efbf87c2bf352c` |
| K | `3b5b2777d8dc088852fb41a520817bbb023909138da2c26baf9748e6e993ad63` |
| `g2-live.log` | `e973a356220292e1d672973f9a97cc28be2193dd9faeab53f92f71b1b71b8c05` |
| `g2-live.exit` | `4bf4fca02e6eeaf7f1c510b82c756e7f8a3c567a230bae1094b254adc774f38b` |
| `server.log` | `5194dcee3eb982a3d8cff3c4a9a3723bbdd930576911697ea6e4450438a749bf` |
| Final authorization record | `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6` |

The source operator files are still present under `/private/tmp/claude-501/g2/`, and all three match their preserved copies. The names and manifest path mapping retain provenance; no byte normalization, reserialization, line-ending conversion, or content edit is evidenced.

## 4. Manifest and classification

The manifest correctly records the authorization ID/SHA, HEAD, harness/procedure SHAs, attempt UUID and timestamps, `FAIL (row 3)`, source/preserved paths, per-file hashes, and the statement that copying did not normalize evidence. It does not reinterpret C3/C8/C6 root causes.

Its role classifications are sound: R1/R3/reservation/journal/K are authoritative inputs to closeout reconstruction; R2 is a generated summary; operator/runtime logs are non-authoritative; and the authorization record is supporting governance evidence. The two M1 sentences require correction because they misdescribe the exit companion and nonexistent C20 rendering capture.

## 5. Reconstructability

The local snapshot is sufficient to reconstruct:

- authorization identity and fixture/runtime bindings from the preserved record, reservation, journal, and R1;
- `AUTH_BOUND`, `ATTEMPT_CONSUMED`, both load operations, and `CLOSEOUT_STARTED` from journal/R1 ledgers;
- C1–C20/N1–N8 outcomes and cleanup from R1;
- R1/R2 hashes from R3 and R1/R2/R3/journal bindings from K;
- terminal `FAIL (row 3)` from K and exit code 1 from `g2-live.exit`/`g2-live.log`.

The Git-ignore defect affects future repository durability, not current local reconstruction.

## 6. O2 and screenshot disposition

- **O2:** non-blocking and expected. R1 and R3 both record `O2: absent`; the procedure makes it optional. Its absence was already included in the independent terminal-verdict review and was not caused by preservation.
- **Screenshots:** non-blocking for preservation. No screenshot file existed at source because C20 was blocked by C8 before its rendering path and N8 did not run. R1 retains no screenshot or C20 rendering payload. This is underlying live-evidence scope already adjudicated, not preservation loss.

## 7. Source evidence and repository scope

All original R1/R2/R3/reservation/journal/K files remain present with their previously verified hashes. The operator sources remain present with matching hashes. No attempt file was deleted, overwritten, regenerated, or reset.

`git diff --check` is clean. Harness and procedure hashes are unchanged. No Core, Viewer Adapter, M4, Panel, OQ-1, host, test, harness, procedure, or production-code change is present. The preservation directory, preservation review, handoff, and preservation authorization prompt are the preservation-task additions; older untracked prompts/reviews remain outside this task.

The internal preservation review missed H1, M1, and L1 because it verified local file hashes but did not verify Git inclusion or reconcile the manifest/handoff wording against the actual R1 and working tree.

## 8. Readiness

- **Preservation checkpoint:** not ready for commit/push in its current form. First correct M1 and establish a verified staging method that includes both ignored log copies. Then run a targeted preservation re-review over the manifest and staged inventory.
- **Remediation planning:** technically separable, but should not begin before the evidence checkpoint is corrected, independently accepted, and owner-authorized for commit/push. After that checkpoint, bounded C3/C8/C6 remediation planning may be the next owner-authorized gate; it is not authorized by this review.

## Recommended next authorized action

Authorize one bounded preservation correction only: fix the two manifest statements, account for the preservation authorization prompt, and ensure the two ignored `.log` copies will be included in the checkpoint without modifying their bytes. Then request a targeted independent re-review before any commit/push or remediation planning.
