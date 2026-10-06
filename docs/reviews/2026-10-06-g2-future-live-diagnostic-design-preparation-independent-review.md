# G2 future live-diagnostic design/preparation package: independent review

- **Date:** 2026-10-06
- **Scope:** the complete uncommitted package under `docs/research/2026-10-06-g2-live-diagnostic-preparation/`, its internal review, the governing committed G2/diagnostic artifacts, the actual acceptance authorization scanner, and the current handoff.
- **Baseline verified:** `main == origin/main == f3bab74f460eacd6b6f69bc8fb90110455ceeb68` before this review was written.
- **Review boundary:** design/preparation only. No Viewer or browser was launched; no live G2 or diagnostic attempt ran; no authorization record was issued, reset, reserved, consumed, or changed; no package, harness, product, procedure, immutable evidence, D2, diagnostic-instrumentation, T4, C6, C8, runtime, or G3 artifact was modified.
- **Verdict:** **bounded correction required before checkpoint** — 0 Critical / 0 High / 1 Medium / 2 Low.

## 1. Findings

### Critical

None.

### High

None.

### Medium

#### M1 — the `SC-C03` nondeterminism closeout cannot publish analysis A “marked withheld” as specified

- **Location:** `spec-part2-controls-envelope-verdict-runbook.md` §13.5, §15 `SC-C03`, §16 P5.06–P5.08, Appendix (iii) P5, Appendix (vi) `SC-C03`.
- **Current contract:** P5.06 writes `TERMINAL-VERDICT.json` into scratch A. P5.07 independently recreates the analysis in scratch B and compares every byte. If A and B differ, the prose says A is published with `verdictWithheld = true` / `withheldBy = "SC-C03"`; P5.08 publishes A.
- **Contradiction:** A's terminal bytes were computed before the A/B mismatch was known. Marking A withheld necessarily changes those bytes after the determinism comparison. Publishing A unchanged leaves no `SC-C03` withholding carrier. Publishing modified A means the published set is not the A set that was compared, and its claimed determinism/provenance was never checked. Appendix P5.08 also requires P5.07 as a precondition without defining how a failed determinism gate continues to publication.
- **Failure mode:** on the exact fail-closed path meant to preserve an analysis-nondeterminism incident, the future harness has no mechanically conforming way to produce the promised terminal file, manifest, and `WITHHELD` commit record. Implementations would have to improvise evidence bytes or omit required state.
- **Classification:** design/spec consistency defect in the evidence-closeout protocol. It does not affect the 70 offline scenario verdicts or existing repository evidence, but it blocks checkpointing this runbook as implementation-ready preparation.
- **Minimum correction:** define a dedicated deterministic `SC-C03` closeout path. Publish neither A nor B as an authoritative diagnostic verdict. From frozen raw inputs plus bounded hashes/difference metadata for A and B, generate a separately specified withheld terminal/diagnostic carrier, bind it in the manifest and commit record as `WITHHELD`, and add a mutation test that forces A/B inequality and proves this path can complete without treating either analysis result as authoritative. Reconcile P5.07/P5.08 preconditions, §13.5, Appendix (iii)/(v)/(vi), and the runbook validator.

### Low

#### L1 — stale commit-record step number

`spec-part2-controls-envelope-verdict-runbook.md` §13.2 says the terminal commit record is written at P5.11. The normative runbook, §13.3, §13.6, and Appendix (iii) correctly place run-root freeze at P5.11 and the commit record at P5.12. This is a wording defect; P5.12 is otherwise consistently implemented in the machine-readable runbook and validator tests.

#### L2 — the H-2 remediation cross-reference stops one step early

The coordination/remediation summary describes the finalization rule as “§16 P4.05–P5.11,” although the sequence it names ends with the P5.12 commit record. This is another stale cross-reference, not a second protocol defect.

## 2. Reproduced verification

| Gate | Independent result |
|---|---|
| Package preparation tests | **113/113 pass** |
| Two clean prototype runs | exit 0; byte-identical to each other and retained `results/`; **13/13 gates pass** |
| Scenario distribution | 70 total: 7 SUPPORTED / 1 REJECTED / 14 INCONCLUSIVE / 47 INVALID / 1 BLOCKED |
| Retained digests | `results.json` `cb51b655d89ab339d77beca17dc5118ae4196db2bab49ecc22899c09d7824797`; `SHA256SUMS` `f9987fb09f032fae146716f9d509e1af671cc69dfb8a8a97e680b48a516d2d2c` |
| D2 suite | **55/55 pass** |
| Diagnostic-instrumentation suite | **72/72 pass** |
| Offline aggregate | **5,155 total / 5,154 pass / 0 fail / 1 existing todo** |
| Formatting | `git diff --check` clean before review writes |

The first aggregate attempt was prevented by the review sandbox from creating existing mutation-test temporaries and binding an ephemeral local port. The same canonical `npm run test:offline` command passed when allowed those local operations; this is an execution-environment restriction, not a repository failure.

## 3. Baseline and protected-boundary verification

- Branch and commits were `main`, `HEAD == origin/main == f3bab74f460eacd6b6f69bc8fb90110455ceeb68`. The pre-review tree contained only the uncommitted owner prompt, preparation package, internal review, and tracked handoff update.
- The acceptance harness SHA-256 is unchanged at `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`; the accepted G2 procedure SHA-256 is unchanged at `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- The three tracked historical authorization records remain provenance only: two are superseded; `75a3ccb9` is the remaining non-superseded acceptance candidate but is spent/non-executable through its durable attempt state. No active authorization exists.
- Immutable G2 evidence, the D2 checkpoint, and the diagnostic-instrumentation checkpoint are unchanged. Historical G2 remains `FAIL (row 3)`; C6 remains `NOT_EVIDENCED`; C8 remains unresolved; real T4/C6/C8 behavior is unchanged.
- No production source, production test/config, live harness, accepted procedure, immutable evidence, Viewer/browser state, authorization state, attempt state, or G3 work changed or ran.

## 4. Contract and instrumentation adjudication

### Contract versions

**Accepted.** Part 1 contract v5 and Part 2 contract v4 are intentional independent contract versions, not a required equality relation. Each loader binds the expected version/digest, current cross-references name the correct concepts, and historical v4/v3 references are explicitly labeled as earlier remediation stages.

### Minimum instrumentation

**Accepted:** `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`. The exhaustive 2,048-configuration ablation remains the support for minimality; P-XS is redundant with the minimum present. No hidden P-XS/P-TICK/P-CC/P-CC0/V-ACT dependency was found. Viewer-bound V-PEND/V-EDGE remain guarded by exact Viewer version/digest and capability evidence.

### Capture semantics

**Accepted.** CP01–CP15 cover pre/post request, slot changes, active edges, frame/step observations, T4 sampling/decision, restore, public camera event, completion when observable, C8/frustum binding, lifecycle transitions, and terminalization. Tokens and sequence fields are established before dependent observations; C8 binds by sample sequence plus camera digest rather than adjacency; races and unavailable observables fail closed.

### Event and byte caps

**Accepted.** The target projection bound is `2×3,576 + 3 + 8 + 4 + 1,024 = 8,191`, explaining why the committed 8,192 projection cap remains sufficient but cannot also serve as the raw cap. The raw worst case is 23,057 records, so 24,576 is bounded headroom. The byte worst case is 6,394,880 under a 6,400,000-byte cap. Spec, bindings, validators, fixtures, and retained results agree; no existing public/Core limit is changed.

## 5. Ambiguity, controls, and evidence adjudication

### Pre-motion

**Accepted with precise scope.** The 5,063 retained ACTIVE0/pre-motion schedules remain inconclusive for ownership/attribution. A generic pre-motion trace is not automatically inconclusive for every question: `Q-SUBJ=PENDING` can still be definite when the subject token is visibly in the slot at decision time. The package now states this per-primary-target distinction. A live run cannot use those 5,063 schedules to exclude stale behavior.

### Pending-clear to active-edge gap

**Accepted.** `CLEAR_WITHOUT_EDGE`, GAP annotation, token reappearance contradiction, edge-initialization checks, and projection failure rules keep the known Viewer 7.124.2 window fail-closed. Event order alone cannot be upgraded to ownership.

### Controls and VB-3

**Accepted.** Five positive controls and the ordered 21-control negative registry identify the inference each failure disables. Wrong Viewer version/digest, missing VB-1/VB-3/ID, truncation, overflow, envelope/count/digest mismatches, C8 binding errors, recorder lifecycle, and unrepresentable projection all fail closed. PC-4's numeric oracle is correctly live-only; the offline package proves structure only.

VB-3 remains a future same-build positive-control gate, not historical proof and not evidence that the prior G2 live run had representative behavior. That limitation is explicit and non-blocking for a design checkpoint.

### Envelope and target-plan binding

**Accepted apart from M1's closeout path.** META/data/END bind run/session, schema, Viewer version/bundle, capability set, caps, sequence, counts, lifecycle, stream digest, and control outcomes. Partial/truncated/overflowed traces cannot become positive. The prior target-plan High is closed: a write-once `governance/target-plan.json` is hashed; its digest must equal the binding and every `META.tq`; strict plan conformance is checked before the target sequence and again during analysis; mismatch/nonconformance is INVALID and tested.

### Freeze/finalization order

**Core ordering accepted; SC-C03 branch requires M1.** Raw artifacts and END are completed before the raw subset is frozen; the ledger remains appendable by explicit exception. Derived output is created in scratch, compared, then published; manifest and post-publication consistency checks precede the whole-run-root P5.11 freeze; P5.12 writes the external commit record last. No ordinary post-freeze run-root write remains. M1 is the exceptional nondeterminism branch not yet mechanically realizable; L1/L2 are stale step references.

## 6. Verdict model

**Accepted for the 70 modeled scenarios.** Precedence is BLOCKED → INVALID → INCONCLUSIVE → REJECTED → SUPPORTED. External gates require exact boolean `true`; invalid target-plan inputs, failed required controls, broken integrity, unknown trace roles, ambiguous primary-target evidence, unrepresentable projection, and source contradictions cannot yield a positive verdict. The reproduced 70-case counts sum exactly and the soundness/no-ambiguous-positive gates pass.

M1 concerns how a nondeterministic analysis is durably closed out, not how a deterministic trace is classified.

## 7. Authorization and attempt boundary

### OD-1 — authorization binding

**Verified:** the existing acceptance format cannot safely authorize this diagnostic.

The actual acceptance scanner treats every `docs/prompts/**/*.md` file with a line beginning `G2-LIVE-EXECUTION:` as a candidate and demands exactly one non-superseded candidate. It hashes `Harness-SHA256` against the fixed acceptance harness path and has no markers for diagnostic kind/harness/package/spec, bundle digest, target plan, atom set, slot-window policy, caps, output path, or diagnostic command. The spent `75a3ccb9` record remains non-superseded in that candidate graph. A new unsuperseded record would make the set ambiguous; superseding it would turn the new diagnostic record into the acceptance candidate.

**Recommendation:** choose OD-1 option A if diagnostic work is ever resumed: a distinct diagnostic marker namespace, validator, attempt directory, and binding format. Do not extend or reuse the acceptance format in place. Option B is a procedure/acceptance-contract change and is not minimum scope. Option C is consistent with verdict B and requires no implementation.

### Attempt consumption

**Accepted as conservative.** Static checks P0.01–P0.09 occur before reservation. P0.10 durably binds/spends the record; P0.12–P0.13 may launch a browser and inspect Viewer without loading a model; P0.14 durably records `ATTEMPT_CONSUMED`; only then does P1 load fixtures, followed by controls and target actions. Failures after binding may spend the record without consuming a model attempt; after P0.14 no retry exists.

## 8. Owner decisions OD-2–OD-8

| Item | Options and consequence | Independent recommendation | Needed when |
|---|---|---|---|
| OD-2 | `OPEN` is assumption-free but one-sided; `ASSUME_NO_UNOBSERVED_WRITER` increases labels but makes them conditional on an unverified assumption | Keep `OPEN`. Do not use assumption-mode output for an unconditional owner decision | Before diagnostic harness binding/execution; not before this package checkpoint |
| OD-3 | Permit or forbid VB-1/VB-3 internals; forbidding them removes the only useful live attribution path | Permit only in a separately authorized, exact-7.124.2 research diagnostic with VB-0/RG gates; never make them a production dependency | Before harness implementation/live authorization |
| OD-4 | Minimal G/S sequence is lower risk; full P6 shape adds G/G/S/P fidelity, cost, and refresh-budget sensitivity | Use the minimal G/S plan for the first diagnostic, pre-registering only the primary Q-SUBJ/Q-OWNER targets; use full P6 only if an owner decision explicitly needs it | Before target-plan freeze/live authorization |
| OD-5 | Consume before controls (current conservative design) or move consumption later | Accept the current boundary. Controls are live work inside the one attempt; moving the boundary would create a retry class | Before live authorization; not before checkpoint |
| OD-6 | Preserve in a separate diagnostic evidence root and optionally checkpoint later, or do not preserve | Use a separate immutable diagnostic evidence path; decide checkpointing only after independent evidence review | Before execution/evidence closeout |
| OD-7 | Authorize implementation planning/harness work or stop at design | Defer. Verdict B supplies no current implementation need | Required only to cross into implementation |
| OD-8 | Run a diagnostic or stop | Do not authorize a live diagnostic now. Revisit only if a concrete T4/C8/G2-retry decision would use a one-sided positive result | Required before any future live work |

None of OD-1–OD-8 needs to be decided merely to checkpoint a corrected design/preparation package. M1 is a technical correction, not an owner/product decision.

## 9. Runbook safety and live-worthwhile decision

### Runbook

Phases 0–5 are ordered so that static binding precedes reservation, live preflight precedes consumption, instrumentation precedes controls/target capture, raw terminalization precedes offline analysis, and whole-root freeze precedes the external commit record. Live-touching steps are marked as requiring future owner authorization and the package-level `authorized:false` / `executed:false` remains controlling. Cleanup and fail-closed stop classes are defined. Apart from M1 and the two wording references, no execution-order blocker was found.

### Verdict B

**Accepted: prepared, but currently not worthwhile.** A positive new-run observation of `Q-SUBJ=PENDING` or `Q-OWNER∈{RESTORE,INIT}` would be meaningful mechanism evidence. A negative/non-observation remains inconclusive under `OPEN`; it cannot exclude stale behavior, resolve historical C8, change historical G2 `FAIL (row 3)`, move C6 off `NOT_EVIDENCED`, or justify a retry by itself. With only 3/13 questions technically addressable, zero public-only definite labels, 5,063 ACTIVE0 residual schedules, version-bound internals, and a new authorization/harness lifecycle required, current expected information gain does not justify the live risk.

## 10. Internal-review quality

The internal review's substantive 2 High / 9 Medium remediation and the targeted 1 High / 2 Medium follow-up are reproducible in the corrected package: target-plan binding, external gates, ambiguity scope, gap contradiction, control ordering, ledger closure, disposal split, registry, strict plan schema/conformance, and conditional recovery are present and tested. The preparation suite and all 13 peer gates independently rerun the ancillary validators, so not separately replaying the internal agents is acceptable and non-blocking.

The internal review did not catch M1 because its determinism tests cover equal A/B output, not the forced-mismatch closeout path. This does not invalidate the rest of the review, but its claim that all H/M defects were closed is stale.

## 11. Checkpoint readiness and authorization state

- **Checkpoint readiness:** **bounded correction required**. The package has no Critical or High finding, but M1 is a blocking Medium in a normative future-run closeout path. L1/L2 should be corrected in the same bounded pass.
- **Currently authorized:** this independent review and handoff update only.
- **Not authorized:** package remediation, checkpoint commit/push, diagnostic harness planning/implementation, authorization-format changes, authorization issuance/reset/reservation, Viewer/browser/live execution, G2 retry, procedure/acceptance-harness/product/T4/C6/C8/runtime changes, immutable-evidence changes, or G3.
- **Exact next owner action:** authorize one bounded, offline-only package correction for the `SC-C03` deterministic withheld-closeout path plus L1/L2 step references, directly affected prototype/runbook-validator tests and documentation, followed by a targeted independent re-review.
