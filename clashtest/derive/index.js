// clashtest/derive/index.js — the derivation layer's public surface (P8.8).
export { createDerivationContext } from './context.js';
export { getPairStatus, getElementStatus } from '../results/status.js';   // re-export lines: P5 owns both (D4)
