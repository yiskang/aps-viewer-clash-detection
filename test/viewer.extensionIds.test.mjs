// test/viewer.extensionIds.test.mjs
//
// M2 Task 16: wwwroot/viewer.js now registers BOTH RoomLocatorExtension and ClashFinderExtension
// with Autodesk.Viewing.theExtensionManager and includes both ids in the GuiViewer3D config's
// `extensions` array; wwwroot/viewer.js's loadModel(viewer, urn, options) also now forwards a
// `{ keepCurrentModels }` third argument to viewer.loadDocumentNode.
//
// codex-advisor review (M2 Task 16) flagged that an earlier version of this file only checked that
// the two EXTENSION_ID string constants were distinct -- an assertion that would still pass even if
// wwwroot/viewer.js stopped importing ClashFinderExtension entirely, never called registerExtension
// for it, or omitted it from the `extensions` array. That earlier assertion tested nothing about
// Task 16's own wiring (the actual reason this task exists), and duplicated a check
// ClashFinderExtension.test.mjs already makes on the extension module itself. This version instead
// exercises wwwroot/viewer.js's real `initViewer`/`loadModel` functions directly, under a minimal
// stubbed `Autodesk` global (the same headless-Node technique RoomLocatorExtension.test.mjs and
// ClashFinderExtension.test.mjs already use for the extension classes themselves, applied here one
// level up at the viewer.js integration seam) -- so a regression in either registration call or the
// `extensions` array would actually fail this test.
//
// Everything below runs in ONE test file / ONE Node process (scripts/run-tests.mjs spawns each
// `*.test.mjs` file as its own `node --test` child process — see that script's own header — so this
// stubbed global.Autodesk cannot leak into any other test file).
const registerCalls = [];
let capturedConfig = null;
let capturedContainer = null;
const documentLoadCalls = [];

class FakeGuiViewer3D {
  constructor(container, config) {
    capturedContainer = container;
    capturedConfig = config;
  }
  start() {}
  setTheme(theme) { this.theme = theme; }
}

// A fake "document" shaped just enough for loadModel's own onDocumentLoadSuccess to call
// doc.getRoot().getDefaultGeometry(true) without throwing.
const fakeDoc = {
  getRoot() {
    return { getDefaultGeometry(applyRefPoint) { return { fakeGeometryNode: true, applyRefPoint }; } };
  },
};

globalThis.Autodesk = {
  Viewing: {
    // Real Autodesk.Viewing.Initializer is asynchronous; this stub invokes its callback
    // synchronously, which is sufficient to drive initViewer's own returned Promise to resolution
    // (initViewer only ever does work INSIDE that callback, then calls resolve(viewer)).
    Initializer(options, callback) { callback(); },
    theExtensionManager: {
      registerExtension(id, ctor) { registerCalls.push({ id, ctor }); return true; },
    },
    GuiViewer3D: FakeGuiViewer3D,
    Document: {
      load(urn, onSuccess, onFailure) { documentLoadCalls.push(urn); onSuccess(fakeDoc); },
    },
  },
};

// Imported dynamically, AFTER the fake global.Autodesk above is installed, matching the codex-advisor
// suggested approach -- though wwwroot/viewer.js itself only ever references `Autodesk` inside
// function bodies (never at module-evaluation time), so this ordering is a belt-and-suspenders
// precaution rather than a strict requirement.
const { initViewer, loadModel } = await import('../wwwroot/viewer.js');
const { RoomLocatorExtension, EXTENSION_ID: ROOM_LOCATOR_EXTENSION_ID } = await import('../wwwroot/extensions/RoomLocatorExtension.js');
const { ClashFinderExtension, EXTENSION_ID: CLASH_FINDER_EXTENSION_ID } = await import('../wwwroot/extensions/ClashFinderExtension.js');

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}

// === EXTENSION_ID sanity (still worth keeping as a cheap guard against literal drift) ============
check('RoomLocatorExtension.EXTENSION_ID is a non-empty string', typeof ROOM_LOCATOR_EXTENSION_ID === 'string' && ROOM_LOCATOR_EXTENSION_ID.length > 0, true);
check('ClashFinderExtension.EXTENSION_ID is a non-empty string', typeof CLASH_FINDER_EXTENSION_ID === 'string' && CLASH_FINDER_EXTENSION_ID.length > 0, true);
check('RoomLocatorExtension and ClashFinderExtension use DISTINCT extension ids', ROOM_LOCATOR_EXTENSION_ID !== CLASH_FINDER_EXTENSION_ID, true);

// === initViewer actually wires ClashFinderExtension (Task 16's own critical step) =================
const fakeContainer = { id: 'fake-preview-container' };
const viewer = await initViewer(fakeContainer);

check(
  'initViewer registers RoomLocatorExtension under its own EXTENSION_ID with the correct constructor',
  registerCalls.some((r) => r.id === ROOM_LOCATOR_EXTENSION_ID && r.ctor === RoomLocatorExtension),
  true,
);
check(
  'initViewer registers ClashFinderExtension under its own EXTENSION_ID with the correct constructor -- Task 16 exists to add exactly this call',
  registerCalls.some((r) => r.id === CLASH_FINDER_EXTENSION_ID && r.ctor === ClashFinderExtension),
  true,
);
check('exactly two extensions were registered (no accidental duplicate or missing registration)', registerCalls.length, 2);
check('GuiViewer3D config.extensions includes Autodesk.DocumentBrowser', capturedConfig?.extensions?.includes('Autodesk.DocumentBrowser'), true);
check('GuiViewer3D config.extensions includes RoomLocatorExtension\'s id', capturedConfig?.extensions?.includes(ROOM_LOCATOR_EXTENSION_ID), true);
check('GuiViewer3D config.extensions includes ClashFinderExtension\'s id', capturedConfig?.extensions?.includes(CLASH_FINDER_EXTENSION_ID), true);
check('GuiViewer3D was constructed with the container initViewer was given', capturedContainer, fakeContainer);
check('initViewer resolves with the constructed GuiViewer3D instance', viewer instanceof FakeGuiViewer3D, true);

// === loadModel forwards keepCurrentModels to loadDocumentNode's third argument (Task 16 Step 1) ===
const loadDocumentNodeCalls = [];
const fakeViewerForLoadModel = {
  loadDocumentNode(doc, node, options) {
    loadDocumentNodeCalls.push({ doc, node, options });
    return Promise.resolve('fake-model-result');
  },
};

await loadModel(fakeViewerForLoadModel, 'some-urn', { keepCurrentModels: true });
check(
  'loadModel({ keepCurrentModels: true }) forwards keepCurrentModels:true to loadDocumentNode\'s third argument',
  loadDocumentNodeCalls[0]?.options?.keepCurrentModels,
  true,
);

loadDocumentNodeCalls.length = 0;
await loadModel(fakeViewerForLoadModel, 'some-urn'); // options argument omitted entirely
check(
  'loadModel with the options argument omitted defaults keepCurrentModels to false (protected invariant: existing callers behave as before)',
  loadDocumentNodeCalls[0]?.options?.keepCurrentModels,
  false,
);
check('loadModel calls Autodesk.Viewing.Document.load with the "urn:" prefix', documentLoadCalls[documentLoadCalls.length - 1], 'urn:some-urn');

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
