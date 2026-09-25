// clashtest/derive/runners.js — the only file a later task edits (one import + one entry per derivation)
import { groupByRunner } from './groupBy.js';
import { filterRunner } from './filter.js';
export const DEFAULT_RUNNERS = { groupBy: groupByRunner, filter: filterRunner };
