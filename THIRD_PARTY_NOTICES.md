# Third-party assets

The maintained application code and local-deployment additions have not been assigned a new licence by this packaging work. The following upstream licences continue to apply to bundled dependencies and data. Keep their notices with redistributed packages.

| Component                              | Version/source                                                                           | Licence and bundled notice                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PDF.js and supporting fonts/maps/WASM  | 6.5.438, Mozilla                                                                         | Apache-2.0 and supporting asset notices under `dist/vendor`                                                       |
| PDF-Lib                                | 1.17.1                                                                                   | MIT; `dist/vendor/pdf-lib-LICENSE` or upstream licence file in the vendor directory                               |
| Transformers.js                        | 3.8.1, Hugging Face                                                                      | Apache-2.0; `dist/vendor/recognition/LICENSE`                                                                     |
| ONNX Runtime Web                       | bundled recognition runtime                                                              | MIT; `dist/vendor/recognition/ONNX-LICENSE`                                                                       |
| English TrOCR weights/config/tokenizer | `Xenova/trocr-small-handwritten`, revision `02bea33ca09a70e2e2d91140a7e6e1a729606a5b`    | MIT declared by pinned model card; model card and upstream Microsoft licence in `dist/vendor/recognition/english` |
| Devanagari PaddleOCR ONNX export       | `wycliffeassociates/docscanner-ocr`, revision `354549cf968c1d8883482a1dc74dde9c762ebf53` | Apache-2.0; `dist/vendor/recognition/devanagari/LICENSE` and `SOURCE.txt`                                         |
| Marathi spelling dictionary            | LibreOffice dictionaries, revision `e7b61087d7d42eba51425eae74643ea5623c574a`            | GPL-2.0; unmodified `mr_IN.dic`, `dictionary-COPYING`, and source URL in `SOURCE.txt`                             |
| Noto Sans Devanagari                   | The Noto Project                                                                         | SIL OFL-1.1; `dist/vendor/recognition/devanagari/OFL.txt`                                                         |
| Caddy container                        | official `caddy:2.11.9-alpine`                                                           | Apache-2.0 and image dependency notices supplied by the upstream image                                            |
| Node build image                       | official `node:22-alpine`                                                                | Upstream Node and image dependency notices; only used during image build                                          |

Development-only npm dependencies and their exact transitive versions are recorded in `package-lock.json`; their licence files are provided by the corresponding npm packages after `npm ci`.

Original first-party app baseline: source commit `051b6df2c242ce7de00635b23025a9f49f8130ce`. Hosted-Sites identity and deployment credentials are not required by the local runtime. No credentials are included.
