// clashtest/viewer/index.js
// The Viewer adapter entry point (D-V5). Deliberately NOT re-exported by clashtest/index.js: the core imports
// nothing from the Viewer (spec 2.1). Evidenced envelope only: Audubon three-discipline fixture, SVF (non-OTG),
// Autodesk Viewer 7.124.2 (OQ-4, docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md).
export { createViewerElementEnumerator } from './ViewerElementEnumerator.js';
export { wireModelUnload } from './unloadWiring.js';
