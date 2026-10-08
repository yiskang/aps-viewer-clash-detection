// clashpanel/core/groupModes.js
//
// The single-level Group-by mode registry (package brief §2, §6). ONE active mode at a time; no nested grouping.
// A grouped mode is a frozen descriptor:
//
//   id            the GROUP_MODE intent value (and the view preference that survives Clear / New run)
//   grouped       true (only `none` is false)
//   multiValued   true when one clash may be listed under several groups (group counts then do not add up)
//   note          the explanation shown above a grouped list (multi-valued modes only), else null
//   defaultOrder  'core' — the order `compute` returns, which must be a deterministic IDENTITY order (never a
//                 display-text order); Sort "Group size" / "Group name" override it Panel-side (grouping.sortGroups)
//   compute({queue, engine, resultSet, priority, properties, scheduler, isCurrent}) → Promise<
//                   {status:'ok', table:{groups:[{groupId, ref, count, memberIds}], memberships, total}}
//                 | {status:'unavailable', reason:'too-large'|'error'|string}   (the async/unavailable state hook)
//                 | {status:'superseded'}>
//                 `groupId` is the STABLE group key (independent of display text; duplicate labels never merge groups),
//                 `ref` the mode's group value handed to labelOf, `memberIds` resultIds in canonical result order.
//                 The controller caches one outcome per (generation, mode) and shows 'pending' (busy) until it lands.
//   labelOf(ref, labels) → the user-facing group label (labels = the controller's createLabelResolver instance)
//   unavailableText(reason) → optional; defaults to GROUPING_UNAVAILABLE_TEXT
//   usesProperties true for the metadata modes: their cached outcome is dropped when a model leaves the scene
//
// Two compute families share the table shape:
//   * Core facets (Element, Model Pair): ONE engine.derivations.groupBy through the derivation queue (grouping.js);
//   * element metadata (Category, Level): a Panel-side, chunked, generation-guarded bulk PROPERTY read of the live
//     models (`properties` = the per-generation elementProperties.js source, cached and shared by both modes), then a
//     sliced single pass over the results (propertyGrouping.js). A failed / unsupported read, or a participating model
//     that is not loaded, resolves 'unavailable' with a mode-specific text — never guessed groups.
// To add a mode: a descriptor here, its id in MODES, a radio in ui/render/filters.js. Nothing else in the controller
// is mode-specific.
import { MULTI_VALUED_NOTE, computeFacetGroups } from './grouping.js';
import {
  buildPairGroupTable, categoryDisplay, resolveLevel, UNKNOWN_CATEGORY_LABEL, UNKNOWN_LEVEL_LABEL,
} from './propertyGrouping.js';

const coreFacetCompute = (facet, isValue) => ({ queue, engine, resultSet, priority }) => computeFacetGroups({ queue, engine, resultSet, facet, isValue, priority });

const isElementRef = (v) => v !== null && typeof v === 'object' && typeof v.modelKey === 'string' && Number.isInteger(v.dbId);
// Core's single-valued `pairModels` facet value is [pair.first.modelKey, pair.second.modelKey]. For the modes the Panel
// runs (volume-overlap / clearance: unordered pair semantics) Core's PairId orders first ≤ second, so A×B and B×A
// results carry the SAME value and therefore the same groupId; a self-clash is [A, A]. Identity is the modelKey —
// never the display name.
const isModelPair = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string';

const NONE = Object.freeze({ id: 'none', grouped: false });

const ELEMENT = Object.freeze({
  id: 'element', grouped: true, multiValued: true, note: MULTI_VALUED_NOTE, defaultOrder: 'core',
  compute: coreFacetCompute('element', isElementRef),
  labelOf: (ref, labels) => `${labels.modelName(ref.modelKey)} · ${labels.elementLabel(ref)}`,
});

const MODEL_PAIR = Object.freeze({
  id: 'modelPair', grouped: true, multiValued: false, note: null, defaultOrder: 'core',
  compute: coreFacetCompute('pairModels', isModelPair),
  // labels.modelName = the host display name, disambiguated against every known model (duplicate names get a
  // modelKey suffix) with the modelKey-based fallback (`Model <key>`) when the host has no name.
  labelOf: ([a, b], labels) => `${labels.modelName(a)} ↔ ${labels.modelName(b)}`,
});

const UNAVAILABLE_REASON_TEXT = Object.freeze({
  'model-not-loaded': 'a model of this run is not loaded',
  'properties-unsupported': 'the loaded models do not offer element properties',
  'properties-error': 'element properties could not be read',
});
const metadataUnavailableText = (name) => (reason) => `${name} grouping is unavailable (${UNAVAILABLE_REASON_TEXT[reason] ?? UNAVAILABLE_REASON_TEXT['properties-error']}) — showing the flat list.`;
const pairLabel = (ref) => ref.labels.join(' ↔ ');

/**
 * CATEGORY (owner contract, package brief §4). Side value = the element's '__category__' 'Category' property, RAW
 * (e.g. 'Revit Walls'; missing / empty / non-string ⇒ the missing sentinel). Group = the UNORDERED pair of the two raw
 * categories (A×B ≡ B×A; a same-category clash — self-clash or not — is the single-category group 'Walls'). Label =
 * 'Revit ' stripped for display ('Walls ↔ Ducts'), missing ⇒ 'Unknown category'; raw strings that display alike stay
 * distinct groups with the raw text appended. Identity / order rules: propertyGrouping.js. Never derived from dbId or
 * geometry.
 */
const CATEGORY = Object.freeze({
  id: 'category', grouped: true, multiValued: false, note: null, defaultOrder: 'core', usesProperties: true,
  async compute({ resultSet, properties, scheduler, isCurrent }) {
    if (!properties) return { status: 'unavailable', reason: 'properties-unsupported' };
    const read = await properties.facts();
    if (read.status !== 'ok') return read;
    return buildPairGroupTable({
      modeId: 'category', resultSet, scheduler, isCurrent, display: categoryDisplay, unknownLabel: UNKNOWN_CATEGORY_LABEL,
      sideValue: (ref) => read.facts.get(ref.modelKey)?.get(ref.dbId)?.category ?? null,
    });
  },
  labelOf: pairLabel,
  unavailableText: metadataUnavailableText('Category'),
});

/**
 * LEVEL (owner choice: the per-side level PAIR, package brief §5). Side value = the element's level name by the FIXED
 * precedence of propertyGrouping.resolveLevel ((1) the Revit '__internalref__' Level reference resolved to the name of
 * that Level element in the same model — a second, unfiltered bulk read, ' [<id>]' suffix stripped — (2) Constraints
 * 'Level', (3) Reference Level, (4) Base Level, (5) Base Constraint; first non-empty wins; none ⇒ 'Unknown Level').
 * Group = the UNORDERED pair of the two names: equal names collapse to one label ('FIRST FLOOR'), different names read
 * 'A ↔ B' in code-point order — a clash spanning two levels is its own pair group, never assigned to one of them.
 * Identity is the RAW name, modelKey-independent and NOT normalized: the same name from two models is one level,
 * 'Arch-FIRST FLOOR' and 'FIRST FLOOR' are two. Hence two pairs can only display alike when their keys are equal.
 * Default order: key order (known levels before Unknown). World Z is never used.
 */
const LEVEL = Object.freeze({
  id: 'level', grouped: true, multiValued: false, note: null, defaultOrder: 'core', usesProperties: true,
  async compute({ resultSet, properties, scheduler, isCurrent }) {
    if (!properties) return { status: 'unavailable', reason: 'properties-unsupported' };
    const read = await properties.levels();
    if (read.status !== 'ok') return read;
    return buildPairGroupTable({
      modeId: 'level', resultSet, scheduler, isCurrent, display: (name) => name, unknownLabel: UNKNOWN_LEVEL_LABEL,
      sideValue: (ref) => resolveLevel(read.facts.get(ref.modelKey)?.get(ref.dbId), read.levelNames.get(ref.modelKey)),
    });
  },
  labelOf: pairLabel,
  unavailableText: metadataUnavailableText('Level'),
});

const MODES = new Map([NONE, ELEMENT, MODEL_PAIR, CATEGORY, LEVEL].map((m) => [m.id, m]));

/** Supported GROUP_MODE values, in UI order. */
export const GROUP_MODE_IDS = Object.freeze([...MODES.keys()]);

/** The descriptor for `id`, or null for an unknown / not-yet-supported mode. */
export function groupModeOf(id) {
  return typeof id === 'string' && MODES.has(id) ? MODES.get(id) : null;
}
