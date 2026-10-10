// clashpanel/core/intents.js
// The ONLY vocabulary the UI may dispatch to the controller (catalog §4; frozen). Payload fields, all optional
// unless noted — `value` carries a control's new value:
//   SETUP_NAME/SETUP_MODE('hard'|'soft')/SETUP_CLEARANCE(string)/SETUP_SELF_CLASH(boolean): {value}
//   SETUP_BASIS: {value: ''|'mm'|'cm'|'m'|'in'|'ft'|'raw'} — the user's Soft basis attestation (never `verified`)
//   SETUP_TOGGLE_MODEL: {side:'A'|'B', modelKey}      SETUP_USE_SELECTION: {side:'A'|'B'}
//   FILTER_TEXT(string)/FILTER_MAX_GAP(string)/FILTER_UNVERIFIED(boolean)/FILTER_HAS_LOCATION(boolean): {value}
//   FILTER_MODEL: {value: string[]} ([] = all models)  FILTER_ELEMENT: {ref:{modelKey,dbId}|null}
//   GROUP_MODE: {value:'none'|'element'|'modelPair'|'category'|'level'} (groupModes.js GROUP_MODE_IDS; others ignored)  GROUP_TOGGLE: {groupId}  SORT_SET: {value:'default'|'gap-asc'|'group-count'|'group-label'}
//   NAV_SELECT: {resultId, groupId:string|null}        NAV_PAGE: {page:number}
//   ACTION_ISOLATE/ACTION_MARKERS/ACTION_FOCUS_ON_SELECT: {value:boolean}
//   Every other intent carries no payload. A ViewModel banner's optional `action: {label, intent}` carries the
//   exact intent its button dispatches (RUN_RELEASE_AND_RETRY / RESULTS_CLEAR / RESULTS_CLEAR_CONFIRMED).
//   SETUP_TOGGLE_COLLAPSED (catalog addition, requested by the UI part) flips `vm.setup.collapsed`.
//   DIAGNOSTICS_COPY is the one intent whose dispatch() RESOLVES WITH A VALUE: the plain-JSON diagnostics string
//   (or null when no result set is displayed); the UI copies it to the clipboard.
//   TEST_LOAD: {testId, draft, acknowledgeUnsaved?} — resolves {ok, testId, version, releaseStuck, reason?} (the second
//   intent that resolves a value); CONFIRM_CANCEL: no payload; TEST_LABEL_SCOPE: {modelKeys: string[]} — model keys that
//   count as KNOWN for model-name disambiguation (seam (e)).
//   MANAGER_INTENT: the Clash Tests manager's own vocabulary (spec §26.9); dispatched to the manager, never to the editor.
export const INTENT = Object.freeze({
  SETUP_NAME: 'setup/name', SETUP_MODE: 'setup/mode', SETUP_CLEARANCE: 'setup/clearance', SETUP_BASIS: 'setup/basis',
  SETUP_TOGGLE_MODEL: 'setup/toggleModel',
  SETUP_USE_SELECTION: 'setup/useSelection',
  SETUP_SELF_CLASH: 'setup/selfClash',
  SETUP_NEW_TEST: 'setup/newTest',
  SETUP_TOGGLE_COLLAPSED: 'setup/toggleCollapsed',
  RUN_START: 'run/start', RUN_STOP: 'run/stop', RESULTS_CLEAR: 'results/clear', RESULTS_CLEAR_CONFIRMED: 'results/clearConfirmed', RUN_RELEASE_AND_RETRY: 'run/releaseAndRetry',
  FILTER_TEXT: 'filter/text', FILTER_MODEL: 'filter/model', FILTER_MAX_GAP: 'filter/maxGap', FILTER_UNVERIFIED: 'filter/unverified', FILTER_HAS_LOCATION: 'filter/hasLocation',
  FILTER_ELEMENT: 'filter/element',
  FILTER_CLEAR: 'filter/clear',
  GROUP_MODE: 'group/mode',
  GROUP_TOGGLE: 'group/toggle',
  SORT_SET: 'sort/set',
  NAV_SELECT: 'nav/select',
  NAV_PREV: 'nav/prev', NAV_NEXT: 'nav/next', NAV_PAGE: 'nav/page',
  ACTION_FOCUS: 'action/focus', ACTION_ISOLATE: 'action/isolate', ACTION_MARKERS: 'action/markers',
  ACTION_FOCUS_ON_SELECT: 'action/focusOnSelect', ACTION_BACK_TO_ALL: 'action/backToAll',
  PANEL_HIDDEN: 'panel/hidden', PANEL_SHOWN: 'panel/shown',
  DIAGNOSTICS_COPY: 'diagnostics/copy',
  TEST_LOAD: 'test/load',          // spec §26.2 (a): manager-only seam; resolves a LoadResult
  CONFIRM_CANCEL: 'confirm/cancel', // spec §26.2 (c): drops the editor's pending one-time confirmation
  TEST_LABEL_SCOPE: 'test/labelScope', // seam (e), owner decision G-A2: manager-only; the referenced-model-key label scope
});
// Spec §26.2a/§26.9: the Clash Tests manager's vocabulary. Payloads: OPEN/DUPLICATE/RESET/DELETE {testId};
// CONFIRM/CANCEL {operationId}; VIEW_LIST/VIEW_EDITOR/CREATE none. Values never collide with INTENT's.
export const MANAGER_INTENT = Object.freeze({
  VIEW_LIST: 'manager/viewList', VIEW_EDITOR: 'manager/viewEditor',
  OPEN: 'manager/open', CREATE: 'manager/create', DUPLICATE: 'manager/duplicate',
  RESET: 'manager/reset', DELETE: 'manager/delete',
  CONFIRM: 'manager/confirm', CANCEL: 'manager/cancel',
});
