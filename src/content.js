const console = require('./console');


window.addEventListener('load', () => {
  let scriptElem = document.createElement('script');
  scriptElem.setAttribute('type', 'text/javascript');
  scriptElem.textContent = `(() => {
      window.__capTubeExtId = ${JSON.stringify(chrome.runtime.id)};
      window.__capTubeIconUrl = ${JSON.stringify(chrome.extension.getURL('icon32.png'))};
      console.log("CapTube at ${chrome.runtime.id}");
    })();`;
  document.head.appendChild(scriptElem);

  // FIXME: should extract to a function and shared with background.js
  chrome.storage.local.get(['settings'], result => {
    const scriptElem = document.createElement('script');
    scriptElem.setAttribute('type', 'text/javascript');
    scriptElem.textContent = `(() => {
        window.__capTubeSettings = ${JSON.stringify(result.settings)};
      })();`;
    document.head.appendChild(scriptElem);
  });

  const scriptsToInject = ['captube.min.js'];
  scriptsToInject.forEach(scriptName => {
    const scriptElem = document.createElement('script');
    scriptElem.setAttribute('type', 'text/javascript');
    scriptElem.setAttribute('src', chrome.extension.getURL(scriptName));
    document.head.appendChild(scriptElem);
    console.log(`Injected ${scriptName}`);
  });
});
