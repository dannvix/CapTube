const console = require('./console')
const { RateLimiter } = require('./utils');

const rateLimit = RateLimiter(5);

// -------------------------------------

class TencentHelper {
    constructor(tmtApiHost, tmtSecret, tmtSecretKey, tmtRegion, tmtProjectId, tmtChunkSizeCch) {
        // Ref. https://cloud.tencent.com/document/product/551/15614
        this.tmtApiHost = tmtApiHost;
        this.tmtSecretId = tmtSecret;
        this.tmtSecretKey = tmtSecretKey;
        this.tmtRegion = tmtRegion;
        this.tmtProjectId = tmtProjectId;
        this.chuckSizeCch = parseInt(tmtChunkSizeCch);
    }

    translateCaption(fromLines, fromLangCode, toLangCode) {
        let chunks = [], buffer = [], bufferLength = 0;
        fromLines.map(line => line.text).forEach(lineText => {
            if ((bufferLength + lineText.length) >= this.chuckSizeCch) {
                chunks.push(buffer);
                buffer = [];
                bufferLength = 0;
            }
            buffer.push(lineText);
            bufferLength += lineText.length;
        });
        if (bufferLength) {
            chunks.push(buffer);
            buffer = [];
            bufferLength = 0;
        }
        return this._translateCaptionChunks(fromLines, chunks, fromLangCode, toLangCode);
    }

    _translateCaptionChunks(fromLines, chunks, fromLangCode, toLangCode) {
        return new Promise((resolve, reject) => {
            try {
                const translatePromises = chunks.map((chunk, i) =>
                    new Promise((innerResolve, innerReject) => {
                        try {
                            console.log(`Handling ${i} ... ${fromLangCode} -> ${toLangCode}`);
                            console.log(chunk);  // DEBUG
                            this._buildTmtRequestUrl(chunk, fromLangCode, toLangCode).then(requestUrl => {
                                rateLimit(() => new Promise((rateLimitResolve, rateLimiteReject) => {
                                    console.log(i, requestUrl);
                                    fetch(requestUrl).then(r => r.json()).then(r => {
                                        try {
                                            console.log(i, r);
                                            if (r.Response && r.Response.Error) {
                                                innerReject(r.Response.Error);
                                                return;
                                            }
                                            innerResolve(r.Response.TargetTextList);
                                        }
                                        finally {
                                            rateLimitResolve();
                                        }
                                    })
                                }));
                            });
                        }
                        catch (err) {
                            console.log('Failed to interact with TMT', err);
                            innerReject(err);
                        }
                    }));
                Promise.all(translatePromises)
                    .then(translatedChunks => {
                        try {
                            let translatedLineTexts = [];
                            translatedChunks.forEach(chunk => {
                                translatedLineTexts = translatedLineTexts.concat(chunk);
                            });
                            let translatedLines = [];
                            translatedLineTexts.forEach((lineText, i) => {
                                if (i >= fromLines.length) {
                                    console.warn('Number of lines not match', i);
                                }
                                else {
                                    translatedLines.push({
                                        id: i,
                                        start: fromLines[i].start,
                                        end: fromLines[i].end,
                                        text: lineText,
                                    });
                                }
                            });
                            if (translatedLines.length != fromLines.length) {
                                console.warn(`Number of lines not match, `
                                    + `from=${fromLines.length}, to=${translatedLines.length}`);
                                console.log(fromLines);
                                console.log(translatedLines);
                            }
                            resolve(translatedLines);
                        }
                        catch (err) {
                            console.error('Failed to parse translated result', err);
                            reject(err);
                        }
                    })
                    .catch(err => {
                        console.error('Failed to get translated result', err);
                        reject(err);
                    });
            }
            catch(err) {
                console.error('Failed to translate', err);
                reject(err);
            }
        });
    }

    async _buildTmtRequestUrl(chunk, fromLangCode, toLangCode) {
        const timestamp = ((+new Date() / 1000) | 0);
        const nonce = timestamp;
        // const sourceText = text.replace('\n', ' ');

        let paramsToRequest = `Action=TextTranslateBatch&Nonce=${nonce}&ProjectId=${this.tmtProjectId}`
            + `&Region=${this.tmtRegion}&SecretId=${this.tmtSecretId}&Source=${fromLangCode}`;
            // + `&SourceText=${encodeURIComponent(sourceText)}&Target=${toLangCode}&Timestamp=${timestamp}`
            // + `${this.useSmartChunks ? '&UntranslatedText=' + encodeURIComponent("_NOTRANSLATE_") : ''}&Version=2018-03-21`;

        let paramsToSign = `Action=TextTranslateBatch&Nonce=${nonce}&ProjectId=${this.tmtProjectId}`
            + `&Region=${this.tmtRegion}&SecretId=${this.tmtSecretId}&Source=${fromLangCode}`;
            // + `&SourceText=${sourceText}&Target=${toLangCode}&Timestamp=${timestamp}`
            // + `${this.useSmartChunks ? '&UntranslatedText=_NOTRANSLATE_' : ''}&Version=2018-03-21`;

        let linesToRequest = [], linesToSign = [];
        chunk.forEach((lineText, i) => {
            const text = lineText.replace('\n', ' ');
            linesToRequest.push(`&SourceTextList.${i}=${encodeURIComponent(text)}`);
            linesToSign.push(`&SourceTextList.${i}=${text}`);
        });
        const sortFunc = (paramA, paramB) => {
            // Ref. https://cloud.tencent.com/document/product/551/15616
            const keyA = paramA.split('=', 1)[0];
            const keyB = paramB.split('=', 1)[0];
            return (keyA > keyB) ? 1 : ((keyA < keyB) ? -1 : 0);
        };
        paramsToRequest += linesToRequest.sort(sortFunc).join('')
            + `&Target=${toLangCode}&Timestamp=${timestamp}&Version=2018-03-21`;
        paramsToSign += linesToSign.sort(sortFunc).join('')
            + `&Target=${toLangCode}&Timestamp=${timestamp}&Version=2018-03-21`;

        const bufferToSign = new TextEncoder('utf-8').encode(`GET${this.tmtApiHost}/?${paramsToSign}`);
        const hmacImportParams = {name: 'HMAC', 'hash': 'SHA-1'};
        const tmtSecretKeyBuf = new TextEncoder('utf-8').encode(this.tmtSecretKey);
        const hmacKey = await crypto.subtle.importKey('raw', tmtSecretKeyBuf, hmacImportParams, true, ['sign']);
        const signatureBytes = await crypto.subtle.sign('HMAC', hmacKey, bufferToSign);
        const signatureStr = encodeURIComponent(btoa(
            String.fromCharCode.apply(String, new Uint8Array(signatureBytes)))).replace('+', '%2B');

        const requestUrl = `https://${this.tmtApiHost}/?${paramsToRequest}&Signature=${signatureStr}`;
        console.log(requestUrl);
        return requestUrl;
    }
}

module.exports = TencentHelper;