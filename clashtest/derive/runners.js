// clashtest/derive/runners.js — the only file a later task edits (one import + one entry per derivation)
import { groupByRunner } from './groupBy.js';
export const DEFAULT_RUNNERS = { groupBy: groupByRunner };
