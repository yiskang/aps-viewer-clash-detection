# Correction Note — HV-2 Evidence Checksum Count (37 → 38)

**Type:** metadata-only correction/addendum. The historical reports are preserved unchanged.

- **Statement corrected:** [HV-2 adjudication final report](2026-10-12-ctm-8-hv2-focus-adjudication-final-report.md) §6 says `checksums.sha256` covers "37 files all verified OK".
- **Correct count: 38.** `docs/research/evidence/2026-10-12-ctm-8-hv2-focus-adjudication/checksums.sha256` contains **38** entries, and **all 38 verify OK** (`shasum -a 256 -c checksums.sha256`: 38 OK, 0 failed; re-run in this package).
- **Nature:** the earlier `37` was a counting error in prose only. No evidence file, checksum or conclusion changed; the HV-2 verdict (CHECK/EVIDENCE DEFECT, 7 PASS / 0 FAIL / 0 INCONCLUSIVE) is unaffected.
- **Source of the finding:** HV-2 Independent Work Review, Low **L1** (accepted non-blocking residual), which already records 38/38.
- **Preservation:** the upstream final report and the Independent Work Review are not edited; this note is the correction pointer. Readers of the upstream report should treat "37" as superseded by this note.
