/** @file Pinned local model asset catalogue and source/licence metadata. */
export const languageModels = [
  {
    id: "en",
    name: "English handwriting",
    language: "English",
    revision: "02bea33ca09a70e2e2d91140a7e6e1a729606a5b",
    license: "MIT",
    source: "https://huggingface.co/Xenova/trocr-small-handwritten",
    baseUrl: "./vendor/recognition/english/",
    files: [
      {
        name: "config.json",
        size: 4515,
        sha256: null,
      },
      {
        name: "preprocessor_config.json",
        size: 465,
        sha256: null,
      },
      {
        name: "generation_config.json",
        size: 185,
        sha256: null,
      },
      {
        name: "tokenizer_config.json",
        size: 471,
        sha256: null,
      },
      {
        name: "tokenizer.json",
        size: 4494727,
        sha256: null,
      },
      {
        name: "onnx/encoder_model_quantized.onnx",
        size: 23082942,
        sha256:
          "2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03",
      },
      {
        name: "onnx/decoder_model_merged_quantized.onnx",
        size: 40527613,
        sha256:
          "51076aa396ab5939c4668db9de901ad51765094b4c05c4c8c1f8ae2012ba1e08",
      },
    ],
    validation:
      "Validated on an English handwriting sample in the browser/WASM runtime.",
    limitations:
      "Single text lines. Names and casual handwriting can be misread.",
    remoteBaseUrl:
      "https://huggingface.co/Xenova/trocr-small-handwritten/resolve/02bea33ca09a70e2e2d91140a7e6e1a729606a5b/",
  },
  {
    id: "mr",
    name: "Marathi / Devanagari",
    language: "Marathi (Devanagari)",
    revision: "354549cf968c1d8883482a1dc74dde9c762ebf53",
    license: "Model: Apache-2.0; dictionary: GPL-2.0",
    source: "https://huggingface.co/wycliffeassociates/docscanner-ocr",
    baseUrl: "./vendor/recognition/devanagari/",
    files: [
      {
        name: "rec_model.onnx",
        size: 7934827,
        sha256:
          "a3d5b5fa34fa3dfc9f3790ee5a28da697ea08b0043d25080d19bf1b9517fa56c",
      },
      {
        name: "charset.json",
        size: 3649,
        sha256:
          "621d0073b27b8d8ff19629ee7a961f337697f553a29f21c9817057f4359549c3",
      },
      {
        name: "mr_IN.dic",
        size: 1036511,
        sha256:
          "fe1112d88208b928dc2cca76f18bc3161b99c67b483778ed67fe5877461eb25a",
      },
    ],
    experimental: true,
    validation:
      "Tested on 11 rendered Marathi samples and one revised pen-written Marathi word. Three visual renderings and dictionary-assisted ranking improve conjunct letters.",
    limitations:
      "Experimental handwriting recognition. Names, unfamiliar words, and conjuncts can still be misread. Dictionary ranking can favor a common spelling; review important text.",
    dictionarySource:
      "https://github.com/LibreOffice/dictionaries/tree/e7b61087d7d42eba51425eae74643ea5623c574a/mr_IN",
  },
];
export /** Look up an approved recognition model by language ID. */
function modelFor(id) {
  return languageModels.find((m) => m.id === id);
}
export /** Resolve a pinned model asset to its bundled local server URL. */
function assetURL(model, file) {
  return new URL(file.name, new URL(model.baseUrl, import.meta.url)).href;
}
