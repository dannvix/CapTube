const textareaElem = document.getElementById('settings');
chrome.storage.local.get(['settings'], result => {
    console.log(result.settings);
    textareaElem.value = JSON.stringify(result.settings, null, 4);
});


const versionElem = document.querySelector('#version');
if (versionElem) {
    versionElem.textContent = VERSION;
}


// -----------------------------------------------------------------------------


const port = chrome.runtime.connect({ name: 'options' });
port.onMessage.addListener(message => {
    if (message.type == 'DISPATCH_SETTINGS') {
        console.log(message);
        textareaElem.value = JSON.stringify(message.settings, null, 4);
    }
});


const statusElem = document.getElementById('status');
const resetBtnElem = document.querySelector('button#resetBtn');
const saveBtnElem = document.querySelector('button#saveBtn');

let resetClick = 0;
resetBtnElem.addEventListener('click', evt => {
    resetClick += 1;
    if (resetClick %2 == 0) {
        port.postMessage({
            type: 'UPDATE_SETTINGS',
            settings: null,
        });
        resetBtnElem.textContent = 'Reset to Default';
        statusElem.textContent = 'Reset OK';
        statusElem.style.color = 'hsl(120, 80%, 30%)';
        return;
    }
    resetBtnElem.textContent = 'Confirm Reset';
    statusElem.textContent = 'Click again to Reset';
    statusElem.style.color = 'hsl(210, 90%, 40%)';
}, false);

let saveClick = 0;
saveBtnElem.addEventListener('click', evt => {
    saveClick += 1;
    const settingsJson = textareaElem.value;
    let settings = undefined;
    try {
        settings = JSON.parse(settingsJson);
    }
    catch (err) {
        console.error(err);
        console.log('123');
        statusElem.textContent = 'Invalid JSON format';
        statusElem.style.color = 'hsl(10, 100%, 40%)';
        return;
    }

    // if ((saveClick % 2) == 0) {
    if (true) {
        port.postMessage({
            type: 'UPDATE_SETTINGS',
            settings: settings,
        });
        saveBtnElem.textContent = 'Save';
        statusElem.textContent = 'Save OK';
        statusElem.style.color = 'hsl(120, 80%, 30%)';
        return;
    }
    saveBtnElem.textContent = 'Confirm Save'
    statusElem.textContent = 'Click again to Save';
    statusElem.style.color = 'hsl(210, 90%, 40%)';
}, false);