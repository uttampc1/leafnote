const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path"),
  { JSDOM } = require("jsdom");
/** Run the real consent UI with isolated metadata and observable fake network/engine boundaries. */
async function syncUI(initial = {}) {
  const page = fs
      .readFileSync(path.join(__dirname, "../dist/index.html"), "utf8")
      .replace(/<script[\s\S]*?<\/script>/g, ""),
    dom = new JSDOM(page, {
      url: "https://192.168.1.50:8443/",
      runScripts: "outside-only",
    }),
    w = dom.window,
    context = dom.getInternalVMContext();
  let saved = { deviceId: "test-device", ...initial },
    runs = 0,
    authenticated = 0;
  w.$ = (selector) => w.document.querySelector(selector);
  w.LeafnoteApp = {
    ready: true,
    sync: {
      /** Implement the supported callback in this object. */
      supported: () => true /** Implement the busy callback in this object. */,
      /** Implement the busy callback in this object. */
      busy: () => false,
    },
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Object.defineProperty(w.navigator, "onLine", { value: true, writable: true });
  w.fetch = async (url) => {
    assert.equal(String(url), "./api/sync/config");
    return {
      ok: true /** Implement the json callback in this object. */,
      /** Implement the json callback in this object. */
      json: async () => ({ enabled: true, protocol: 3 }),
    };
  };
  const settings = new vm.SyntheticModule(
    ["createSyncSettings"],
    function () {
      this.setExport("createSyncSettings", () => ({
        /** Implement the load callback in this object. */
        load: async () => structuredClone(saved),
        /** Persist layout visibility preferences separately from note content. */
        save: async (patch) => {
          saved = { ...saved, ...structuredClone(patch) };
        },
      }));
    },
    { context },
  );
  const engine = new vm.SyntheticModule(
    ["createSyncEngine", "createSyncTransport"],
    function () {
      this.setExport("createSyncEngine", () => ({
        /** Implement the run callback in this object. */
        run: async () => {
          runs++;
          return true;
        },
        /** Implement the invalidateFiles callback in this object. */
        invalidateFiles() {},
      }));
      this.setExport("createSyncTransport", ({ token }) => ({
        /** Implement the getState callback in this object. */
        getState: async () => {
          authenticated++;
          if (token !== "a".repeat(64)) {
            const e = Error("bad code");
            e.status = 401;
            throw e;
          }
          return { state: {} };
        },
      }));
    },
    { context },
  );
  for (const module of [settings, engine]) {
    await module.link(() => {});
    await module.evaluate();
  }
  new vm.Script(
    fs.readFileSync(path.join(__dirname, "../dist/sync.js"), "utf8"),
    {
      /** Implement the importModuleDynamically callback in this object. */
      importModuleDynamically: async (specifier) =>
        specifier.includes("settings") ? settings : engine,
    },
  ).runInContext(context);
  await new Promise(setImmediate);
  return {
    w,
    dom,
    /** Implement the saved callback in this object. */
    get saved() {
      return saved;
    },
    /** Implement the runs callback in this object. */
    get runs() {
      return runs;
    },
    /** Implement the authenticated callback in this object. */
    get authenticated() {
      return authenticated;
    },
  };
}
test("first connection asks permission and declining does not upload or authenticate", async () => {
  const h = await syncUI();
  assert.equal(h.w.document.querySelector("#syncdialog").open, true);
  assert.equal(h.runs, 0);
  assert.equal(h.authenticated, 0);
  h.w.document.querySelector("#closesync").click();
  await new Promise(setImmediate);
  assert.equal(h.saved.choice, false);
  assert.equal(h.saved.enabled, false);
  h.dom.window.close();
  const again = await syncUI(h.saved);
  assert.equal(again.w.document.querySelector("#syncdialog").open, false);
  assert.equal(again.runs, 0);
  again.dom.window.close();
});
test("a wrong code does not enable sync; a valid opt-in starts it and reconnect retries", async () => {
  /** Select the first DOM element matching a CSS selector. */
  const h = await syncUI(),
    $ = (s) => h.w.document.querySelector(s);
  $("#synccode").value = "b".repeat(64);
  $("#enablesync").click();
  await new Promise(setImmediate);
  assert.notEqual(h.saved.enabled, true);
  assert.equal(h.runs, 0);
  $("#synccode").value = "a".repeat(64);
  $("#enablesync").click();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(h.saved.enabled, true);
  assert.equal(h.runs, 1);
  assert.equal($("#syncdialog").open, false);
  h.w.navigator.onLine = false;
  h.w.dispatchEvent(new h.w.Event("offline"));
  h.w.dispatchEvent(new h.w.Event("online"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.runs, 1);
  h.w.navigator.onLine = true;
  h.w.dispatchEvent(new h.w.Event("online"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.runs, 2);
  $("#serversync").click();
  $("#disablesync").click();
  await new Promise(setImmediate);
  assert.equal(h.saved.enabled, false);
  assert.equal(h.saved.token, null);
  h.dom.window.close();
});
