// wwwroot/viewerOptions.js
//
// Pure decision helper for the sample's Viewer mode. No globals, no DOM: the caller passes `location.search`.
// DEFAULT (flag-free URL): SVF2 initializer + Room Locator + Clash Finder + Clash Panel extension.
//
//   (none)             -> SVF2 + Clash Panel (normal app)
//   ?svf2=1, ?clashPanel=1 -> harmless legacy aliases of the default
//   ?clashPanelDemo=1  -> same, plus the Structure + Mechanical demo loader (never gates a feature)

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
    return { svf2: true, clashPanel: true, demo };
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
