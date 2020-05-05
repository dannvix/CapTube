let settings = {};

const port = chrome.runtime.connect({ name: 'popup' });
port.onMessage.addListener(message => {
  if (message.type == 'DISPATCH_SETTINGS') {
    console.log(message);
    settings = message.settings || settings;
    renderActiveSettings();
  }
});

// -----------------------------------------------------------------------------

const layoutPresets = [
  { // compact
    bottomBaselineRatio: 0.85,
  },
  { // moderate (default)
    bottomBaselineRatio: 0.9,
  },
  { // ease
    bottomBaselineRatio: 0.95,
  },
];

const primarySizePresets = [
  { // x-small
    primaryCaptionScale: 0.75,
  },
  { // small
    primaryCaptionScale: 0.85,
  },
  { // medium (default)
    primaryCaptionScale: 1.0,
  },
  { // large
    primaryCaptionScale: 1.25,
  },
  { // x-large
    primaryCaptionScale: 1.4,
  },
];

const secondarySizePresets = [
  { // x-small
    secondaryCaptionScale: 0.75,
  },
  { // small
    secondaryCaptionScale: 0.85,
  },
  { // medium (default)
    secondaryCaptionScale: 1.0,
  },
  { // large
    secondaryCaptionScale: 1.25,
  },
  { // x-large
    secondaryCaptionScale: 1.4,
  },
];


function uploadSettings() {
  port.postMessage({
    type: 'UPDATE_SETTINGS',
    settings: settings
  });
}

function resetSettings() {
  port.postMessage({
    type: 'UPDATE_SETTINGS',
    settings: null,
   });
}

function renderActiveSettings() {
  if (document.readyState !== 'complete') return;

  // clear all
  [].forEach.call(document.querySelectorAll('.active'), elem => {
    elem.classList.remove('active');
  });

  let elem;

  // layout
  const layoutId = layoutPresets.findIndex(k => (k.bottomBaselineRatio === settings.bottomBaselineRatio));
  if (layoutId !== -1) {
    elem = document.querySelector(`.settings-layout > div[data-id="${layoutId}"]`);
    elem && elem.classList.add('active');
  }
  // primary font size
  const primaryFontSizeId = primarySizePresets.findIndex(k => (k.primaryCaptionScale === settings.primaryCaptionScale));
  if (primaryFontSizeId !== -1) {
    elem = document.querySelector(`.settings-primary-font-size div.font-size[data-id="${primaryFontSizeId}"]`);
    elem && elem.classList.add('active');
  }

  // secondary font size
  const secondaryFontSizeId = secondarySizePresets.findIndex(k => (k.secondaryCaptionScale === settings.secondaryCaptionScale));
  if (secondaryFontSizeId !== -1) {
    elem = document.querySelector(`.settings-secondary-font-size div.font-size[data-id="${secondaryFontSizeId}"]`);
    elem && elem.classList.add('active');
  }

  // secondary language
  // TODO

  // Tencent Translation (TMT)
  const tmtTitleElem = document.querySelector('.settings-tencent-translation h2');
  tmtTitleElem.style.color = (settings.tmtEnabled) ? 'hsl(120, 90%, 25%)' : 'hsl(0, 0%, 40%)';
  const tmtFieldNames = ['tmtSecretId', 'tmtSecretKey', 'tmtRegion', 'tmtProjectId'];
  tmtFieldNames.forEach(name => {
    const inputElem = document.querySelector(`input[name=${name}]`);
    if (inputElem) {
      inputElem.value = settings[name] || '';
    }
  });

  // DeepL Translation (DMT)
  const dmtTitleElem = document.querySelector('.settings-deepl-translation h2');
  dmtTitleElem.style.color = (settings.dmtEnabled) ? 'hsl(120, 90%, 25%)' : 'hsl(0, 0%, 40%)';
  const dmtFieldNames = ['dmtApiKey'];
  dmtFieldNames.forEach(name => {
    const inputElem = document.querySelector(`input[name=${name}]`);
    if (inputElem) {
      inputElem.value = settings[name] || '';
    }
  });
}

function updateLayout(layoutId) {
  if (layoutId < 0 || layoutId >= layoutPresets.length) return;

  settings = Object.assign(settings, layoutPresets[layoutId]);
  uploadSettings();
  renderActiveSettings();
}

function updatePrimaryFontSize(fontSizeId) {
  if (fontSizeId < 0 || fontSizeId >= primarySizePresets.length) return;

  settings = Object.assign(settings, primarySizePresets[fontSizeId]);
  uploadSettings();
  renderActiveSettings();
}

function updateSecondaryFontSize(fontSizeId) {
  if (fontSizeId < 0 || fontSizeId >= secondarySizePresets.length) return;

  settings = Object.assign(settings, secondarySizePresets[fontSizeId]);
  uploadSettings();
  renderActiveSettings();
}


function renderVersion() {
  let elem = document.querySelector('#version');
  if (elem) {
    elem.textContent = VERSION;
  }
}


window.addEventListener('load', evt => {
  renderVersion();
  renderActiveSettings();

  // handle click events
  // ---------------------------------------------------------------------------
  const layouts = document.querySelectorAll('.settings-layout > div');
  [].forEach.call(layouts, div => {
    const layoutId = parseInt(div.getAttribute('data-id'));
    div.addEventListener('click', evt => updateLayout(layoutId), false);
  });

  const primarySizes = document.querySelectorAll('.settings-primary-font-size div.font-size');
  [].forEach.call(primarySizes, div => {
    const fontSizeId = parseInt(div.getAttribute('data-id'));
    div.addEventListener('click', evt => updatePrimaryFontSize(fontSizeId), false);
  });

  const secondarySizes = document.querySelectorAll('.settings-secondary-font-size div.font-size');
  [].forEach.call(secondarySizes, div => {
    const fontSizeId = parseInt(div.getAttribute('data-id'));
    div.addEventListener('click', evt => updateSecondaryFontSize(fontSizeId), false);
  });

  const tmtSettings = document.querySelectorAll('.settings-tencent-translation input');
  [].forEach.call(tmtSettings, inputElem => {
    inputElem.addEventListener('change', evt => {
      console.log(inputElem.name, inputElem.value, inputElem);
      const tmtFieldNames = ['tmtSecretId', 'tmtSecretKey', 'tmtRegion', 'tmtProjectId'];
      if (tmtFieldNames.indexOf(inputElem.name) >= 0) {
        settings[inputElem.name] = inputElem.value;
        settings.tmtEnabled = tmtFieldNames.every(name => settings[name] && settings[name].length);
      }
      uploadSettings();
    });
  });

  const dmtSettings = document.querySelectorAll('.settings-deepl-translation input');
  [].forEach.call(dmtSettings, inputElem => {
    inputElem.addEventListener('change', evt => {
      console.log(inputElem.name, inputElem.value, inputElem);
      const dmtFieldNames = ['dmtApiKey'];
      if (dmtFieldNames.indexOf(inputElem.name) >= 0) {
        settings[inputElem.name] = inputElem.value;
        settings.dmtEnabled = dmtFieldNames.every(name => settings[name] && settings[name].length);
      }
      uploadSettings();
    });
  });

  const btnReset = document.getElementById('btnReset');
  btnReset.addEventListener('click', evt => {
    if (confirm('Reset to default settings?')) {
      resetSettings();
    }
  }, false);

  const btnProMode = document.getElementById('btnProMode');
  btnProMode.addEventListener('click', evt => {
    chrome.runtime.openOptionsPage();
  })
});
