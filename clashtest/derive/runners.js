// clashtest/derive/runners.js — the only file a later task edits (one import + one entry per derivation)
import { groupByRunner } from './groupBy.js';
import { filterRunner } from './filter.js';
import { summarizeRunner } from './summarize.js';
import { compareRunner } from './compare.js';
export const DEFAULT_RUNNERS = { summarize: summarizeRunner, groupBy: groupByRunner, filter: filterRunner, compare: compareRunner };
