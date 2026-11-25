const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "../dist");
/** Load the real worker with isolated in-memory Cache API and event handlers. */
function workerHarness() {
  const listeners = {},
    stores = new Map();
  let claimed = false,
    skipped = false,
    network = 0;
  const caches = {
    /** Open a model dialog or note/page through the module’s public entry point. */
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        /** Implement the addAll callback in this object. */
        addAll: async (urls) =>
          urls.forEach((u) => store.set(u, { url: u, offline: true })),
        /** Look up a pinned recognizer asset in installed local model storage. */
        match: async (url) => store.get(String(url)),
      };
    },
    /** Implement the keys callback in this object. */
    keys: async () => [...stores.keys()],
    /** Implement the delete callback in this object. */
    delete: async (name) => stores.delete(name),
  };
  const self = {
    location: { href: "https://192.168.1.50:8443/sw.js" },
    clients: {
      /** Implement the claim callback in this object. */
      claim: async () => {
        claimed = true;
      },
    },
    /** Implement the skipWaiting callback in this object. */
    skipWaiting: () => {
      skipped = true;
    },
    /** Implement the addEventListener callback in this object. */
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
  };
  const context = vm.createContext({
    self,
    caches,
    URL,
    /** Implement the fetch callback in this object. */
    fetch: async () => {
      network++;
      throw Error("offline");
    },
    /** Implement the importScripts callback in this object. */
    importScripts: () => {
      self.LEAFNOTE_PRECACHE = {
        version: "test-v1",
        assets: ["./index.html", "./app.js", "./guide.html"],
      };
    },
  });
  vm.runInContext(fs.readFileSync(root + "/sw.js", "utf8"), context);
  return {
    listeners,
    stores,
    caches,
    /** Implement the claimed callback in this object. */
    get claimed() {
      return claimed;
    },
    /** Implement the skipped callback in this object. */
    get skipped() {
      return skipped;
    },
    /** Implement the network callback in this object. */
    get network() {
      return network;
    },
  };
}
test("manifest has standalone launch, scope, and real 192/512 icons", () => {
  const m = JSON.parse(fs.readFileSync(root + "/manifest.webmanifest", "utf8"));
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  for (const icon of m.icons) {
    const bytes = fs.readFileSync(root + "/" + icon.src),
      size = Number(icon.sizes.split("x")[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
test("worker serves the notebook and query-versioned code offline", async () => {
  const h = workerHarness();
  let job;
  h.listeners.install({
    /** Implement the waitUntil callback in this object. */
    waitUntil: (p) => {
      job = p;
    },
  });
  await job;
  for (const url of [
    "https://192.168.1.50:8443/",
    "https://192.168.1.50:8443/app.js?v=4",
    "https://192.168.1.50:8443/guide.html",
  ]) {
    let response;
    h.listeners.fetch({
      request: { url, method: "GET" },
      /** Implement the respondWith callback in this object. */
      respondWith: (p) => {
        response = p;
      },
    });
    assert.equal((await response).offline, true);
  }
  assert.equal(h.network, 0);
});
test("worker excludes model files and external requests from its shell cache", () => {
  const h = workerHarness();
  for (const url of [
    "https://192.168.1.50:8443/vendor/recognition/english/config.json",
    "https://huggingface.co/model",
    "https://192.168.1.50:8443/unknown",
  ]) {
    let handled = false;
    h.listeners.fetch({
      request: { url, method: "GET" },
      /** Implement the respondWith callback in this object. */
      respondWith: () => {
        handled = true;
      },
    });
    assert.equal(handled, false);
  }
});
test("activation deletes only older Leafnote shells and never activates early", async () => {
  const h = workerHarness();
  await h.caches.open("leafnote-shell-old");
  await h.caches.open("transformers-cache");
  assert.equal(h.skipped, false);
  let job;
  h.listeners.activate({
    /** Implement the waitUntil callback in this object. */
    waitUntil: (p) => {
      job = p;
    },
  });
  await job;
  assert.equal(h.stores.has("leafnote-shell-old"), false);
  assert.equal(h.stores.has("transformers-cache"), true);
  assert.equal(h.claimed, true);
  h.listeners.message({ data: { type: "ACTIVATE_UPDATE" } });
  assert.equal(h.skipped, true);
});
test("generated precache paths exist, exclude models, and cover the runtime", () => {
  const self = {};
  vm.runInNewContext(fs.readFileSync(root + "/precache-manifest.js", "utf8"), {
    self,
  });
  const list = self.LEAFNOTE_PRECACHE.assets;
  for (const f of list) assert.ok(fs.existsSync(path.join(root, f)), f);
  assert.ok(
    list.includes("./vendor/recognition/ort-wasm-simd-threaded.jsep.wasm"),
  );
  assert.ok(list.includes("./vendor/pdf.worker.mjs"));
  assert.ok(!list.some((f) => f.startsWith("./vendor/recognition/english/")));
  assert.ok(!list.includes("./vendor/recognition/devanagari/rec_model.onnx"));
});
