# Federated Clash Test & Results round 15 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `2b02944d9310d1a09a9c27871a1eb6a39a13bc4e5486b29ff956db4acf81110e` (uncommitted round 15 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-210316-63016-12453` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round14-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round14-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Dispositions are in spec §25 "Round 16".

---

# Executive Summary

Revise the specification before implementation planning, especially the untrusted-result capture, no-clash claim API, and persistence contract.

The collision planning and coverage model is unusually thorough. Repository inspection supports the document’s key assumptions about recursive subtree extraction, whole-model target enumeration, diagnostics, leases, and placement invalidation.

However, the review found four High-severity contract defects and several unresolved API semantics. The document also explicitly blocks Viewer-adapter implementation planning pending OQ-4 evidence. No files were modified.

# Critical Issues

None identified.

# Important Improvements

## 1. Untrusted Result Set capture is not safely or boundedly specified

- **Severity:** High
- **Location or section:** [§13.6, lines 948–950](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:948>)
- **Problem:** The spec says an external Result Set is captured using a "`structuredClone`-equivalent" operation, claims accessor-bearing objects are rejected, and performs raw preflight reads before cloning. Native `structuredClone` invokes enumerable getters rather than rejecting them. The preflight can also invoke getters separately. Additionally, only two top-level lengths are checked before the complete value is cloned; oversized nested arrays and unknown fields are rejected only afterward.
- **Why it matters:** This contradicts the declared untrusted-store boundary. Capture can execute caller/store code, observe inconsistent values between preflight and cloning, cause re-entrancy, or allocate an arbitrarily large graph before schema ceilings are enforced.
- **Concrete failure scenario:** A store returns `results` or `schemaVersion` through a getter that mutates `ledger` when read. The preflight observes one state and cloning captures another. Alternatively, a small top-level object contains a 500 MB nested unknown field; the engine clones it before applying the 64 KiB unknown-field limit and can freeze or exhaust the browser tab.
- **Recommended specification change:** Define one exact descriptor-based, cycle-aware capture algorithm similar to §5.3. It must reject accessors without invoking them and enforce depth, array, string, record-count, and unknown-field byte ceilings incrementally before allocating the corresponding copy. If this is not intended, narrow the port to trusted stores and remove the untrusted-read guarantee.

## 2. The no-clash helper loses a mandatory qualification

- **Severity:** High
- **Location or section:** [§8.3, line 565](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:565>), [§18, lines 1338–1341](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1338>), OQ-16 and OQ-19
- **Problem:** `canClaimNoClashes` can return `true` when hierarchy-internal pairs were never evaluated, provided an opaque acceptance reference exists. The prose then requires the displayed statement to say “excluding the hierarchy-internal pairs,” but the API returns only a boolean. The same helper name also obscures the bracketed-digest limitation.
- **Why it matters:** The method cannot carry the qualification required to make its result truthful. The most natural consumer implementation is `if (canClaimNoClashes) show("No clashes found")`, which produces the false, unqualified statement the prose forbids.
- **Concrete failure scenario:** Owners `101` and `102` clash inside root `100`. They are excluded from the required pair space. With `hierarchyInternalAcceptance` present, the helper returns `true`; the Panel displays “No clashes found,” although a known unevaluated region contains a clash.
- **Recommended specification change:** Reserve `canClaimNoClashes === true` for an unqualified negative with no declared exclusions. Add a structured API such as `assessNoClashClaim() → {allowed, scope, qualifiers, exclusions, proofMethod}` for qualified results. Resolve OQ-19 before allowing an unqualified claim based only on bracketed equality.

## 3. The persistence acknowledgement contract is impossible for a remote backend

- **Severity:** High
- **Location or section:** [§13.5, lines 875–879](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:875>)
- **Problem:** `ResultStore.put` must reject only when no mutation occurred and must resolve after its write linearizes. The spec simultaneously allows a server-backed store. A client cannot distinguish “server did not commit” from “server committed but the response was lost.”
- **Why it matters:** This is a distributed-systems impossibility, not merely an implementation choice. A conforming remote adapter cannot always assign `saved` or `failed` from the promise settlement as required.
- **Concrete failure scenario:** The server atomically commits the Result Set and identity claims, then the connection drops before the response reaches the browser. Rejecting violates “rejection means no insertion”; resolving is impossible because the client received no acknowledgement.
- **Recommended specification change:** Either restrict the v1 port to local/in-process transactional stores, or add an `unknown` persistence outcome. For an ambiguous failure, reconcile with `get(runId)` and canonical-content comparison. Specify how `retryPersist`, `discardRun`, and slot retention behave while the outcome is unknown.

## 4. Valid runs can produce invalid listing summaries

- **Severity:** High
- **Location or section:** [§13.5 listing contract, line 873](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:873>), [V4, line 250](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:250>), [option ceilings, line 1230](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1230>)
- **Problem:** A listing summary permits at most 256 models, while a valid definition may contain 1,024 entries per selection by default and 10,000 at the ceiling. Target-model caps apply per Work Unit, not per run. No run-wide 256-model restriction exists.
- **Why it matters:** A Result Set can be valid and persist successfully but make `listResults` reject its entire page with `CorruptListingError`.
- **Concrete failure scenario:** A federation references 300 one-root models. Planning slices them into conforming four-target-model units. The Result Set is valid, but its summary has 300 model/version entries and therefore violates the listing validator.
- **Recommended specification change:** Either impose and validate a run-wide `maxModelsPerRun ≤ 256`, or raise the summary schema ceiling to the maximum distinct-model count permitted by definitions. Add an acceptance case at the exact limit and one above it.

## 5. Comparisons have no defined determinism class when modes differ

- **Severity:** Medium
- **Location or section:** [§15.1, lines 1011–1016](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1011>), [§15.4, lines 1044–1048](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1044>), [lines 1062–1065](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1062>)
- **Problem:** Comparisons between different unordered modes are allowed, but `Comparison.comparability` has one `determinismClass`. The base can be deterministic (`volume-overlap`) while the next is time-sensitive (`surface-intersection`). “For time-sensitive runs” also does not specify which side controls per-entry flags.
- **Why it matters:** Implementations can emit different metadata for the same comparison, and consumers cannot tell which set has weaker repeatability.
- **Concrete failure scenario:** A volume-overlap base is compared with a surface-intersection next. One implementation reports `deterministic` from the base, another reports `time-sensitive` from the next, and a third uses the weaker class.
- **Recommended specification change:** Store `{baseDeterminismClass, nextDeterminismClass}` and optionally a derived `comparisonDeterminismClass` defined as the weaker class. Define `timeSensitive` separately for evidence from each side.

# Questions / Clarifications

## 1. What exactly does `validateTest` return or throw?

- **Severity:** Medium
- **Location or section:** [§5.3, lines 239–243](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:239>), [§18, line 1308](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1308>)
- **Problem:** The API is declared as `validateTest(def) → Issue[]`, but the result also “carries `issuesTruncated`,” and unsupported schemas are said to throw.
- **Why it matters:** UI validation and `saveTest`/`startRun` can implement materially different behavior.
- **Concrete failure scenario:** One implementation returns a V2 issue for `schemaVersion: 2`; another throws `UnsupportedSchemaVersionError`, breaking a validation form that expects a result.
- **Recommended specification change:** Define `ValidationResult = {issues, issuesTruncated}` and an explicit per-entry-point error table. State whether `validateTest` ever throws for data errors.

## 2. What are the truth rules for multi-valued and unavailable facets?

- **Severity:** Medium
- **Location or section:** [§14.3–14.5, lines 975–999](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:975>)
- **Problem:** `element` and `attrEither` are multi-valued, but `eq`, `in`, ordering, and null operations do not define any-value versus all-values behavior. An unavailable attribute facet is “not an error,” but the return shape or filter truth value is unspecified.
- **Why it matters:** Two conforming filter implementations can return different result sets.
- **Concrete failure scenario:** For values `["A","B"]`, `element eq "A"` could match by existential semantics or fail because the complete value is not `"A"`. An incompatible annotation could yield zero results, unchanged results, or an “unavailable” response.
- **Recommended specification change:** Add a truth table for single-valued, multi-valued, null, missing, and unavailable facets, plus the exact result shape used to report unavailable grouping/filter inputs.

## 3. Are non-finite annotation numbers rejected or normalized?

- **Severity:** Medium
- **Location or section:** [§14.5, lines 991–999](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:991>)
- **Problem:** Attribute values allow any JavaScript `number`, while canonical JSON byte accounting and deterministic grouping assume JSON-safe finite numbers.
- **Why it matters:** `NaN` and `Infinity` serialize as `null`, while `-0` serializes as `0`, creating byte-count and group-identity mismatches.
- **Concrete failure scenario:** The attribute source returns `NaN`. In-memory grouping sees a number, but canonical JSON accounting sees `null`, allowing two different logical values to share serialized identity.
- **Recommended specification change:** Require finite numbers, normalize `-0` to `0`, and define whether invalid numeric values become `null` with a counter or reject the entire annotation operation.

## 4. When will the acknowledged integration gates be resolved?

- **Severity:** High
- **Location or section:** [OQ-1, OQ-4, and OQ-17, lines 1481–1497](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1481>)
- **Problem:** The model identity derivation and placement-notification owner remain undecided, while OQ-4 explicitly prohibits Viewer-adapter implementation planning until live evidence exists.
- **Why it matters:** These are integration contracts on which durable identity, freshness, and supported content depend.
- **Concrete failure scenario:** Implementation starts with a display label as `modelVersion`, or model transforms bypass the designated invalidation path. Persisted identifiers then alias changed content, or stale results continue to report `current`.
- **Recommended specification change:** Promote these items into named pre-implementation/integration prerequisites with owners, required artifacts, and pass/fail acceptance criteria. Do not authorize adapter implementation until the OQ-4 artifact exists.

# Positive Observations

- The three-cell decomposition gives a credible exact-cover strategy while respecting the current library’s recursive extraction and self-exclusion behavior.
- Coverage, integrity, freshness, and environmental sensitivity are kept as separate axes rather than collapsed into an unsafe success flag.
- Unit gaps, planning gaps, diagnostics, scope drift, and capacity failures generally fail closed.
- Lifecycle precedence and persistence observables are much more explicit than typical design specifications.
- The spec accurately recognizes current repository constraints, including whole-model target extraction in [ViewerModelAdapter.js](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/viewer/ViewerModelAdapter.js:192>) and the existing `findClashes` lifecycle in [CollisionWorld.js](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/CollisionWorld.js:1231>).

# Overall Readiness

**Requires major revision**

The core planning design is strong, but implementation should not begin until the untrusted Result Set capture is made safe, the no-clash API cannot erase mandatory qualifications, persistence acknowledges remote commit uncertainty, and the model-count/listing contradiction is resolved. Viewer-adapter planning is additionally blocked by the specification’s own OQ-4 gate.
