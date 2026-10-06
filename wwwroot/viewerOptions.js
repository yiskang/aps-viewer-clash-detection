// wwwroot/viewerOptions.js
//
// Pure decision helper for the sample's opt-in Viewer Clash Panel / SVF2 mode. No globals, no DOM:
// the caller passes `location.search`. DEFAULT behaviour (no recognised query flag) is unchanged:
// legacy SVF initializer, no Clash Panel extension in the GuiViewer3D extension list.
//
//   ?svf2=1            -> SVF2 initializer + Clash Panel extension
//   ?clashPanel=1      -> same
//   ?clashPanelDemo=1  -> same, plus the Structure + Mechanical demo loader (implies the opt-in)

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function flag(params, name) {
    return params.has(name) && TRUTHY.has(String(params.get(name)).trim().toLowerCase());
}

/**
 * @param {unknown} search a `location.search` value, e.g. '?svf2=1'
 * @returns {{svf2: boolean, clashPanel: boolean, demo: boolean}}
 */
export function resolveViewerOptions(search) {
    let params;
    try {
        params = new URLSearchParams(typeof search === 'string' ? search : '');
    } catch {
        params = new URLSearchParams('');
    }
    const demo = flag(params, 'clashPanelDemo');
    const optIn = demo || flag(params, 'svf2') || flag(params, 'clashPanel');
    return { svf2: optIn, clashPanel: optIn, demo };
}

/** The `Autodesk.Viewing.Initializer` options for the resolved mode. */
export function initializerOptions({ svf2 }, getAccessToken) {
    return svf2
        ? { env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken }
        : { env: 'AutodeskProduction', getAccessToken };
}

export function currentSearch() {
    return typeof globalThis.location?.search === 'string' ? globalThis.location.search : '';
}
