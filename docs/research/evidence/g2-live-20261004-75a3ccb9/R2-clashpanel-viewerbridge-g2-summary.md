# G2 ViewerBridge / DockingPanel live verification summary (R2)

Deterministic rendering of the frozen payload snapshot S*. The authoritative verdict is
deriveVerdictFromArtifacts over the durable attempt files (terminal commit record K), never this file.

## Provisional overall (non-authoritative)

primaryOverall: FAIL (row 3)

## Attempt

attemptId: 59b8713d-1e63-4df8-b641-ac6b830f3ea6
journal: AUTH_BOUND -> ATTEMPT_CONSUMED -> CLOSEOUT_STARTED
finishedAt: 2026-10-04T03:29:15.730Z
failedRun: none

## Checks

| Check | Verdict |
|---|---|
| C1 | PASS |
| C2 | PASS |
| C3 | FAIL(repetitions) |
| C4 | PASS |
| C5 | PASS |
| C6 | NOT_EVIDENCED(n2-not-discriminating) |
| C7 | PASS |
| C8 | FAIL(element-outside-frustum) |
| C9 | PASS |
| C10 | PASS |
| C11 | PASS |
| C12 | PASS |
| C13 | PASS |
| C14 | PASS |
| C15 | PASS |
| C16 | PASS |
| C17 | PASS |
| C18 | PASS |
| C19 | PASS |
| C20 | BLOCKED(dependency:C8) |

## Controls

| Control | State |
|---|---|
| N1 | DETECTED |
| N2 | NOT_DISCRIMINATING |
| N3 | DETECTED_RESTORED |
| N4 | DETECTED_RESTORED |
| N5 | DETECTED_RESTORED |
| N6 | DETECTED |
| N7 | DETECTED_RESTORED |
| N8 | NOT_APPLICABLE |

## Optional artifacts

- O2: absent
