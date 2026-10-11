// Page-side state capture helper used for this headed run (installed via browser_evaluate; retained here so the
// state-*.json captures are reproducible). Reads only; never mutates Viewer or Panel state.
// Fields:
//   models[]: per visible model {id, isolated:getIsolatedNodes().length, hidden:getHiddenNodes().length}
//   aggregateIsolation: viewer.getAggregateIsolation() -> [{modelId, ids:count}]
//   overlays: child counts of every viewer.impl.overlayScenes entry whose name starts with 'clash-panel'
//   camera: rounded camera position + target (to detect fit/Focus camera change)
//   vm.selected: editor ViewModel selected region (kind/label/counts/actions/notes) as returned by getViewModel()
//   dom: selected group row(s) (.clash-group-row-selected label, aria-current), group-selected region text,
//        markers checkbox disabled/title/aria-describedby reason text
window.__cap = function (tag) {
  const v = NOP_VIEWER;
  const ctl = v.getExtension('Autodesk.Sandbox.ClashPanel')?._host?.panel?.controller;
  const vm = ctl?.getViewModel?.();
  const scenes = v.impl.overlayScenes || {};
  const overlays = {};
  for (const [name, s] of Object.entries(scenes)) if (/clash/i.test(name)) overlays[name] = s.scene?.children?.length ?? null;
  const cam = v.navigation.getPosition(), tgt = v.navigation.getTarget();
  const r = (x) => Math.round(x * 100) / 100;
  const markers = document.querySelector('.clash-selected input[data-key="action-markers"]');
  const reasonId = markers?.getAttribute('aria-describedby');
  return {
    tag, t: new Date().toISOString(),
    models: v.getVisibleModels().map((m) => ({ id: m.id, isolated: v.getIsolatedNodes(m).length, hidden: v.getHiddenNodes(m).length })),
    allModels: v.getAllModels ? v.getAllModels().map((m) => m.id) : null,
    aggregateIsolation: (v.getAggregateIsolation() || []).map((e) => ({ modelId: e.model.id, ids: e.ids.length })),
    overlays,
    camera: { pos: [r(cam.x), r(cam.y), r(cam.z)], target: [r(tgt.x), r(tgt.y), r(tgt.z)] },
    vmSelected: vm?.selected ?? null,
    groupBy: vm?.filters?.groupBy ?? null,
    expanded: [...document.querySelectorAll('.clash-group-toggle[aria-expanded="true"]')].map((e) => e.getAttribute('aria-label')),
    page: vm?.results?.page ?? null,
    filterText: document.querySelector('input[type="search"]')?.value ?? null,
    dom: {
      selectedGroupRows: [...document.querySelectorAll('.clash-group-row-selected .clash-group-label')].map((e) => e.textContent),
      ariaCurrentBodies: [...document.querySelectorAll('.clash-group-body[aria-current="true"]')].map((e) => e.textContent),
      groupRegion: document.querySelector('.clash-selected-group')?.innerText ?? null,
      childRegionTitle: document.querySelector('.clash-selected:not(.clash-selected-group) .clash-selected-title')?.textContent ?? null,
      markers: markers ? { disabled: markers.disabled, checked: markers.checked, title: markers.title, reason: reasonId ? document.getElementById(reasonId)?.textContent?.trim() : null } : null,
    },
  };
};
