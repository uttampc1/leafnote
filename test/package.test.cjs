const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
test("both bundled language models match their pinned checksums and sizes", async () => {
  const { languageModels, assetURL } = await import(
    pathToFileURL(root + "/dist/language-catalog.mjs")
  );
  for (const model of languageModels)
    for (const file of model.files) {
      const bytes = await fs.readFile(new URL(assetURL(model, file)));
      assert.equal(bytes.length, file.size, model.id + "/" + file.name);
      if (file.sha256)
        assert.equal(
          crypto.createHash("sha256").update(bytes).digest("hex"),
          file.sha256,
        );
    }
});
test("English browser runtime aliases resolve to local installed model blobs", async () => {
  const { indexedDB } = require("fake-indexeddb");
  const { createModelStore, languageModels } = await import(
    pathToFileURL(root + "/dist/model-storage.mjs")
  );
  const model = languageModels.find((m) => m.id === "en"),
    store = createModelStore({
      indexedDB,
      dbName: "alias-test",
      /** Implement the fetcher callback in this object. */
      fetcher: async (url) => new Response(await fs.readFile(new URL(url))),
    });
  await store.install("en");
  const url = model.remoteBaseUrl + "config.json",
    response = await store.responseFor(url);
  assert.equal((await response.json()).model_type, "vision-encoder-decoder");
  await store.remove("en");
  assert.equal(await store.responseFor(url), undefined);
  await store.close();
});
test("development server serves PWA MIME types and rejects traversal", async () => {
  const { startServer } = await import(
    pathToFileURL(root + "/scripts/serve.mjs")
  );
  const server = await startServer({ port: 0 });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const index = await fetch(base);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /manifest.webmanifest/);
    for (const [url, type] of [
      ["/manifest.webmanifest", "application/manifest+json"],
      ["/sw.js", "text/javascript"],
      ["/vendor/pdf.mjs", "text/javascript"],
      [
        "/vendor/recognition/ort-wasm-simd-threaded.jsep.wasm",
        "application/wasm",
      ],
    ]) {
      const response = await fetch(base + url, { method: "HEAD" });
      assert.match(
        response.headers.get("content-type"),
        new RegExp(type.replace("+", "\\+")),
      );
    }
    assert.equal((await fetch(base + "/%2e%2e%2fpackage.json")).status, 403);
    assert.equal((await fetch(base + "/missing")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
