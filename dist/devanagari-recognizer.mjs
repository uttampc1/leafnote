/** @file Local Devanagari preprocessing, ONNX/WASM inference, and multiple visual candidates. */
import {
  dictionaryWords,
  ctcConfidence,
  rankReadings,
} from "./marathi-candidates.mjs";
// PaddleOCR Devanagari line recognizer. All inference runs in the browser worker.
export /** Resize an RGBA line image and normalize its RGB channels into the Devanagari model’s tensor layout. */
function prepareRGBA(pixels, width, height, horizontalScale = 1) {
  const h = 48,
    resized = Math.max(
      1,
      Math.min(2048, Math.ceil((width / height) * h * horizontalScale)),
    ),
    w = Math.ceil(resized / 32) * 32,
    out = new Float32Array(3 * h * w);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < resized; x++) {
      const sx = Math.min(width - 1, ((x + 0.5) * width) / resized - 0.5),
        sy = Math.min(height - 1, ((y + 0.5) * height) / h - 0.5),
        x0 = Math.max(0, Math.floor(sx)),
        y0 = Math.max(0, Math.floor(sy)),
        x1 = Math.min(width - 1, x0 + 1),
        y1 = Math.min(height - 1, y0 + 1),
        fx = Math.max(0, sx - x0),
        fy = Math.max(0, sy - y0);
      for (let c = 0; c < 3; c++) {
        const a =
            pixels[(y0 * width + x0) * 4 + c] * (1 - fx) +
            pixels[(y0 * width + x1) * 4 + c] * fx,
          b =
            pixels[(y1 * width + x0) * 4 + c] * (1 - fx) +
            pixels[(y1 * width + x1) * 4 + c] * fx;
        out[c * h * w + y * w + x] =
          ((a * (1 - fy) + b * fy) / 255 - 0.5) / 0.5;
      }
    }
  return { data: out, dims: [1, 3, h, w] };
}
export /** Decode the model’s repeated character/blank predictions into normalized Unicode text. */
function decodeCTC(values, dims, charset) {
  const classes = dims.at(-1),
    steps = dims.at(-2),
    tokens = ["", ...charset, " "];
  if (classes !== tokens.length)
    throw Error("Devanagari character table does not match the model");
  let text = "",
    last = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0,
      score = -Infinity;
    for (let c = 0; c < classes; c++) {
      const value = values[t * classes + c];
      if (value > score) {
        score = value;
        best = c;
      }
    }
    if (best !== 0 && best !== last) text += tokens[best];
    last = best;
  }
  return text.trim().normalize("NFC");
}
let ready;
/** Load the installed Devanagari weights, character table, dictionary, and WASM session once. */
async function resources(progress) {
  if (!ready)
    ready = (async () => {
      const { modelStore } = await import("./model-storage.mjs");
      await modelStore.requireInstalled("mr");
      progress?.({
        status: "progress",
        file: "Marathi / Devanagari model",
        progress: 0,
      });
      const ort = await import("./vendor/recognition/ort.bundle.min.mjs");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = new URL(
        "./vendor/recognition/",
        import.meta.url,
      ).href;
      const [model, dict, lexicon] = await Promise.all([
        modelStore.asset("mr", "rec_model.onnx"),
        modelStore.asset("mr", "charset.json"),
        modelStore.asset("mr", "mr_IN.dic"),
      ]);
      if (!model || !dict || !lexicon)
        throw Error("Reinstall the Marathi recognizer from Language models");
      const [bytes, charset, dictionary] = await Promise.all([
        model.arrayBuffer(),
        dict.text().then(JSON.parse),
        lexicon.text().then(dictionaryWords),
      ]);
      const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders: ["wasm"],
      });
      progress?.({
        status: "done",
        file: "Marathi / Devanagari model",
        progress: 100,
      });
      return { ort, session, charset, dictionary };
    })().catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
export /** Generate an original, narrower, or wider rendering for recognition. */
function visualVariant(pixels, width, height, scale) {
  if (
    scale === 1 ||
    typeof OffscreenCanvas === "undefined" ||
    typeof ImageData === "undefined"
  )
    return prepareRGBA(pixels, width, height, scale);
  const source = new OffscreenCanvas(width, height),
    canvas = new OffscreenCanvas(
      Math.max(1, Math.round(width * scale)),
      height,
    );
  source
    .getContext("2d")
    .putImageData(new ImageData(pixels, width, height), 0, 0);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, height);
  return prepareRGBA(
    ctx.getImageData(0, 0, canvas.width, height).data,
    canvas.width,
    height,
  );
}
export /** Recognize three renderings of a handwritten line and rank their visual readings. */
async function recognizeDevanagari(pixels, width, height, progress) {
  const { ort, session, charset, dictionary } = await resources(progress),
    readings = [];
  for (const scale of [1, 0.75, 1.25]) {
    const input = visualVariant(pixels, width, height, scale),
      output = await session.run({
        [session.inputNames[0]]: new ort.Tensor(
          "float32",
          input.data,
          input.dims,
        ),
      }),
      prediction = output[session.outputNames[0]];
    readings.push({
      text: decodeCTC(prediction.data, prediction.dims, charset),
      confidence: ctcConfidence(prediction.data, prediction.dims),
    });
  }
  return rankReadings(readings, dictionary);
}
