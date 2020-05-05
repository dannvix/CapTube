const console = require('./console');
const kDefaultSettings = require('./default-settings');


////////////////////////////////////////////////////////////////////////////////


// YouTube uses spfjs (https://github.com/youtube/spfjs) to manipulate window.history.
// It grabs the reference to `history.pushState()` earlier than we can hook the function.
// Instead of racing with YouTube, we opt to watch for page navigation with a busy loop
const watchForUrlChange = (callback) => {
    const POLL_INTERVAL_MS = 100;
    let timer = undefined;
    let previousUrl = window.location.href;
    const pollUrl = () => {
        const currentUrl = window.location.href;
        if (currentUrl != previousUrl) {
            console.log(`URL changed, previous=[${previousUrl}], current=[${currentUrl}]`)
            if (callback) {
                callback(currentUrl, previousUrl);
            }
            previousUrl = currentUrl;
        }
        timer = setTimeout(pollUrl, POLL_INTERVAL_MS);
    };
    timer = setTimeout(pollUrl, POLL_INTERVAL_MS);
};


const hookJsonParseAndWatchForManifest = function(callback) {
    const _parse = JSON.parse;
    window.JSON.parse = (...args) => {
        const result = _parse.call(JSON, ...args);
        if (result && result.playerResponse) {
            const manifest = result.playerResponse;
            if (manifest.videoDetails && manifest.videoDetails.videoId) {
                const videoId = manifest.videoDetails.videoId;
                console.log(`Intercepted manifest ${videoId}`);
            }
            if (callback) {
                callback(manifest);
            }
        }
        return result;
    };
  };


////////////////////////////////////////////////////////////////////////////////


class RendererLoop {
    constructor(playerElem, settings) {
        this.isRunning = false;
        this.isRenderDirty = false;
        this.playerElem = playerElem;
        this.videoElem = undefined;
        this.captionsWrapperElem = undefined;
        this.previousVideoWidth = undefined;
        this.primaryCaption = undefined;
        this.lastPrimaryRendererIds = undefined;
        this.secondaryCaption = undefined;
        this.lastSecondaryRendererIds = undefined;
        this.lastProgressBarShown = undefined;
        this.captionsMenuElem = undefined;
        this.settings = settings;
    }

    start() {
        if (this.isRunning) {
            console.warn('Already running');
            return;
        }
        this.videoElem = this.playerElem.querySelector('video');
        this.isRunning = true;
        window.requestAnimationFrame(this.loop.bind(this));

        // TODO: Integrate a button into YouTube player
        //
        // const bottomRightControlsElem = this.playerElem.querySelector('.ytp-chrome-bottom .ytp-right-controls');
        // if (bottomRightControlsElem) {
        //     const buttonElem = document.createElement('button');
        //     buttonElem.classList.add('ytp-button');
        //     buttonElem.classList.add('ytp-subtitles-button');
        //     // buttonElem.setAttribute('aria-pressed', 'true');
        //     buttonElem.innerHTML = `<svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
        //         <use class="ytp-svg-shadow"></use>
        //         <path transform="scale(-1,1)" transform-origin="center"
        //             d="M11,11 C9.89,11 9,11.9 9,13 L9,23 C9,24.1 9.89,25 11,25 L25,25 C26.1,25 27,24.1 27,23 L27,13 C27,11.9 26.1,11 25,11 L11,11 Z M17,17 L15.5,17 L15.5,16.5 L13.5,16.5 L13.5,19.5 L15.5,19.5 L15.5,19 L17,19 L17,20 C17,20.55 16.55,21 16,21 L13,21 C12.45,21 12,20.55 12,20 L12,16 C12,15.45 12.45,15 13,15 L16,15 C16.55,15 17,15.45 17,16 L17,17 L17,17 Z M24,17 L22.5,17 L22.5,16.5 L20.5,16.5 L20.5,19.5 L22.5,19.5 L22.5,19 L24,19 L24,20 C24,20.55 23.55,21 23,21 L20,21 C19.45,21 19,20.55 19,20 L19,16 C19,15.45 19.45,15 20,15 L23,15 C23.55,15 24,15.45 24,16 L24,17 L24,17 Z" fill="#fff"></path>
        //         </svg>`;
        //     bottomRightControlsElem.insertBefore(buttonElem, bottomRightControlsElem.firstElementChild);
        // }
    }

    stop() {
        if (!this.isRunning) {
            console.warn('Already stopped');
            return;
        }
        this.isRunning = false;
        if (this.captionsWrapperElem) {
            this.captionsWrapperElem.parentNode.removeChild(this.captionsWrapperElem);
        }
        if (this.captionsMenuElem) {
            this.captionsMenuElem.parentNode.removeChild(this.captionsMenuElem);
        }
    }

    loop() {
        try {
            this.render();
            if (this.isRunning) {
                window.requestAnimationFrame(this.loop.bind(this));
            }
        }
        catch (err) {
            console.error('Failed to loop', err)
            this.stop();
        }
    }

    render() {
        try {
            if (!this.playerElem || !this.videoElem) return;
            if (!this.videoElem.src) {
                console.log('No video playing');
                this.stop();
                return;
            }

            // Our captions size is calculated based on video dimension
            const videoWidth = this.videoElem.getBoundingClientRect().width;
            if (videoWidth != this.previousVideoWidth) {
                this.isRenderDirty = true;
                this.previousVideoWidth = videoWidth;
            }

            if (!this.captionsWrapperElem) {
                this.captionsWrapperElem = this._buildCaptionsContainer();
                this.playerElem.appendChild(this.captionsWrapperElem);
            }

            if (!this.captionsMenuElem) {
                this.captionsMenuElem = this._buildCaptionMenuContainer();
                const playerContainerElem = this.playerElem.parentNode.parentNode.parentNode.parentNode;  // Magic
                if (playerContainerElem && playerContainerElem.id == 'player') {
                    playerContainerElem.parentNode.insertBefore(
                        this.captionsMenuElem, playerContainerElem.nextElementSibling);
                }
            }

            // Captions menu
            if (this.isRenderDirty) {
                this._clearCaptionMenuContainer();
                this._renderCaptionMenu().forEach(elem =>
                    this.captionsMenuElem.querySelector('.captube-captions-menu-menu').appendChild(elem));
            }

            // Check if progress bar is shown
            const pBarElem = this.playerElem.querySelector('.ytp-chrome-bottom');
            const pBarShown = (pBarElem && window.getComputedStyle(pBarElem).opacity != '0');
            if (pBarShown != this.lastProgressBarShown) {
                this.lastProgressBarShown = pBarShown;
                this.isRenderDirty = true;
            }

            // FIXME: code is too messy T__T
            if (!this.primaryCaption && !this.secondaryCaption && !this.isRenderDirty) return;
            const currentTimeSecs = this.videoElem.currentTime;
            const [ primaryLines, secondaryLines ] = [this.primaryCaption, this.secondaryCaption].map(caption =>
                (!caption) ? [] : caption.lines.filter(line =>
                    (line.start <= currentTimeSecs && line.end >= currentTimeSecs)));
            const [ primaryLineIds, secondaryLineIds ] = [ primaryLines, secondaryLines ].map(lines =>
                lines.map(line => line.id).sort().toString());

            if (primaryLineIds != this.lastPrimaryRendererIds ||
                secondaryLineIds != this.lastSecondaryRendererIds ||
                this.isRenderDirty)
            {
                this.isRenderDirty = true;
                const primaryTextElem = this._renderPrimaryCaptionSvgText(primaryLines);
                const secondaryTextElem = this._renderSecondaryCaptionSvgText(secondaryLines);
                this._clearRenderedCaptions();

                // Render the text element, and adjust font size if text is too long
                const svgElem = this.captionsWrapperElem.firstElementChild;
                [primaryTextElem, secondaryTextElem].forEach(textElem => {
                    if (!textElem) return;
                    svgElem.appendChild(textElem);
                    const playerRect = this.playerElem.getBoundingClientRect();
                    let widthPx = textElem.getBBox().width;
                    while (widthPx >= (playerRect.width * 0.87)) {
                        const fontSizePx = parseFloat(textElem.style.fontSize);
                        textElem.style.fontSize = `${fontSizePx * 0.95}px`;
                        widthPx = textElem.getBBox().width
                    }
                });

                // Adjust the vertical position of two captions
                // FIXME: code too messy
                const baselineRatio = this.settings.bottomBaselineRatio;
                const playerRect = this.playerElem.getBoundingClientRect();
                const baselineTopPx = !pBarShown ? (playerRect.height * baselineRatio)
                    : Math.min((playerRect.height * baselineRatio), playerRect.height - (49 * 2));  // Magic to dodge progress bar

                [primaryTextElem, secondaryTextElem].forEach((elem, i) => {
                    if (!elem) return;
                    const elemHeightPx = elem.getBBox().height;
                    const elemNewTopPx = baselineTopPx + (i == 0 ? -1.1 : 0.1) * elemHeightPx;  // verticle 10% padding for background
                    elem.setAttribute('y', `${elemNewTopPx - i}px`);  // Magic to avoid the gap between to captions
                })
                this.lastPrimaryRendererIds = primaryLineIds;
                this.lastSecondaryRendererIds = secondaryLineIds;

                // Fill the captions background
                // FIXME: code is shitty like hell
                let defsContent = '';
                ['primary', 'secondary'].forEach(type => {
                    const color = this.settings[`${type}CaptionBackgroundColor`]
                    if (color) {
                        const opacity = this.settings[`${type}CaptionBackgroundOpacity`] || 0.9;
                        defsContent += `
                            <filter x="-2%" y="-10%" width="104%" height="120%" id="${type}Background">
                                <feFlood flood-color="${color}" flood-opacity="${opacity}" result="${type}Flood"></feFlood>
                                <feComposite operator="over" in="SourceGraphic" in2="${type}Flood"></feComposite>
                            </filter>`;
                    }
                });
                const defsElement = this.captionsWrapperElem.querySelector('svg').querySelector('defs');
                defsElement.innerHTML = defsContent;
            }
            this.isRenderDirty = false;
        }
        catch(err) {
            console.error('Failed to render captions', err)
        }
    }

    setPrimaryCaption(caption) {
        this.primaryCaption = caption;
        this.isRenderDirty = true;
    }

    setSecondaryCaption(caption) {
        this.secondaryCaption = caption;
        this.isRenderDirty = true;
    }

    updateSettings(settings) {
        this.settings = settings;
        this.isRenderDirty = true;
    }

    // FIXME: No need this method
    _transformOfficalCaption() {
        const BOTTOM_BASELINE_RATIO = 0.8;
        const OUR_CLASSNAME = 'captube-official-transform';
        const captionElem = this.playerElem.querySelector('.ytp-caption-window-bottom');
        if (!captionElem) return;
        if (!this.isRenderDirty && captionElem.classList.contains(OUR_CLASSNAME)) return;

        const captionRect = captionElem.getBoundingClientRect();
        const playerRect = this.playerElem.getBoundingClientRect();
        const newBottomPx = (playerRect.height * (1.0 - BOTTOM_BASELINE_RATIO)) + captionRect.height;
        captionElem.style.bottom = `${newBottomPx}px`;
        captionElem.style.transition = 'none';
        captionElem.style.marginBottom = '0';
        captionElem.classList.add(OUR_CLASSNAME);
    }

    _clearRenderedCaptions() {
        if (!this.captionsWrapperElem) return;
        const svgElem = this.captionsWrapperElem.firstElementChild;
        [].forEach.call(svgElem.querySelectorAll('text'), elem =>
            elem.parentNode.removeChild(elem));
    }

    _renderPrimaryCaptionSvgText(lines) {
        if (!lines.length) return null;
        const playerRect = this.playerElem.getBoundingClientRect();
        const fontSizePx = (playerRect.width / 40) * this.settings.primaryCaptionScale;  // Magic
        const textContent = lines.slice(-1)[0].text;  // .map(line => line.text).join('  ');
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttributeNS(null, 'text-anchor', 'middle');
        text.setAttributeNS(null, 'alignment-baseline', 'hanging');
        text.setAttributeNS(null, 'dominant-baseline', 'hanging');  // firefox
        text.setAttributeNS(null, 'paint-order', 'stroke');
        text.setAttributeNS(null, 'stroke', this.settings.primaryCaptionStrokeColor);
        text.setAttributeNS(null, 'stroke-width', `${Math.sqrt(fontSizePx)}px`);
        text.setAttributeNS(null, 'x', '50%');
        text.setAttributeNS(null, 'y', '80%');
        text.setAttributeNS(null, 'opacity', this.settings.primaryCaptionOpacity);
        text.setAttributeNS(null, 'filter', 'url(#primaryBackground)');
        text.style.fontSize = `${fontSizePx}px`;
        text.style.fontFamily = this.settings.primaryCaptionFontFamily;
        text.style.fill = this.settings.primaryCaptionTextColor;
        // text.style.stroke = this.settings.primaryCaptionStrokeColor;
        text.textContent = textContent;
        return text;
    }

    _renderSecondaryCaptionSvgText(lines) {
        if (!lines.length) return null;
        const playerRect = this.playerElem.getBoundingClientRect();
        const fontSizePx = (playerRect.width / 40) * this.settings.secondaryCaptionScale;  // Magic
        const textContent = lines.slice(-1)[0].text;  // lines.map(line => line.text).join('  ');
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttributeNS(null, 'text-anchor', 'middle');
        text.setAttributeNS(null, 'alignment-baseline', 'hanging');
        text.setAttributeNS(null, 'dominant-baseline', 'hanging');  // firefox
        text.setAttributeNS(null, 'paint-order', 'stroke');
        text.setAttributeNS(null, 'stroke', this.settings.secondaryCaptionStrokeColor);
        text.setAttributeNS(null, 'stroke-width', `${Math.sqrt(fontSizePx)}px`);
        text.setAttributeNS(null, 'x', '50%');
        text.setAttributeNS(null, 'y', '86%');
        text.setAttributeNS(null, 'opacity', this.settings.secondaryCaptionOpacity);
        text.setAttributeNS(null, 'filter', 'url(#secondaryBackground)');
        text.style.fontSize = `${fontSizePx}px`;
        text.style.fontFamily = this.settings.secondaryCaptionFontFamily,
        text.style.fill = this.settings.secondaryCaptionTextColor;
        // text.style.stroke = this.settings.secondaryCaptionStrokeColor;
        text.textContent = textContent;
        return text;
    }

    _buildCaptionsContainer() {
        const svgElem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgElem.classList.add('captube-captions-svg');
        svgElem.style = 'position:absolute; width:100%; top:0; bottom:0; left:0; right:0; pointer-events:none;';
        svgElem.setAttributeNS(null, 'width', '100%');
        svgElem.setAttributeNS(null, 'height', '100%');

        const defsElem = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgElem.appendChild(defsElem);

        const wrapperElem = document.createElement('div');
        wrapperElem.classList.add('captube-captions-wrapper');
        wrapperElem.style = 'position:absolute; top:0; left:0; width:100%; height:100%; z-index:2; align-items:center; pointer-events:none;'
        wrapperElem.appendChild(svgElem);
        return wrapperElem;
    }

    // FIXME: incorrect responsibility
    _buildCaptionMenuContainer() {
        const containerElem = document.createElement('div');
        containerElem.classList.add('captube-captions-menu-container');
        containerElem.style.fontSize = '14px';
        // containerElem.style.fontFamily = '"YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif';
        containerElem.style.margin = '10px 0';
        containerElem.style.padding = '20px 12px';
        containerElem.style.border = '1px solid hsl(0, 0%, 94%)';
        // containerElem.style.borderRadius = '5px';
        containerElem.style.background = 'hsl(0, 0%, 96%)';
        // containerElem.style.lineHeight = '20px';

        const imgElem = document.createElement('img');
        imgElem.src = window.__capTubeIconUrl;
        imgElem.style.width = '18px';
        imgElem.style.height = '18px';
        imgElem.style.marginRight = '4px';
        imgElem.style.verticalAlign = 'text-bottom';

        const titleSpanElem = document.createElement('span');
        titleSpanElem.textContent = 'CapTube 雙語字幕';
        titleSpanElem.style.fontSize = '15px';
        titleSpanElem.style.fontWeight = 'bold';
        titleSpanElem.style.marginRight = '15px';
        titleSpanElem.style.color = 'hsl(0, 50%, 50%)';
        titleSpanElem.style.letterSpacing = '-0.5px';

        const menuSpanElem = document.createElement('span');
        menuSpanElem.classList.add('captube-captions-menu-menu');

        containerElem.appendChild(imgElem);
        containerElem.appendChild(titleSpanElem);
        containerElem.appendChild(menuSpanElem);
        return containerElem;
    }

    _clearCaptionMenuContainer() {
        if (!this.captionsMenuElem) return;
        [].forEach.call(this.captionsMenuElem.querySelectorAll('.captube-captions-menu-menu *'),
            elem => elem.parentNode.removeChild(elem));
    }

    _renderCaptionMenu() {
        const primarySelectElem = document.createElement('select');
        const secondarySelectElem = document.createElement('select');
        [primarySelectElem, secondarySelectElem].forEach((selectElem, t) => {
            selectElem.style.fontSize = '14px';
            selectElem.style.border = '1px solid hsl(0, 0%, 80%)';
            selectElem.style.marginLeft = '4px';
            ['nativeCaptions', 'translatedCaptions'].forEach((attr, k) => {
                capTubeManager.captionManager[attr].forEach((caption, i) => {
                    const state = { 'GENESIS': '　', 'LOADING': '㉄', 'READY': '㊒', 'ERROR': '╳' }[caption.state];
                    const active = (caption == (t == 0 ? this.primaryCaption : this.secondaryCaption));
                    const optionElem = document.createElement('option');
                    optionElem.value = (i + k * 100);
                    optionElem.textContent = `${caption.name} ${state}`;
                    if (active)  optionElem.selected = 'true';
                    selectElem.appendChild(optionElem);
                });
            });
        });

        // FIXME: pretty dirty :-(
        primarySelectElem.addEventListener('change', evt => {
            const captionId = primarySelectElem.options[primarySelectElem.selectedIndex].value;
            capTubeManager.setPrimaryCaptionId(captionId);
            this.isRenderDirty = true;
        }, false);
        secondarySelectElem.addEventListener('change', evt => {
            const captionId = secondarySelectElem.options[secondarySelectElem.selectedIndex].value;
            capTubeManager.setSecondaryCaptionId(captionId);
            this.isRenderDirty = true;
        }, false);

        const primaryDivElem = document.createElement('div');
        const primaryLabelElem = document.createElement('span');
        primaryLabelElem.textContent = 'PRI';
        primaryLabelElem.style = 'background:hsl(0,0%,75%); font-weight:bold; padding:2px 8px; border-radius:6px; color:white;';
        primaryDivElem.appendChild(primaryLabelElem);
        primaryDivElem.appendChild(primarySelectElem);

        const secondaryDivElem = document.createElement('div');
        const secondaryLabelElem = document.createElement('span');
        secondaryLabelElem.textContent = 'SEC';
        secondaryLabelElem.style = 'background:hsl(0,0%,75%); font-weight:bold; padding:2px 8px; border-radius:6px; color:white;';
        secondaryDivElem.appendChild(secondaryLabelElem);
        secondaryDivElem.appendChild(secondarySelectElem);

        [primaryDivElem, secondaryDivElem].forEach(divElem => {
            divElem.style.display = 'inline-block';
            // divElem.style.marginTop = '4px';
            divElem.style.marginRight = '20px';
        })

        return [primaryDivElem, secondaryDivElem];
    }
}

// -------------------------------------

class CaptionBase {
    constructor(name, langCode) {
        this.state = 'GENESIS';
        this.name = name;
        this.langCode = langCode;
        this.promise = Promise.resolve();
        this.lines = [];
        this.paid = false;
    }

    toString() {
        return `CaptionBase ${this.name} (${this.langCode})`;
    }

    download() {
        return this.promise;
    }
}


class NativeCaption extends CaptionBase {
    constructor(name, langCode, isAsr, url) {
        // NOTE: Regarding langCode, YouTube provides "zh-Hant" and "zh-TW"
        super(name, langCode);
        this.isAsr = isAsr;
        this.url = url;
    }

    toString() {
        return `NativeCaption ${this.name} (${this.langCode}, ${this.isAsr})`;
    }

    download() {
        if (this.state !== 'GENESIS') {
            return this.promise;
        }
        this.state = 'LOADING';
        console.log(`Downloading ${this.toString()}`)
        this.promise = new Promise((resolve, reject) => {
            if (!this.url) {
                reject('URL unavailable');
                return;
            }
            try {
                fetch(this.url).then(r => r.text()).then(xmlText => {
                    try {
                        const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
                        const nodes = [... xml.querySelectorAll('transcript > text')];
                        if (!this.isAsr) {
                            this.lines = nodes.map((node, id) => {
                                const start = parseFloat(node.getAttribute('start'));
                                const end = start + parseFloat(node.getAttribute('dur'));
                                const text = node.textContent.replace(/&#(\d+);/g, (_, charCode) =>
                                    String.fromCharCode(charCode));  // Decode HTML entities (like &#39;)
                                return { id, start, end, text };
                            });
                        }
                        else {
                            // YouTube ASR (auto-generated) captions tend to overlap the "start" and "dur"
                            // Let's combine each two of them into one line, just like what YouTube does for translation
                            this.lines = [];
                            for (let i = 0; i < nodes.length; i += 2) {
                                const id = (i / 2) | 0;
                                const start = parseFloat(nodes[i].getAttribute('start'));
                                const end = start + parseFloat(nodes[i].getAttribute('dur'));
                                let text = nodes[i].textContent + (nodes[i+1] ? (' ' + nodes[i+1].textContent) : '');
                                text = text.replace(/&#(\d+);/g, (_, charCode) => String.fromCharCode(charCode));
                                this.lines.push({ id, start, end, text });
                            }
                        }
                        this.state = 'READY';
                        console.log(`Loaded ${this.toString()}`);
                        resolve(this);
                    }
                    catch (err) {
                        this.state = 'ERROR';
                        console.err('Failed to parse captions', err);
                        reject(err);
                    }
                });
            }
            catch (err) {
                this.state = 'ERROR';
                console.error(`Failed to download ${this.toString()}`, err);
                reject(err);
            }
        });
        return this.promise;
    }
}


class YouTubeTransCaption extends NativeCaption {
    constructor (name, langCode, fromLangCode, fromUrl) {
        super(name, langCode);
        this.fromLangCode = fromLangCode;
        this.url = `${fromUrl}&tlang=${langCode}`;
    }

    toString() {
        return `YouTubeTransCaption ${this.name}`;
    }
}


class TencentTransCaption extends CaptionBase {
    constructor (name, langCode, fromLangCode, fromLines) {
        super(name, langCode);
        this.fromLangCode = fromLangCode;
        this.fromLines = fromLines;
        this.paid = true;
    }

    toString() {
        return `TencentTransCaption ${this.name}`;
    }

    download() {
        if (this.state !== 'GENESIS') {
            return this.promise;
        }

        this.state = 'LOADING';
        console.log(`Translating ${this.toString()}`)

        // XXX: Not a good data flow / dependency
        this.promise = new Promise((resolve, reject) => {
            capTubeManager.translateCaptionThirdParty(this, 'TMT')
                .then(translatedLines => {
                    this.lines = translatedLines;
                    this.state = 'READY';
                    console.log(`Translated ${this.toString()}`);
                    resolve(this);
                })
                .catch(err => {
                    this.state = 'ERROR';
                    console.error(`Failed to translate ${this.toString()}`, err);
                    reject(err);
                });
        });
        return this.promise;
    }
}


// FIXME: Reduce code redundancy with TencentTransCaption
class DeepLTransCaption extends CaptionBase {
    constructor(name, langCode, fromLangCode, fromLines) {
        super(name, langCode.toUpperCase());
        this.fromLangCode = fromLangCode.toUpperCase();
        this.fromLines = fromLines;
        this.paid = true;
    }

    toString() {
        return `DeepLTransCaption ${this.name}`;
    }

    download() {
        if (this.state !== 'GENESIS') {
            return this.promise;
        }

        this.state = 'LOADING';
        console.log(`Translating ${this.toString()}`)

        // XXX: Not a good data flow / dependency
        this.promise = new Promise((resolve, reject) => {
            capTubeManager.translateCaptionThirdParty(this, 'DeepL')
                .then(translatedLines => {
                    this.lines = translatedLines;
                    this.state = 'READY';
                    console.log(`Translated ${this.toString()}`);
                    resolve(this);
                })
                .catch(err => {
                    this.state = 'ERROR';
                    console.error(`Failed to translate ${this.toString()}`, err);
                    reject(err);
                });
        });
        return this.promise;
    }
}


class CaptionManager {
    constructor(nativeCaptions) {
        this.nativeCaptions = nativeCaptions;
        this.translatedCaptions = [];
    }

    getNativeCaption(langCode_) {
        const langCode = langCode_.toLowerCase();
        let caption = this.nativeCaptions.find(cap => (cap.langCode.toLowerCase().startsWith(langCode)) && (!cap.isAsr));
        if (caption) return caption;

        console.log(`NativeCaption non-ASR for ${langCode_} not found`);
        caption = this.nativeCaptions.find(cap => (cap.langCode.toLowerCase().startsWith(langCode)) && (cap.isAsr));
        if (!caption) return caption;

        console.log(`NativeCaption ASR for ${langCode_} not found`);
        return caption;
    }

    searchCaption(langCode_) {
        const langCode = langCode_.toLowerCase();
        const nativeCaptionNonAsr = this.nativeCaptions.find(cap =>
            (cap.langCode.startsWith(langCode)) && (!cap.isAsr));
        if (nativeCaptionNonAsr) {
            console.log(`Looking for ${langCode_}, found ${nativeCaptionNonAsr.toString()}`);
            return nativeCaptionNonAsr;
        }

        const nativeCaptionAsr = this.nativeCaptions.find(cap =>
            (cap.langCode.startsWith(langCode)) && (cap.isAsr));
        if (nativeCaptionAsr) {
            console.log(`Looking for ${langCode_}, found ${nativeCaptionAsr.toString()}`);
            return nativeCaptionAsr;
        }

        const translatedCaptionNonPaid = this.translatedCaptions.find(cap =>
            (cap.langCode.startsWith(langCode)) && (!cap.paid));
        if (translatedCaptionNonPaid) {
            console.log(`Looking for ${langCode_}, found ${translatedCaptionNonPaid.toString()}`);
            return translatedCaptionNonPaid;
        }

        console.log(`Looking for ${langCode_}, not found`);
        return null;
    }

    addTranslatedCaptions(translatedCaptions) {
        this.translatedCaptions = this.translatedCaptions.concat(translatedCaptions);
    }
}



// -------------------------------------

const extractVideoIdFromUrl = () => {
    try {
        const url = window.location.href;
        const match = /youtube\.com\/watch.*(?:\?|&)v=([a-zA-Z0-9_\-]+)/.exec(url);
        if (match) {
            const videoId = match[1];
            return videoId;
        }
    }
    catch (err) {
        console.warn('Failed to prase URL', err)
    }
    return null;
}

class CapTubeManager {
    constructor() {
        this.version = VERSION;
        this.extMsgPort = undefined;
        this.videoId = undefined;
        this.manifest = undefined;
        this.rendererLoop = undefined;
        this.captionManager = undefined;
        this.settings = Object.assign({}, window.__capTubeSettings || kDefaultSettings);
        console.log(`Version ${this.version}`);
        console.log('Settings', this.settings)
        this.connectToExtension();
    }

    busyWaitManifestFromPageSource() {
        // With direct entry to player page (/watch?v=xxxxxxx),
        // YouTube loads video manifest into `window.ytplayer`.
        // However, if after switch to new video (from frontpage or previous video),
        // YouTube does not update `window.ytplayer`.
        const TIMEOUT_MS = 30000;
        const POLL_INTERVAL_MS = 100;
        return new Promise((resolve, reject) => {
            let elapsedMs = 0;
            const interval = setInterval(() => {
                try {
                    const ytplayer = window.ytplayer;
                    if (typeof ytplayer !== 'undefined' &&
                        ytplayer.config && ytplayer.config.loaded &&
                        ytplayer.config.args && ytplayer.config.args.player_response)
                    {
                        clearInterval(interval);
                        const manifestJson = ytplayer.config.args.player_response;
                        const manifest = JSON.parse(manifestJson);
                        resolve(manifest);
                        return;
                    }
                }
                catch (err) {
                    console.error('Failed during locating manifest', err);
                    this.disconnectFromExtension();
                }

                elapsedMs += POLL_INTERVAL_MS
                if (elapsedMs >= TIMEOUT_MS) {
                    clearInterval(interval);
                    reject('timeout');
                }
            }, POLL_INTERVAL_MS);
        });
    }

    busyWaitVideoElem() {
        const TIMEOUT_MS = 30000;
        const POLL_INTERVAL_MS = 100;
        return new Promise((resolve, reject) => {
            let elapsedMs = 0;
            const interval = setInterval(() => {
                try {
                    const playerElem = document.getElementById('ytd-player');
                    if (playerElem) {
                        clearInterval(interval);
                        resolve(playerElem);
                        return;
                    }
                }
                catch (err) {
                    console.error('Failed during locating video', err);
                    this.disconnectFromExtension();
                }

                elapsedMs += POLL_INTERVAL_MS;
                if (elapsedMs >= TIMEOUT_MS) {
                    clearInterval(interval);
                    reject('timeout');
                }
            }, POLL_INTERVAL_MS);
        })
    }

    onPageFirstLoad() {
        const videoIdInUrl = extractVideoIdFromUrl();
        if (!videoIdInUrl) {
            console.log('Not on video page');
            return;
        }

        console.log(`videoId ${videoIdInUrl}`);
        this.busyWaitManifestFromPageSource().then(manifest => {
            try {
                this.onManifestLoad(manifest);
            }
            catch (err) {
                console.error('Failed to load manifest', err);
                this.disconnectFromExtension();
            }
        });
    }

    onPageChange() {
        // When player is minimized (bottom-right), the URL changes to https://youtube.com/ without video ID.
        // That's why we can't just destroy the renderer loop...
        //
        const GRACE_PERIOD_MS = 1000;
        setTimeout(() => {
            if (this.rendererLoop && !this.rendererLoop.isRunning) {
                this.rendererLoop = null;
                console.log('Previous renderer loop terminated');
                this.disconnectFromExtension();
            }
        }, GRACE_PERIOD_MS);
    }

    onManifestLoad(manifest) {
        // Can't do this check because no video ID in URL when player is minimized.
        // Hopefully YouTube doesn't preload manifest in background like Netflix
        //
        // if (videoId != videoIdFromUrl) {
        //     console.log(`Ignore manifest ${videoId}`);
        //     return;
        // }
        const videoId = manifest.videoDetails.videoId;
        console.log(`Manifest ${videoId}`);
        this.manifest = manifest;
        this.videoId = videoId;
        this.extMsgPort.postMessage({ type: 'SET_ICON', iconType: 'half' })

        if (!manifest.captions ||
            !manifest.captions.playerCaptionsTracklistRenderer ||
            !manifest.captions.playerCaptionsTracklistRenderer.captionTracks) {
            console.log('No captions available :-(');
            if (this.rendererLoop) {
                this.rendererLoop.stop();
                this.rendererLoop = null;
            }
            return;
        }

        const captionTracks = manifest.captions.playerCaptionsTracklistRenderer.captionTracks;
        const nativeCaptions = [new CaptionBase('Off', 'off'), ...captionTracks.map(trackInfo => {
            const name = trackInfo.name && trackInfo.name.simpleText;
            const langCode = trackInfo.languageCode;
            const isAsr = !!(trackInfo.kind && trackInfo.kind === 'asr');
            const url = trackInfo.baseUrl;
            return new NativeCaption(name, langCode, isAsr, url);
        })];

        this.captionManager = new CaptionManager(nativeCaptions);
        let englishCaption = this.captionManager.getNativeCaption('en');
        console.log(`English = ${englishCaption && englishCaption.toString()}`);

        // FIXME: Now we only support translations from English to a subset of languages
        const buildListPromise = new Promise((resolve, reject) => {
            if (!englishCaption) {
                reject();
                return;
            }
            englishCaption.download().then(() => {
                if (this.settings.ytTransEnabled) {
                    const YOUTUBE_TARGET_LANGS = [
                        ['zh-Hant', 'Chinese (T)'],
                        ['zh-Hans', 'Chinese (S)'],
                        ['ja', 'Japanese'],
                        ['ko', 'Korean'],
                        ['fr', 'French'],
                        ['es', 'Spannish'],
                    ];
                    this.captionManager.addTranslatedCaptions(
                        YOUTUBE_TARGET_LANGS.map(toLang => {
                            try {
                                const name = `YouTube | English → ${toLang[1]}`;
                                return new YouTubeTransCaption(name, toLang[0], 'en', englishCaption.url);
                            }
                            catch(err) {
                                console.log(`Failed to create YouTubeTransCaption(${toLang})`, err);
                            }
                        }));;
                }
                if (this.settings.tmtEnabled) {
                    // Ref. https://cloud.tencent.com/document/product/551/15619
                    const TENCENT_TARGET_LANGS = [
                        ['zh', 'Chinese (S)'],
                        ['ja', 'Japanese'],
                        ['ko', 'Korean'],
                        ['fr', 'French'],
                        ['es', 'Spannish'],
                        ['it', 'Italian'],
                        ['de', 'German'],
                        ['ru', 'Russian'],
                    ];
                    this.captionManager.addTranslatedCaptions(
                        TENCENT_TARGET_LANGS.map(toLang => {
                            try {
                                const name = `Tencent | English → ${toLang[1]}`;
                                return new TencentTransCaption(name, toLang[0], 'en', englishCaption.lines);
                            }
                            catch (err) {
                                console.log(`Failed to create TencentTransCaption(${toLang})`, err);
                            }
                        }));
                }
                if (this.settings.dmtEnabled) {
                    // Ref. https://www.deepl.com/docs-api/translating-text/request/
                    const DEEPL_TARGET_LANGS = [
                        ['zh', 'Chinese (S)'],
                        ['ja', 'Japanese'],
                        ['es', 'Spannish'],
                        ['it', 'Italian'],
                    ];
                    this.captionManager.addTranslatedCaptions(
                        DEEPL_TARGET_LANGS.map(toLang => {
                            try {
                                const name = `DeepL | English → ${toLang[1]}`;
                                return new DeepLTransCaption(name, toLang[0], 'en', englishCaption.lines);
                            }
                            catch (err) {
                                console.log(`Failed to create DeepLTransCaption(${toLang})`, err);
                            }
                        }));
                }
                resolve();
            });
        });

        this.busyWaitVideoElem().then(playerElem => {
            try {
                if (this.rendererLoop) {
                    this.rendererLoop.stop();
                    this.rendererLoop = null;
                    console.log('Terminated previous renderer loop');
                }
                this.rendererLoop = new RendererLoop(playerElem, this.settings);
                this.rendererLoop.start();
                this.extMsgPort.postMessage({ type: 'SET_ICON', iconType: 'full' })
                console.log('Renderer loop started');

                // Auto-select primary & secondary captions
                // FIXME: Racing with adding translated captions (because they need to wait for English download)
                // Workaround with a dirty promise....
                buildListPromise.finally(() => {
                    ['primaryCaptionSearchCodes', 'secondaryCaptionSearchCodes'].forEach((attr, t) => {
                        console.log(attr, this.settings[attr])
                        for (const langCode of this.settings[attr]) {
                            const caption = this.captionManager.searchCaption(langCode);
                            if (caption) {
                                caption.download().finally(() => this.rendererLoop.isRenderDirty = true);
                                if (t == 0) this.rendererLoop.setPrimaryCaption(caption);
                                else this.rendererLoop.setSecondaryCaption(caption);
                                break;
                            }
                        }
                    })
                });
            }
            catch (err) {
                console.error('Failed to boot up', err);
                this.disconnectFromExtension();
            }
        });
    }

    translateCaptionThirdParty(caption, vendor) {
        if (!this.extMsgPort) {
            this.connectToExtension();
            if (!this.extMsgPort) {
                console.error('Failed to connect to background');
                return Promise.reject('Failed to connect to background');
            }
        }
        return new Promise((resolve, reject) => {
            try {
                const requestId = `${+new Date()}_${Math.random().toString(36).substring(2)}`;
                const listener = this.extMsgPort.onMessage.addListener(message => {
                    if (message.type == 'TRANSLATION_RESULT' &&
                        message.vendor == vendor &&
                        message.requestId == requestId)
                    {
                        this.extMsgPort.onMessage.removeListener(listener);
                        if (message.translatedLines) {
                            resolve(message.translatedLines);
                        }
                        else {
                            reject(message.err);
                        }
                    }
                });
                this.extMsgPort.postMessage({
                    type: 'TRANSLATION_REQUEST',
                    requestId: requestId,
                    vendor: vendor,
                    fromLangCode: caption.fromLangCode,
                    toLangCode: caption.langCode,
                    fromLines: caption.fromLines,
                });
                console.log(`Translation requested ${caption.toString()} (${vendor})`);
            }
            catch(err) {
                console.error(`Failed to request translation`, err);
                reject(err);
            }
        });
    }

    onMessageFromExtension(message) {
        console.log(message);  // DEBUG
        if (message.type == 'DISPATCH_SETTINGS') {
            if (this.rendererLoop) {
                this.rendererLoop.updateSettings(message.settings);
            }
        }
    }

    connectToExtension() {
        if (BROWSER != 'chrome') {
            console.warn('Huh, where are you from?');
            return;
        }
        if (this.extMsgPort) {
            console.warn('Already connected');
            return;
        }
        try {
            const extensionId = window.__capTubeExtId;
            this.extMsgPort = chrome.runtime.connect(extensionId);
            this.extMsgPort.onMessage.addListener(message => {
                this.onMessageFromExtension(message);
            });
            console.log(`Connected ${extensionId}`);
        }
        catch (err) {
            console.error('Failed to connect to background', err);
        }
    }

    disconnectFromExtension() {
        if (BROWSER != 'chrome') {
            console.warn('Hey, just go back to Mars');
            return;
        }
        if (!this.extMsgPort) {
            return;
        }
        this.extMsgPort.disconnect();
        this.extMsgPort = null;
    }

    setPrimaryCaptionId(captionId) {
        const caption = (captionId < 100) ? this.captionManager.nativeCaptions[captionId]
            : this.captionManager.translatedCaptions[captionId % 100];
        console.log(`Primary selected ${caption.toString()}`);
        caption.download().finally(() => this.rendererLoop.isRenderDirty = true);
        this.rendererLoop.setPrimaryCaption(caption);
    }

    setSecondaryCaptionId(captionId) {
        const caption = (captionId < 100) ? this.captionManager.nativeCaptions[captionId]
            : this.captionManager.translatedCaptions[captionId % 100];
        console.log(`Secondary selected ${caption.toString()}`);
        caption.download().finally(() => this.rendererLoop.isRenderDirty = true);
        this.rendererLoop.setSecondaryCaption(caption);
    }
};

// -------------------------------------

const capTubeManager = new CapTubeManager();
window.__capTubeManager = capTubeManager;

watchForUrlChange(capTubeManager.onPageChange.bind(capTubeManager));
hookJsonParseAndWatchForManifest(capTubeManager.onManifestLoad.bind(capTubeManager));
capTubeManager.onPageFirstLoad();
