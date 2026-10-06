# G2 historical authorization records: status and provenance

- **Date:** 2026-10-06
- **Role:** governance/provenance status note. It grants no authorization of any kind.
- **Baseline:** `main == origin/main == 3a599ea744c9bd38884c4519f2803e5d60c18399` before this checkpoint.

> Presence in Git does not constitute authorization for execution.

## Status

| Record (Authorization-ID) | Path (unchanged, bytes unchanged) | SHA-256 | Status |
|---|---|---|---|
| `g2-live-20261004-75a3ccb9` | `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md` | `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6` | spent / consumed by the single live G2 attempt; non-executable historical provenance |
| `g2-live-20261004-8a8d49f6` | `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md` | `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461` | superseded (by `75a3ccb9`); non-executable historical provenance |
| `g2-live-20261004-dbd97137` | `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md` | `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae` | superseded (by `8a8d49f6`); non-executable historical provenance |

Supersession chain, as declared in the records' own `Supersedes:` headers: `75a3ccb9` supersedes `8a8d49f6`, which supersedes `dbd97137`.

**No active authorization exists.** G2 closed as `FAIL (row 3)`. Any future live attempt needs a new owner-issued record and a new explicit execution authorization; none is issued or implied here.

## Why the records stay at their current paths (discovery-risk inspection)

- The harness (`test/acceptance/clashpanel-viewerbridge.acceptance.mjs`, `validateAuthorizationRecord`) binds a record only by the explicit `--authorization-record <path>` argument. Nothing selects "the latest record" or reads a directory to pick one.
- The harness's `docs/prompts/` scan builds a candidate set from the filesystem, not from Git, only to reject ambiguity, duplicate IDs and superseded records. These files were already on disk, so committing them changes no scan result.
- Moving them out of `docs/prompts/` would remove them from that scan, so they were kept in place. No guard is weakened and no code or test changed.
- `75a3ccb9` stays unusable independently of this note: its journal, reservation and commit artifacts exist under `docs/research/evidence/g2-live-20261004-75a3ccb9/attempts/` (startup refuses with `journal-exists`/`reservation-exists`), and it binds Harness-SHA-256 `471fae40…7ac4`, not the current committed harness `cc8868cd…ef09b`.
- A byte-identical copy of the `75a3ccb9` record is already preserved in the immutable evidence set (`governance/`, listed in that set's `MANIFEST.md`). The evidence directory was not touched by this checkpoint.

## Related

- Historical prompt tracked by this checkpoint, unmodified: `docs/prompts/for-claude-g2-historical-live-artifacts-docs-checkpoint-commit-push-only.md`.
