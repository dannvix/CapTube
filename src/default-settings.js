// default values should be in sync with "popup.js"
const kDefaultSettings = {
  bottomBaselineRatio: 0.9,

  primaryCaptionScale: 1.0,
  primaryCaptionOpacity: 0.9,
  primaryCaptionFontFamily: 'inherit',
  primaryCaptionTextColor: 'white',
  primaryCaptionStrokeColor: '',
  primaryCaptionBackgroundColor: '#000000',
  primaryCaptionBackgroundOpacity: 0.85,

  secondaryCaptionScale: 1.0,
  secondaryCaptionOpacity: 0.9,
  secondaryCaptionFontFamily: 'inherit',
  secondaryCaptionTextColor: 'white',
  secondaryCaptionStrokeColor: '',
  secondaryCaptionBackgroundColor: '#000000',
  secondaryCaptionBackgroundOpacity: 0.85,

  // Preferences
  primaryCaptionSearchCodes: ['zh-TW', 'zh-Hant', 'zh-CN', 'zh'],
  secondaryCaptionSearchCodes: ['en-US', 'en', 'ja'],

  // YouTube Translation
  ytTransEnabled: true,

  // Tencent Translation (TMT)
  tmtEnabled: false,
  tmtApiHost: 'tmt.tencentcloudapi.com',
  tmtSecretId:'',
  tmtSecretKey:'',
  tmtRegion: 'ap-hongkong',
  tmtProjectId: '0',
  tmtChuckSizeCch: 1950,

  // DeepL Translation (DMT)
  dmtEnabled: false,
  dmtApiEndpoint: 'https://api.deepl.com/v2/translate',
  dmtApiKey: '',
  dmtChunkSizeLines: 49,
};

module.exports = kDefaultSettings;
