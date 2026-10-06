import { initViewer, loadModel } from './viewer.js';
import { openModelPicker } from './model-picker.js';
import { normalizeUrn, urnFromHash, shouldLoadFromHash } from './urn.js';
import { resolveViewerOptions, currentSearch } from './viewerOptions.js';
import { loadDemoModels } from './clashPanelDemo.js';

/** The URN most recently handed to `onModelSelected`; see `shouldLoadFromHash`. */
let lastRequestedUrn = '';

const viewerOptions = resolveViewerOptions(currentSearch());

initViewer(document.getElementById('preview')).then(viewer => {
    window.viewer = viewer;
    setupUrnInput(viewer, { skipInitialHashLoad: viewerOptions.demo });
    if (viewerOptions.demo) {
        // ?clashPanelDemo=1: Structure then Mechanical as federated models. Never writes the location hash.
        loadDemoModels(viewer, { loadModel }).catch(err => {
            console.error('Clash Panel demo: could not load the demo models', err);
            alert('Could not load the Clash Panel demo models. See the console for more details.');
        });
    }
});

function setupUrnInput(viewer, { skipInitialHashLoad = false } = {}) {
    const input = document.getElementById('urn');
    const loadButton = document.getElementById('load');
    const browseButton = document.getElementById('browse');
    const keepCheckbox = document.getElementById('keep-current-models');

    const request = (urn) => {
        lastRequestedUrn = urn;
        onModelSelected(viewer, urn, { keepCurrentModels: keepCheckbox.checked });
    };

    loadButton.onclick = () => {
        const urn = normalizeUrn(input.value);
        if (urn) {
            request(urn);
        }
    };

    input.onkeydown = (event) => {
        if (event.key === 'Enter') {
            loadButton.click();
        }
    };

    // Browse fills the textbox and nothing more. Load is the only thing that
    // ever loads, so the textbox is always what will load next.
    browseButton.onclick = async () => {
        const urn = await openModelPicker(browseButton);
        if (urn) {
            input.value = urn;
            request(urn);
        }
    };

    window.addEventListener('hashchange', () => {
        const urn = urnFromHash(window.location.hash);
        if (!shouldLoadFromHash(urn, lastRequestedUrn)) {
            return;
        }
        input.value = urn;
        request(urn);
    });

    const initialUrn = urnFromHash(window.location.hash);
    if (initialUrn && !skipInitialHashLoad) {
        input.value = initialUrn;
        request(initialUrn);
    }
}

async function onModelSelected(viewer, urn, { keepCurrentModels = false } = {}) {
    if (window.onModelSelectedTimeout) {
        clearTimeout(window.onModelSelectedTimeout);
        delete window.onModelSelectedTimeout;
    }
    // The hash identifies the PRIMARY model for share/reload purposes -- an additional
    // (federated) load must never overwrite it, or a later page reload/share link would only
    // reproduce the last-loaded model instead of the session's actual primary one.
    if (!keepCurrentModels) {
        window.location.hash = urn;
    }
    try {
        const resp = await fetch(`/api/models/${urn}/status`);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const status = await resp.json();
        switch (status.status) {
            case 'n/a':
                showNotification(`Model has not been translated.`);
                break;
            case 'inprogress':
                showNotification(`Model is being translated (${status.progress})...`);
                // Thread the SAME options through the retry -- a model still translating when the
                // user checked "load as additional" must still load as additional once translation
                // finishes, not silently revert to keepCurrentModels:false on retry.
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, viewer, urn, { keepCurrentModels });
                break;
            case 'failed':
                showNotification(`Translation failed. <ul>${status.messages.map(msg => `<li>${JSON.stringify(msg)}</li>`).join('')}</ul>`);
                break;
            default:
                clearNotification();
                loadModel(viewer, urn, { keepCurrentModels });
                break;
        }
    } catch (err) {
        alert('Could not load model. See the console for more details.');
        console.error(err);
    }
}

function showNotification(message) {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = `<div class="notification">${message}</div>`;
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'none';
}
