// The id is imported, never re-declared here: the extension registers its own context-menu callback
// under this exact string, so a duplicated literal that drifted would silently break both
// registerExtension matching and unregisterContextMenuCallback.
import { RoomLocatorExtension, EXTENSION_ID as ROOM_LOCATOR_EXTENSION_ID } from './extensions/RoomLocatorExtension.js';
import { ClashFinderExtension, EXTENSION_ID as CLASH_FINDER_EXTENSION_ID } from './extensions/ClashFinderExtension.js';

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        alert('Could not obtain access token. See the console for more details.');
        console.error(err);
    }
}

export function initViewer(container) {
    return new Promise(function (resolve, reject) {
        Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () {
            Autodesk.Viewing.theExtensionManager.registerExtension(ROOM_LOCATOR_EXTENSION_ID, RoomLocatorExtension);
            Autodesk.Viewing.theExtensionManager.registerExtension(CLASH_FINDER_EXTENSION_ID, ClashFinderExtension);
            const extensions = [
                'Autodesk.DocumentBrowser',
                ROOM_LOCATOR_EXTENSION_ID,
                CLASH_FINDER_EXTENSION_ID,
            ];

            const config = { extensions };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');
            resolve(viewer);
        });
    });
}

// `keepCurrentModels` is forwarded verbatim as `LoadModelOptions.keepCurrentModels` (see
// node_modules/@types/forge-viewer/index.d.ts:261, GuiViewer3D.loadDocumentNode's third-argument
// options type at :1207-1211) -- `false` by default so every existing caller that omits the options
// object entirely keeps loading exactly as before (loadDocumentNode's own default behavior for an
// omitted/false keepCurrentModels is to unload whatever model(s) are currently loaded first).
export function loadModel(viewer, urn, { keepCurrentModels = false } = {}) {
    return new Promise(function (resolve, reject) {
        function onDocumentLoadSuccess(doc) {
            resolve(viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), { keepCurrentModels }));
        }
        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}
