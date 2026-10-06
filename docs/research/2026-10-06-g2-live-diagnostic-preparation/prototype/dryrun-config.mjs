// Offline dry-run configuration validator for a HYPOTHETICAL future live run (spec part 2 §15). Pure, deterministic.
// Nothing here launches, reserves or executes anything. Each failure is mapped to its stop-condition id and class from contract.stopConditions.
//
// cfg: { hypothetical: true,
//        viewer: { version, bundleSha256 }, harnessSha256 (acceptance harness), procedureSha256, diagnosticHarnessSha256?,
//        outputDir: { path, exists, entryCount }, 
//        authorization: { candidateCount, nonSupersededCount, hasLiveExecutionMarker, spent, superseded, present },
//        capabilities: { atoms, idAxis, slotWindow, vb: {'VB-1','VB-2','VB-3'}, tagWrapper },
//        caps: { <LIVE_CAPS_V2 buffer keys> }, expectedCount: { min, max }, measuredRefreshHz?, plan?: {worstCaseRawRecords, worstCaseProjectedRecords, worstCaseDurationFrames, controlWindowFramesNeeded},
//        executeRequested?: boolean }
// Returns { ok, findings, stops: [{id, class, subclass}] }.

export const ACCEPTANCE_HARNESS_SHA256 = 'cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b';
export const ACCEPTED_PROCEDURE_SHA256 = 'd1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75';
const HEX64 = /^[0-9a-f]{64}$/;
const BUFFER_KEYS = ['dataEvents', 'totalTraceBytes', 'bytesPerEvent', 'bytesPerNv', 'metaBytes', 'endBytes', 'retainedNumericSamples', 'settleSamples', 'targetWindowFrames', 'controlWindowFrames', 'projectedEventsMax', 'reserveBytes'];
const RUN_ROOT_RE = /^test\/acceptance\/results\/g2-live-diagnostic\/[a-z0-9-]{8,64}\/?$/;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validateDryRunConfig(cfg, contract) {
  const findings = [];
  const stopMap = new Map();
  const stops = new Map();
  const reg = new Map(((contract && contract.stopConditions && contract.stopConditions.stopConditions) || []).map((c) => [c.id, c]));
  const stop = (id, detail) => {
    const c = reg.get(id);
    if (!c) { findings.push(`STOP_CONDITION_UNKNOWN:${id}: ${detail}`); return; }
    stops.set(id, { id, class: c.class, subclass: c.subclass });
    findings.push(`${id}[${c.class}/${c.subclass}]: ${detail}`);
  };
  const bad = (m) => findings.push(`CONFIG_INVALID: ${m}`);
  void stopMap;
  if (!contract || !contract.envelope || !contract.part1) return { ok: false, findings: ['CONTRACT_MISSING'], stops: [] };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, findings: ['CONFIG_INVALID: not an object'], stops: [] };
  if (cfg.hypothetical !== true) bad('hypothetical must be exactly true (this validator never describes a real run)');
  if (cfg.executeRequested === true) findings.push('LIVE_EXECUTION_NOT_AUTHORIZED: executeRequested=true; no live execution is authorized');

  const pin = contract.part1.viewerPin;
  const v = cfg.viewer || {};
  if (v.version !== pin.version) stop('SC-A09', `viewer version ${JSON.stringify(v.version)} !== ${pin.version}`);
  if (v.bundleSha256 !== pin.bundleSha256) stop('SC-A10', `viewer bundle digest ${JSON.stringify(v.bundleSha256)} !== pinned`);
  if (cfg.harnessSha256 !== ACCEPTANCE_HARNESS_SHA256) stop('SC-A02', `harness SHA ${JSON.stringify(cfg.harnessSha256)} !== ${ACCEPTANCE_HARNESS_SHA256}`);
  if (cfg.procedureSha256 !== ACCEPTED_PROCEDURE_SHA256) stop('SC-A02', `procedure SHA ${JSON.stringify(cfg.procedureSha256)} !== ${ACCEPTED_PROCEDURE_SHA256}`);
  if (cfg.diagnosticHarnessSha256 !== undefined && !HEX64.test(String(cfg.diagnosticHarnessSha256))) stop('SC-A02', 'diagnosticHarnessSha256 is not hex64');
  if (cfg.diagnosticHarnessSha256 === ACCEPTANCE_HARNESS_SHA256) stop('SC-A02', 'diagnosticHarnessSha256 equals the acceptance harness digest (distinct harness required)');

  // Output directory: must be a safe path that is absent / empty.
  const od = cfg.outputDir;
  if (!od || typeof od !== 'object') stop('SC-A04', 'outputDir missing');
  else {
    if (typeof od.path !== 'string' || od.path.length === 0) stop('SC-A04', 'outputDir.path missing');
    else {
      if (od.path.startsWith('/') || od.path.split('/').includes('..') || od.path.includes('\\')) stop('SC-A04', `outputDir.path unsafe: ${od.path}`);
      else if (!RUN_ROOT_RE.test(od.path)) stop('SC-A04', `outputDir.path outside test/acceptance/results/g2-live-diagnostic/<authorizationId>/: ${od.path}`);
      if (/docs\/research\/evidence/.test(od.path) || /clashpanel-viewerbridge-g2-attempts/.test(od.path)) stop('SC-A04', `outputDir.path points into protected evidence/acceptance location: ${od.path}`);
    }
    if (od.exists !== false) stop('SC-A04', 'output directory is not absent (exists !== false)');
    if (od.entryCount !== 0) stop('SC-A04', `output directory not empty (entryCount ${JSON.stringify(od.entryCount)})`);
  }

  // Active-authorization ambiguity.
  const au = cfg.authorization;
  if (!au || typeof au !== 'object') stop('SC-A03', 'authorization state missing');
  else {
    if (au.present !== true) stop('SC-A03', 'no diagnostic authorization record present');
    if (au.nonSupersededCount !== 1) stop('SC-A03', `exactly one non-superseded diagnostic record required, found ${JSON.stringify(au.nonSupersededCount)}`);
    if (au.hasLiveExecutionMarker !== false) stop('SC-A03', 'a G2-LIVE-EXECUTION marker is present (acceptance candidate-set hazard, OD-1)');
    if (au.spent !== false) stop('SC-A03', 'authorization already spent');
    if (au.superseded !== false) stop('SC-A03', 'authorization superseded');
  }

  // Capabilities.
  const cap = cfg.capabilities;
  const wantAtoms = ['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE'];
  if (!cap || typeof cap !== 'object') stop('SC-A13', 'capabilities missing');
  else {
    if (!eq(cap.atoms, wantAtoms)) stop('SC-A13', `atoms ${JSON.stringify(cap.atoms)} !== ${JSON.stringify(wantAtoms)}`);
    if (cap.idAxis !== 'ON') stop('SC-A13', `idAxis ${JSON.stringify(cap.idAxis)} !== "ON"`);
    if (cap.slotWindow !== 'OPEN') stop('SC-A13', `slotWindow ${JSON.stringify(cap.slotWindow)} !== "OPEN" (ASSUME_NO_UNOBSERVED_WRITER is an owner decision, OD-2)`);
    const vb = cap.vb || {};
    for (const k of ['VB-1', 'VB-3']) if (vb[k] !== 1) stop('SC-A11', `required observable ${k} unavailable (${JSON.stringify(vb[k])})`);
    if (cap.tagWrapper !== true) stop('SC-A12', 'request tag wrapper unavailable');
  }

  // Buffer bounds / caps.
  const want = contract.envelope.caps;
  if (!cfg.caps || typeof cfg.caps !== 'object') stop('SC-A07', 'caps missing');
  else {
    for (const k of BUFFER_KEYS) {
      const c = cfg.caps[k];
      if (!Number.isInteger(c)) stop('SC-A07', `cap ${k} missing or not an integer`);
      else if (c < want[k]) stop('SC-A07', `cap ${k}=${c} below contract ${want[k]}`);
      else if (c > want[k]) stop('SC-A06', `cap ${k}=${c} differs from LIVE_CAPS_V2 ${want[k]} (META.cp must equal LIVE_CAPS_V2 exactly)`);
    }
  }
  const ec = cfg.expectedCount;
  if (!ec || !Number.isInteger(ec.min) || !Number.isInteger(ec.max)) stop('SC-A07', 'expectedCount {min,max} missing');
  else {
    if (ec.min < 0 || ec.min > ec.max) stop('SC-A06', 'expectedCount min/max inconsistent');
    if (ec.max > want.dataEvents) stop('SC-A07', `expectedCount.max ${ec.max} > ${want.dataEvents}`);
  }
  const plan = cfg.plan;
  if (plan !== undefined) {
    if (plan.worstCaseRawRecords > (ec && Number.isInteger(ec.max) ? ec.max : want.dataEvents) || plan.worstCaseRawRecords > want.dataEvents) stop('SC-A07', `plan worst-case raw records ${plan.worstCaseRawRecords} exceed ec.max/${want.dataEvents}`);
    if (plan.worstCaseProjectedRecords > want.projectedEventsMax) stop('SC-A07', `plan worst-case projected records ${plan.worstCaseProjectedRecords} > ${want.projectedEventsMax}`);
    if (plan.worstCaseDurationFrames > want.targetWindowFrames) stop('SC-A07', `plan worst-case duration ${plan.worstCaseDurationFrames} frames > ${want.targetWindowFrames}`);
    if (plan.controlWindowFramesNeeded > want.controlWindowFrames) stop('SC-A07', `control window needs ${plan.controlWindowFramesNeeded} frames > ${want.controlWindowFrames}`);
  }
  if (cfg.measuredRefreshHz !== undefined && !(Number.isInteger(cfg.measuredRefreshHz) && cfg.measuredRefreshHz >= 1 && cfg.measuredRefreshHz <= want.maxRefreshHz)) stop('SC-A17', `measured refresh ${JSON.stringify(cfg.measuredRefreshHz)} Hz outside 1..${want.maxRefreshHz}`);

  findings.sort();
  return { ok: findings.length === 0, findings, stops: [...stops.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

/** A fully valid synthetic hypothetical config (test helper). */
export function syntheticValidConfig(contract) {
  return {
    hypothetical: true,
    viewer: { version: contract.part1.viewerPin.version, bundleSha256: contract.part1.viewerPin.bundleSha256 },
    harnessSha256: ACCEPTANCE_HARNESS_SHA256,
    procedureSha256: ACCEPTED_PROCEDURE_SHA256,
    diagnosticHarnessSha256: '1'.repeat(64),
    outputDir: { path: 'test/acceptance/results/g2-live-diagnostic/g2-diag-synthetic-00000001/', exists: false, entryCount: 0 },
    authorization: { present: true, candidateCount: 1, nonSupersededCount: 1, hasLiveExecutionMarker: false, spent: false, superseded: false },
    capabilities: { atoms: ['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE'], idAxis: 'ON', slotWindow: 'OPEN', vb: { 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 }, tagWrapper: true },
    caps: Object.fromEntries(BUFFER_KEYS.map((k) => [k, contract.envelope.caps[k]])),
    expectedCount: { min: 0, max: contract.envelope.caps.dataEvents },
    measuredRefreshHz: 60,
    plan: { worstCaseRawRecords: 9000, worstCaseProjectedRecords: 3000, worstCaseDurationFrames: 1000, controlWindowFramesNeeded: 600 },
    executeRequested: false,
  };
}
