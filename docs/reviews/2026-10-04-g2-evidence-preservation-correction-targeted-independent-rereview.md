# G2 evidence-preservation correction — targeted independent re-review

## Verdict

**0 Critical / 0 High / 0 Medium / 0 Low.** The bounded preservation correction closes the prior High, Medium, and Low findings. The immutable snapshot is ready for an owner-authorized docs/evidence checkpoint commit and push. This review does not authorize that commit/push or any C3/C8/C6 remediation planning.

## Verified repository state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- Branch/HEAD: `main` at `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`; `origin/main` is identical.
- The single consumed G2 attempt remains durably closed at `FAIL (row 3)`. No retry, replacement authorization record, attempt reset, or remediation is present.
- Harness SHA-256 remains `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`.
- Procedure SHA-256 remains `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- No harness, test, procedure, production, Core, Viewer Adapter, M4, Panel, OQ-1, or host file is modified. `git diff --check` is clean; the index remains empty after the read-only staging diagnostic.

## 1. Ignored-log staging correction

The broad `.gitignore` rule `*.log` remains unchanged. Two exact-path negations were added only for:

- `docs/research/evidence/g2-live-20261004-75a3ccb9/operator-log/g2-live.log`
- `docs/research/evidence/g2-live-20261004-75a3ccb9/operator-log/server.log`

`git check-ignore -v` resolves both through those negation rules. `git ls-files --others --exclude-standard` and the read-only `git add -n` diagnostic include both logs. Their source and preserved-copy hashes remain equal, so neither copy was changed to obtain stageability.

**Disposition:** the prior High is fully closed.

## 2. Complete stageability

The future evidence checkpoint can include all ten preserved files plus `MANIFEST.md`:

- R1, R2, and R3;
- reservation, journal, and K commit record;
- `g2-live.log`, `g2-live.exit`, and `server.log`;
- the final authorization record copy;
- `MANIFEST.md`.

The dry-run staging output listed all eleven paths. No additional preserved artifact is ignored or excluded.

## 3. Manifest corrections

The manifest now accurately records `operator-log/g2-live.exit` as a distinct preserved, non-authoritative exit-status companion. Its retained contents are `EXIT=1`, consistent with the operator log and the terminal failed run; its source path, preserved path, SHA-256, and role are correct.

The manifest also accurately states that C20 was `BLOCKED(dependency:C8)`, never ran, and produced no rendering or screenshot evidence. R1 supports this with `screenshots:[]` and `c20:null`. The absence is correctly classified as source absence rather than preservation loss. No remaining manifest wording claims that C20 rendering or screenshots were preserved.

**Disposition:** both prior Medium manifest defects are closed.

## 4. Source/copy hash verification

All ten source/copy pairs were independently recomputed and match each other and the manifest:

| Artifact | SHA-256 |
| --- | --- |
| R1 | `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148` |
| R2 | `5282f01c82c404cf8e39cf68fbf55288bac8509fb6b9adf6fb499f68d71d0da4` |
| R3 | `8de72bb0c6cf5883ad5bdd96ffe06a0d8c4c6fd769ee8984865c412a804728f0` |
| Reservation | `ee513025dc2a8bb04d9f15bd15d3e5f31d814464d34edf5f355ada09507d06d2` |
| Journal | `0486d39547a9854c849ebb13b014bf3c286ef9078f0b4ed405efbf87c2bf352c` |
| K commit | `3b5b2777d8dc088852fb41a520817bbb023909138da2c26baf9748e6e993ad63` |
| `g2-live.log` | `e973a356220292e1d672973f9a97cc28be2193dd9faeab53f92f71b1b71b8c05` |
| `g2-live.exit` | `4bf4fca02e6eeaf7f1c510b82c756e7f8a3c567a230bae1094b254adc774f38b` |
| `server.log` | `5194dcee3eb982a3d8cff3c4a9a3723bbdd930576911697ea6e4450438a749bf` |
| Final authorization record | `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6` |

**Disposition:** 10/10 byte-preservation checks pass; no evidence mismatch remains.

## 5. Prompt bookkeeping and internal review

The handoff explicitly identifies the preservation authorization prompt and preservation-correction prompt as untracked, non-authoritative task artifacts. It does not classify either as live evidence. This closes the prior Low.

The focused internal correction review's `0 Critical / 0 High / 0 Medium / 0 Low` result is independently supported. Its staging, manifest, hash, bookkeeping, and scope statements match the repository evidence.

## Readiness and authorization

- **Ignored-log staging:** accepted; prior High closed.
- **All evidence stageable:** accepted; all ten preserved files plus `MANIFEST.md` are included by normal staging diagnostics.
- **Manifest and hashes:** accepted; both wording corrections are accurate and all ten hashes match.
- **Evidence checkpoint:** technically ready for an explicit owner-authorized docs/evidence checkpoint commit and push.
- **Next gate after that checkpoint:** bounded C3/C8/C6 remediation planning may be presented for a separate owner authorization. It is not authorized by this review.

## Exact recommended next action

Obtain explicit owner authorization for one immutable docs/evidence checkpoint commit and push that includes the preservation snapshot, `.gitignore` exact-path exceptions, preservation/correction reviews and prompts, and the updated handoff. Do not begin remediation planning until that checkpoint is complete and the owner separately authorizes bounded C3/C8/C6 planning.
