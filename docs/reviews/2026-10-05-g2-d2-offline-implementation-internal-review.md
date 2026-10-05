# G2 D2-OFFLINE implementation — focused internal review

- **Scope:** `docs/research/2026-10-04-g2-d2-synthetic-transition/` only. Baseline `main == origin/main == 53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`. Reviewer: Codex (`codex-review code`, medium) on `machine.mjs` and `simulate.mjs`, plus implementer cross-checks against spec §5–§15. This is an internal review, not the independent Work review.
- **Result:** 0 Critical / 1 High / 3 Medium real defects, all fixed; 1 Medium (npm script) rejected by design. No finding required a spec change. (Headline corrected during bounded remediation; see the [remediation review](2026-10-05-g2-d2-offline-bounded-remediation-internal-review.md).)

## Findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | `checkInvariants` V2/V4 accepted corrupted histories (frame mismatch between terminal/oracle/completion; token consumed without a fit) | **Fixed.** V2 now requires one-to-one token + frame agreement across terminal, oracle and untagged completion; V4/V3 use an explicit per-token state machine (`ABSENT→fit→PENDING→{overwritten│consume→ACTIVE→terminal}`). Regression test added. |
| 2 | Medium | Witness traces omitted oracle deliveries | **Fixed.** One `O` row per delivery (`completionFrame+e`, owner snapshot). Test added. |
| 3 | Medium | `runSimulation` accepted `expected: {}` (null = unchecked), disabling hash verification | **Fixed.** All four digests are mandatory and must be 64-hex; tests that need overrides pass full digest sets. Test added. |
| 4 | Medium | Dedup of witness ids lost diagnostic reasons | **Fixed.** Witnesses carry `reasons[]`; `diagnosticWitnesses` built from the diagnostic picks. (The real run has no diagnostic failures, so the shared-id path is only structurally tested.) |
| 5 | Medium (testing) | `*.d2-test.mjs` not discovered by `npm test` | **Rejected as a defect, by design.** The owner prompt forbids adding tests to the production suite and forbids edits outside the D2 directory; adding an npm script would modify `package.json`. Run command is documented in the README. `npm run test:offline` verified unaffected (exit 0). |

## Self-checked fidelity points

- Count: derived closed-form and enumerated = 52,308; cells 4,104 / 4,788 / 18,144 / 25,272; 36 D=30 witnesses; mismatch ⇒ exit 2 (tested via tampered fixtures copy).
- δ=0 (`H+` same frame) vs δ=1 (next-frame external step), pending last-writer-wins, S=0/S=2 consume timing, restore variants, 63/64/64-distinct timeout boundary, tail-stall witnesses for L=1 and L=2, classifier exclusivity, oracle independence (owner tag corrupted ⇒ verdict changes while the sample does not) — all tested.
- Spec Low L1 (THROW example one frame late): the normative rules put the restore in frame 1 `H+`; tests assert derived frames, not the spec's example number.
- **D=30 finding (characterization only):** under compounding smoothstep the last steps move <1e-9, so all 36 D=30 schedules violate V5 and 12 classify `INVALID_AMBIGUOUS`. This is reported in `characterization` and does not enter `invariantResults`, cells, or the exit code.
- Interpretations (tail base, SYNC from restore variant, H2/H5 INCONCLUSIVE keyed to inconclusive terminals, trace-row elision) are listed in the README.

## Open items for the independent reviewer

1. ~~Ratify the two input pins~~ — spec `635d1834…c574` and `fixtures.json` `6ee6e9fa…78e0` were subsequently ratified by the independent Work review.
2. Interpretations above (trace-row elision) stand. Note: the original wording that D=30 V5/INVALID_AMBIGUOUS trips are "not model defects" was **wrong** and was corrected in remediation: they are model-invalid characterization results outside the exhaustive domain.
3. Control axis result `E` (`P_C6~L_home` fails) comes from the exploratory 3× rule over `k∈{1.5,2,3,5}`; it is independent of `d` and is not a margin or threshold finding.
