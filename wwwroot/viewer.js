// The id is imported, never re-declared here: the extension registers its own context-menu callback
// under this exact string, so a duplicated literal that drifted would silently break both
// registerExtension matching and unregisterContextMenuCallback.
import { RoomLocatorExtension, EXTENSION_ID as ROOM_LOCATOR_EXTENSION_ID } from './extensions/RoomLocatorExtension.js';

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
            const extensions = [
                'Autodesk.DocumentBrowser',
                ROOM_LOCATOR_EXTENSION_ID,
            ];

            const config = { extensions };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');
            resolve(viewer);
        });
    });
}

export function loadModel(viewer, urn) {
    return new Promise(function (resolve, reject) {
        function onDocumentLoadSuccess(doc) {
            resolve(viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true)));
        }
        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}
