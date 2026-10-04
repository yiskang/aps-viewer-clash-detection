# G2 D2 Synthetic-Transition Spec — Focused Internal Review

- **Artifact:** `docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md` (uncommitted)
- **Reviewer:** Codex (`codex-review spec`, effort `medium`), request `20261004-192142-33069-24137`. One pass, as required by the owner prompt §25. Findings independently verified against the spec text and harness (H:8411-8432) by the controller before acceptance.
- **Baseline:** `main == origin/main == dee0850b…`; harness SHA `cc8868cd…ef09b`, procedure SHA `d1ccfde2…5a75` unchanged.
- **Verdict as received:** "Requires major revision" (5 Critical, 4 High, 1 Medium). All were spec-precision defects (not scope or architecture), all genuine; all accepted and fixed in the spec. No re-review loop was run (CLAUDE.md review-boundary rule); remediation is confined to the named areas.

## Findings and disposition

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | Critical | Duration off-by-one (`M(k,D)` undefined; final step ambiguous) | **Fixed** — §5.2 progress-counter semantics + `D=2` worked example; `M(k,i)` domain 1≤i≤D−1 |
| C2 | Critical | Same-frame event placement / OP sampling / per-settle state unspecified | **Fixed** — §5.2 frame micro-order, independent settle-loop state, `G` defined as first-sample offset; only the subject settle simulated |
| C3 | Critical | Classifier classes overlapped; no tagged internal completion for ownership | **Fixed** — §7.4 predicates + precedence + mechanism labels; internal `completedLedger` added (public event stays untagged) |
| C4 | Critical | Simulation stopped at T4 decision so oracle could not be validated on stale schedules | **Fixed** — `t4DecisionFrame` vs `simulationEndFrame`; shadow simulation to frame 127; `ORACLE_CAP` defined |
| C5 | Critical | Geometry experiment lacked equations/coordinates/pairs/aggregation → non-unique D/E | **Fixed** — §9.1 normative coordinates, fit/NDC/O1–O3 equations, V (75), four ordered pairs, order-independent gap, D iff `d_min ≤ 263.857` rule (exploratory) |
| H1 | High | `consumeDelayLeft` lifecycle / resync order | **Fixed** — §5.2 slot-level arm/decrement/consume; resync before consumption every tick |
| H2 | High | Witness count (36 vs 6) and tuple sentinels | **Fixed** — 36 witness schedules separate from 14,580; `−1` sentinels, family/mode ordering |
| H3 | High | Digest self-inclusion; traces in summary; `synthetic` on primitives | **Fixed** — canonical serialization, digest omitted from hash input, companion `d2-witnesses.json`, object-level tag |
| H4 | High | F0 subject, outcome precedence | **Fixed** — `subjectRequestId`; precedence C > A > B |
| M1 | Medium | `D(k)` independent of from-pose vs S1 | **Fixed (scoped)** — explicit destination abstraction note; ownership/ordering only |
| Q1–Q4 | — | e=1 timing; S semantics; Node version; pair set | **Resolved in spec** — delivery at end of frame `completion+e`; S slot-level; Node per repo `engines >=20` (baseline v22.23.1); four pairs enumerated |

Open Critical/High after remediation: **none known** at the spec's abstraction level (unverified by a second pass, by design). Remaining concerns are classified per CLAUDE.md as: *implementation-plan requirements* (exact pseudocode realization, tests) and *owner decisions* (spec §16: scaled durations, A2, exploratory 3× rule, code location).

## Reviewer positives confirmed
Historical/synthetic boundary clear; T4 description matches the harness; closed-loop runner characterization correct; finite domains and caps bound evidence growth.

## Scope / constraints confirmed
No simulator, harness, test, product, or procedure change; no browser/Viewer; no live run; no authorization record; no attempt reset; immutable evidence untouched; no commit/push.

---

# Round 2 — Remediation of the independent Work review (v2 spec)

- **Authority:** `docs/prompts/for-claude-g2-d2-spec-remediation-only.md`; source of findings: [independent review](2026-10-04-g2-d2-synthetic-transition-spec-independent-review.md) (1 Critical / 5 High / 5 Medium).
- **Reviewer:** Codex (`codex-review spec`, medium), request `20261004-211832-39468-30487`; one focused pass over the corrected spec, as required. Findings verified against the spec and harness (H:8385-8432, H:10543-10585) before acceptance. No second pass was run (CLAUDE.md review boundary); fixes below are confined to the named areas.
- **Mechanical checks:** schedule count recomputed independently by enumeration script (not in repo): **52,308** total; cells CL-primary 4,104, CL-tail 4,788, OP-primary 18,144, OP-tail 25,272 — matches spec §7.2. Stale-terminology grep (`STALE-*`, `14,580`, `completedLedger`, "fit margin", `{2,3,4,6,10}`, `t4Prev`, `V6`): no stale uses remain. `git diff --check` clean.

## Independent-review re-check (every finding)

| ID | Finding | Result | Spec location |
|---|---|---|---|
| C1 | closed-loop `δ=0` issues N before authorizing `H` | **Closed** — post-H continuation slot `H+`, causality rule, V0; `δ=1` = next-frame external step; counts recomputed | §5.2, §7 |
| H1 | restore/autocam sync misplaced; no THROW | **Closed** — dispatch sub-step `R` with enumerated `SYNC`; restore effects/ownership explicit; `THROW` branch | §5.2, §5.8, S10 |
| H2 | self-referential oracle | **Closed** — state-machine-carried tokens + ownership tags; independent invariants V1–V4; receiver snapshot rule | §5.6, §6.2, §5.7 |
| H3 | classifier/outcome inconsistency | **Closed** — one decision-list enum; per-cell outcomes; defects force C1 only | §7.4, §8, §12 |
| H4 | symbolic T4 equality | **Closed** — numeric Φ (32 entries), `cameraSamplesWithin` 1e-9, home/restore sample-equal | §5.4, §6.1 |
| H5 | conflicting gap formulas | **Closed** — single `sep`; `d_min` observed only | §11.4 |
| M1 | tail stall excluded | **Closed** — bounded `L ∈ {0,1,2}` in the enumeration, `τ=1e-10`, [SYN-SENS] | §5.5 |
| M2 | no `D=1` | **Closed** — `D ∈ {1,2,3,4,6,10}`; `D` defined | §5.2, §7 |
| M3 | scaled timeout | **Closed** — synthetic frames; 64-sample bounded branch; excluded from acceptance-like conclusions | §6.1 |
| M4 | counter domains | **Closed** — full counter table | §5.3 |
| M5 | `0.9` as margin | **Closed** — "synthetic calibration anchor `κ`" everywhere | §9.1, §9.2, §10, §11 |
| — | D=30 witness, output caps, undocumented-observable policy, location | **Closed / recorded** — 36 characterization schedules outside the exhaustive count; caps 154 traces ≤ 2.5 MiB, total ≤ 3.5 MiB; policy + location in §13.1 | §7.5, §14, §13.1 |

## New findings this round (Codex) and disposition

| # | Sev | Finding | Disposition |
|---|---|---|---|
| N1 | Critical | `THROW` vs shadow simulation / V3 | **Fixed** — harness vs simulation status; Viewer shadow continues; V3 applies to in-flight tokens; normative abort example |
| N2 | Critical | settle activation point unspecified | **Fixed** — activation immediately after the settled `fit`, explicit event, invariant V7, cancelled after abort |
| N3 | High | valid terminals vs "model-invalid" C | **Fixed** — `C1-INVALID` (exit 2) vs `C2-INCONCLUSIVE` (exit 0); E6 expectation replaces V6 |
| N4 | High | 64-sample off-by-one | **Fixed** — timeout after processing sample 64; no 65th sample |
| N5 | Medium | global vs per-settle `t4Prev` | **Fixed** — per-settle `prev`, no global |
| N6 | High | hash/input closure | **Fixed** — spec, harness, R1, fixtures hashed at runtime, `{expected, observed}`, fail closed |
| N7 | Medium | perturbation sign / distance constant | **Fixed** — exact perturbed equations; `263.8571494974672` loaded from R1 |
| N8 | Medium | no diagnostic witnesses for C outcomes | **Fixed** — ≤ 10 diagnostic witnesses, minimum trace-row schema, cap recalculated |
| Q3 | — | explicit H2/H5 per-cell verdicts | **Fixed** — §8.2a, in the summary schema |

**Residual (not re-reviewed by design):** no known Critical/High at the specification abstraction level. Remaining items are *implementation-plan requirements* and the owner decisions listed in spec §16.

## Constraints confirmed
No simulator or simulator directory; no harness/test/product/procedure change; no T4/C6/C8 change; no browser/Viewer/live run; no authorization record or attempt reset; immutable evidence untouched; no commit/push.
