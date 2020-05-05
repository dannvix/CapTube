const kDefaultSettings = require('./default-settings');
const TencentHelper = require('./tencent-helper');
const DeepLHelper = require('./deepl-helper')


////////////////////////////////////////////////////////////////////////////////


let gSettings = Object.assign({}, kDefaultSettings);
console.log(gSettings);

// return true if valid; otherwise return false
function validateSettings(settings) {
  const keys = Object.keys(kDefaultSettings);
  return keys.every(key => (key in settings));
}


chrome.storage.local.get(['settings'], (result) => {
  console.log('loaded', result.settings)
  if (result.settings) {
    const mergedSettings = Object.assign(gSettings, result.settings);
    if (validateSettings(mergedSettings)) {
      gSettings = mergedSettings;
      console.log('mergedSettings', gSettings)
    }
  }
  saveSettings();  // first-time initialization or upgrade
});


function saveSettings() {
  chrome.storage.local.set({ settings: gSettings }, () => {
    console.log('Settings saved into local storage');
  });
}


// ----------------------------------------------------------------------------


function changeIconForTab(tabId, iconType_) {
  const iconType = iconType_ || 'gray';
  const ICON_PATHS_MAPPING = {
    gray: {
      '16': 'icon16-gray.png',
      '32': 'icon32-gray.png',
    },
    half: {
      '16': 'icon16-half.png',
      '32': 'icon32-half.png',
    },
    full: {
      '16': 'icon16.png',
      '32': 'icon32.png',
    }
  };
  chrome.browserAction.setIcon({
    tabId: tabId,
    path: ICON_PATHS_MAPPING[iconType],
  });
}


// -----------------------------------------------------------------------------


let gExtPorts = {}; // tabId -> msgPort; for config dispatching
let gIntPorts = {}; // portId (random) -> msgPort;
function dispatchSettings() {
  const ports = [...Object.values(gExtPorts), ...Object.values(gIntPorts)];
  ports.forEach(port => {
    try {
      port.postMessage({
        type: 'DISPATCH_SETTINGS',
        settings: gSettings,
      });
    }
    catch (err) {
      console.error('Failed to dispatch settings', err, port);
    }
  });
}


// connected from target website (our injected agent)
function handleExternalConnection(port) {
  const tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (!tabId) return;

  gExtPorts[tabId] = port;
  changeIconForTab(tabId, 'half');
  console.log(`Connected ${tabId} (tab)`);

  port.postMessage({
    type: 'DISPATCH_SETTINGS',
    settings: gSettings,
  });

  port.onMessage.addListener(message => {
    // FIXME: reduce code redundancy
    if (message.type == 'TRANSLATION_REQUEST') {
      console.log(`Receive translation request ${message.requestId} (${message.vendor})`);
      if (message.vendor == 'TMT') {
        if (!gSettings.tmtEnabled) {
          console.error('TMT is not enabled');
          return;
        }
        const { tmtApiHost, tmtSecretId, tmtSecretKey, tmtRegion, tmtProjectId, tmtChuckSizeCch } = gSettings;
        const tencentHelper = new TencentHelper(tmtApiHost, tmtSecretId, tmtSecretKey, tmtRegion, tmtProjectId, tmtChuckSizeCch);
        tencentHelper.translateCaption(message.fromLines, message.fromLangCode, message.toLangCode)
          .then(translatedLines => {
            port.postMessage({
              type: 'TRANSLATION_RESULT',
              vendor: 'TMT',
              requestId: message.requestId,
              translatedLines: translatedLines,
            });
          })
          .catch(err => {
            port.postMessage({
              type: 'TRANSLATION_RESULT',
              vendor: 'TMT',
              requestId: message.requestId,
              err: err,
            });
          });
      }
      else if (message.vendor == 'DeepL') {
        if (!gSettings.dmtEnabled) {
          console.error('DMT is not enabled');
          return;
        }
        const {dmtApiEndpoint, dmtApiKey, dmtChunkSizeLines} = gSettings;
        const deeplHelper = new DeepLHelper(dmtApiEndpoint, dmtApiKey, dmtChunkSizeLines);
        deeplHelper.translateCaption(message.fromLines, message.fromLangCode, message.toLangCode)
          .then(translatedLines => {
            port.postMessage({
              type: 'TRANSLATION_RESULT',
              vendor: 'DeepL',
              requestId: message.requestId,
              translatedLines: translatedLines,
            });
          })
          .catch(err => {
            port.postMessage({
              type: 'TRANSLATION_RESULT',
              vendor: 'DeepL',
              requestId: message.requestId,
              err: err,
            });
          });
      }
    }
    else if (message.type == 'SET_ICON') {
      const iconType = message.iconType;
      changeIconForTab(tabId, iconType);
    }
  })

  port.onDisconnect.addListener(() => {
    delete gExtPorts[tabId];
    changeIconForTab(tabId, 'gray');
    console.log(`Disconnected ${tabId} (tab)`);
  });
}


// connected from our pop-up page
function handleInternalConnection(port) {
  const portName = port.name;
  const portId = Math.random().toString(36).substring(2);
  gIntPorts[portId] = port;
  console.log(`Connected ${portName} (${portId}) (internal)`);

  if (portName === 'popup' || portName == 'options') {
    port.postMessage({
      type: 'DISPATCH_SETTINGS',
      settings: gSettings
    });

    port.onMessage.addListener(message => {
      if (message.type == 'UPDATE_SETTINGS') {
        console.log('settings=', message.settings);
        if (!message.settings) {
          gSettings = Object.assign({}, kDefaultSettings);
        }
        else {
          let settings = Object.assign({}, gSettings);
          settings = Object.assign(settings, message.settings);
          if (!validateSettings(settings)) {
            // Invalid settings received (this should not happen), reset all settings to default
            gSettings = Object.assign({}, kDefaultSettings);
          }
          else {
            gSettings = settings;
          }
        }
        saveSettings();
        dispatchSettings();
      }
    });
  }

  port.onDisconnect.addListener(() => {
    delete gIntPorts[portId];
    console.log(`Disconnected ${portName} (${portId}) (internal)`);
  });
}

// -----------------------------------------------------------------------------


// handle connections from target website and our pop-up
if (BROWSER === 'chrome') {
  chrome.runtime.onConnectExternal.addListener(
    port => handleExternalConnection(port));

  chrome.runtime.onConnect.addListener(
    port => handleInternalConnection(port));
}
else {
  // Firefox: either from website (injected agent) or pop-up are all "internal"
  chrome.runtime.onConnect.addListener(port => {
    if (port.sender && port.sender.tab) {
      handleExternalConnection(port);
    }
    else {
      handleInternalConnection(port);
    }
  });
}
