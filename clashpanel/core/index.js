// clashpanel/core/index.js
// The headless core's public surface (catalog §4): exactly the controller factory, the intent vocabulary, the
// default scheduler and the pure ViewModel builder, plus the Clash Tests manager factory (spec §26).
// Presentation constants (PAGE_SIZE, FILTER_DEBOUNCE_MS, …) are deliberately NOT re-exported: they are provisional
// Panel-internal choices, never options or engine limits (AC-P11).
export { createPanelController } from './controller.js';
export { INTENT } from './intents.js';
export { createDefaultScheduler } from './scheduler.js';
export { buildViewModel } from './viewModel.js';
export { createTestsManager } from './testsManager.js';
