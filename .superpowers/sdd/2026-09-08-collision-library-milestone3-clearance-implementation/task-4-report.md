# Task 4 Report: Uniform-scale validator + world-unit tolerance floor helper

## Implementation Summary

Implemented `collision/query/ClearanceTransform.js` with two pure functions as specified:

### `validateUniformScale(matrix)`
Validates that a world matrix decomposes to **rigid + positive uniform scale only**, rejecting:
- **Sheared/projective matrices**: Uses orthogonality check on basis columns (the key review fix from Important #2)
- **Reflected/negative scale**: Explicit `sx, sy, sz > 0` guard rejects reflections outright
- **Anisotropic scale**: Checks all three scale components within `clearanceUniformScaleRelativeTolerance` (1e-4 relative)
- **Non-finite values**: All 16 matrix elements, all decomposed scale components
- **Projective transforms**: Validates affine bottom row (0, 0, 0, 1)

Accepts:
- Rigid transforms (scaleFactor = 1)
- Positive uniform scale at any magnitude (including 1e-6)
- Scale drift up to relative tolerance (1e-4)

Returns `{valid: true, scaleFactor: number}` or `{valid: false}`.

### `computeToleranceFloor(sourceInfo, targetInfo, surfaceEpsilonFactor)`
Computes world-unit clearance tolerance floor:
```
toleranceFloor = surfaceEpsilonFactor × max(
  source.localDiagonal × source.scaleFactor,
  target.localDiagonal × target.scaleFactor
)
```
Key detail: Converts local diagonals to world units via their validated scale factors **before** computing max()—never compares local and world quantities directly.

## TDD Evidence

### RED (Test Failure)
```bash
$ node --test test/query/ClearanceTransform.test.mjs

Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../collision/query/ClearanceTransform.js'
```

Module did not exist.

### GREEN (Test Success)
```bash
$ node --test test/query/ClearanceTransform.test.mjs

TAP version 13
1..11
# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 56.3415

All 11 tests passing:
 ✓ rigid transform (no scale): valid, scaleFactor 1
 ✓ uniform scale: valid, scaleFactor matches
 ✓ anisotropic scale: invalid
 ✓ scale uniform within relative tolerance: valid
 ✓ scale drift beyond relative tolerance: invalid
 ✓ sheared matrix (equal-length, non-orthogonal basis columns): invalid
 ✓ reflected (negative) scale: invalid
 ✓ tiny but legitimate uniform scale is not rejected by absolute determinant cutoff
 ✓ non-finite matrix: invalid, not a thrown exception
 ✓ toleranceFloor: rigid transforms, world units equal local units
 ✓ toleranceFloor: uniform scale converts local diagonal to world units before max()
```

## Files Changed

- **Created**: `collision/query/ClearanceTransform.js` (74 lines)
- **Created**: `test/query/ClearanceTransform.test.mjs` (73 lines)

## Dependency

- Imports `clearanceUniformScaleRelativeTolerance` from `collision/constants.js` (1e-4, already present from Task 1)
- Consumed by Task 5 (`ClearanceQuery`) and Task 9 (linear wiring)

## Full Test Suite Verification

```
npm test → 572 passing, 2 pre-existing failures (unrelated):
 - ClashFinderExtension.test.mjs
 - Extreme aspect-ratio knowledge gap (marked TODO)
```

No regressions introduced.

## Self-Review Findings

### Structural Validation ✓

1. **Non-finite check**: All 16 matrix elements checked; decomposed scale checked
2. **Affine bottom row**: `elements[3,7,11]` must be 0; `elements[15]` must be 1
3. **Positive scale**: `sx, sy, sz > 0` rejects reflections outright (reviewer fix)
4. **Uniform scale**: Relative tolerance `tol * scaleFactor` (not absolute; handles tiny scales)
5. **Orthogonality check** (reviewer fix, Important #2):
   - Raw basis columns extracted from matrix.elements
   - Pairwise dot products checked against `tol * mag²`
   - Rejects sheared matrices with equal-length but non-orthogonal columns
6. **Scale-relative determinant check**: No absolute `Number.EPSILON` cutoff; tiny valid scales accepted

### Tolerance Floor ✓

- Converts source and target local diagonals to world units independently
- Computes max of world diagonals before multiplying by surfaceEpsilonFactor
- Correct order of operations: scale conversion **before** max()

### Test Coverage ✓

All 11 test cases pass, including critical review fixes:
- Shear rejection (orthogonality check validates basis columns are orthogonal)
- Reflection rejection (positive-scale guard eliminates negative scales)
- Both fixes distinguish this implementation from a naive magnitude-only validator

## Concerns

None. Implementation follows the brief exactly:
- Red -> Green TDD done
- All 11 tests pass including the two review-driven structural checks
- Full suite has no regressions
- Commit message matches spec
- Code is pure functional, deterministic, no side effects

---

# Post-Review Fix Report

## Finding: Flawed Test Premise

The "sheared matrix (equal-length, non-orthogonal basis columns): invalid" test used a matrix whose basis columns did NOT actually have equal magnitudes. The original matrix:
```js
const m = new THREE.Matrix4().set(
  1, 1, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
);
```
Decomposes to scale `(1, sqrt(2), 1)` (~41% deviation on the Y axis). This matrix is rejected by the pre-existing anisotropic-magnitude check (line 44), **before the orthogonality-check block ever runs**. The test provided false confidence: the orthogonality check had **zero regression coverage** in the shipped test suite.

## Fix Applied

Replaced the test matrix with one having three equal-magnitude, non-orthogonal basis columns:
- **Column A**: (1, 0, 0) → magnitude 1
- **Column B**: (0.5, sqrt(3)/2, 0) → magnitude ~1.0 (60° angle, not 90°)
- **Column C**: (0, 0, 1) → magnitude 1

### Matrix Construction
```js
const sqrt3_2 = Math.sqrt(3) / 2;
const m = new THREE.Matrix4().set(
  1, 0.5, 0, 0,
  0, sqrt3_2, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
);
```

### Decomposition Verification
```
Decomposed scale: (1, 0.9999999999999999, 1) ✓
All basis columns have equal magnitude (1.0) ✓
Dot products: A·B = 0.5 (non-orthogonal), A·C = 0, B·C = 0 ✓
```

This matrix **passes the anisotropic-magnitude check** (all scales within tolerance) but **fails only because of the orthogonality check**.

## Regression Coverage Evidence

### Test With Orthogonality Check (Production Code)
```bash
$ node --test test/query/ClearanceTransform.test.mjs
1..11
# pass 11
# fail 0
```
✓ Test passes (correctly rejects the non-orthogonal matrix)

### Test With Orthogonality Check Disabled
```bash
$ # Temporarily commented out lines 46-57 in ClearanceTransform.js
$ node --test test/query/ClearanceTransform.test.mjs
1..11
# pass 10
# fail 1  ← sheared matrix test FAILS
```
✓ Test fails (proves the orthogonality-check block is essential to reject this input)

### Full Test Suite After Restoration
```bash
$ git checkout -- collision/query/ClearanceTransform.js
$ npm test
1..533
# pass 573
# fail 1  (pre-existing, unrelated)
# todo 1
```
✓ Full suite passes (no regressions introduced; pre-existing failures persist)

## Files Modified

- **`test/query/ClearanceTransform.test.mjs`**: Updated test matrix and comment
- **`collision/query/ClearanceTransform.js`**: No changes (verified byte-identical post-restoration)

## Verification Summary

1. ✓ Matrix decomposes to uniform scale (1, 1, 1)
2. ✓ Test passes with shipped orthogonality check (11/11)
3. ✓ Test fails when orthogonality check is disabled (10/11)
4. ✓ ClearanceTransform.js restored to committed state (no diff)
5. ✓ Full suite runs cleanly (573 pass, 1 fail pre-existing, 1 todo)
