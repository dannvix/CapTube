const console = require('./console')
const { RateLimiter } = require('./utils');

const rateLimit = RateLimiter(5);

// -------------------------------------

class DeepLHelper {
    constructor (dmtApiEndpoint, dmtApiKey, dmtChunkSizeLines) {
        // Ref. https://www.deepl.com/docs-api/translating-text/request/
        this.dmtApiEndpoint = dmtApiEndpoint;
        this.dmtApiKey = dmtApiKey;
        this.chunkSizeLines = parseInt(dmtChunkSizeLines);
    }

    translateCaption(fromLines, fromLangCode, toLangCode) {
        let chunks = [];
        for (let i = 0; i < fromLines.length; i += this.chunkSizeLines) {
            chunks.push(fromLines.slice(i, (i + this.chunkSizeLines)).map(line => line.text));
        }
        return new Promise((resolve, reject) => {
            try {
                const translatePromises = chunks.map((chunk, i) =>
                    new Promise((innerResolve, innerReject) => {
                        try {
                            console.log(`Handling ${i} ... ${fromLangCode} -> ${toLangCode}`);
                            console.log(chunk);  // DEBUG
                            const params = `?auth_key=${this.dmtApiKey}`
                                + `&source_lang=${fromLangCode}&target_lang=${toLangCode}`
                                + chunk.map(lineText => `&text=${encodeURIComponent(lineText)}`).join('');

                            rateLimit(() => new Promise((rateLimitResolve, rateLimitReject) => {
                                console.log(i, params);
                                fetch(`${this.dmtApiEndpoint}${params}`).then(r => r.json()).then(r => {
                                    try {
                                        const translatedLines = r.translations.map(t => t.text);
                                        console.log(i, r, translatedLines);
                                        innerResolve(translatedLines);
                                    }
                                    finally {
                                        rateLimitResolve();
                                    }
                                });
                            }));
                        }
                        catch(err) {
                            console.error('Failed to interact with DeepL', err);
                            innerReject(err);
                        }
                    })
                );
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
                                    return;
                                }
                                translatedLines.push({
                                    id: i,
                                    start: fromLines[i].start,
                                    end: fromLines[i].end,
                                    text: lineText,
                                });
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
                    })
            }
            catch (err) {
                console.error('Failed to translate', err);
                reject(err);
            }
        });
    }
}

module.exports = DeepLHelper;