const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { JSDOM } = require("jsdom");
/** Exercise the real maintenance controls with isolated pairing and observable restore boundaries. */
async function dashboard(paired = true) {
  const html = fs
      .readFileSync(path.join(__dirname, "../dist/index.html"), "utf8")
      .replace(/<script[\s\S]*?<\/script>/g, ""),
    dom = new JSDOM(html, {
      url: "https://localhost/",
      runScripts: "outside-only",
    }),
    w = dom.window,
    context = dom.getInternalVMContext(),
    hash = "a".repeat(40);
  let trash = [
      {
        id: "deleted",
        title: "<img src=x onerror=alert(1)>",
        deleted: true,
        deletedAt: 1,
      },
    ],
    restored = null,
    requests = 0;
  w.$ = (s) => w.document.querySelector(s);
  w.LeafInk = {
    /** Create a filled SVG outline for a complete pressure-aware stroke. */
    outline: () => "",
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  w.LeafnoteApp = {
    ready: true,
    /** Finish active note and board edits before a deliberate layout change. */
    finish() {},
    maintenance: {
      /** Implement the trash callback in this object. */
      trash: () => structuredClone(trash),
      /** Implement the restoreDeleted callback in this object. */
      restoreDeleted: async (id) => {
        trash = trash.filter((n) => n.id !== id);
      },
      /** Implement the restoreRevision callback in this object. */
      restoreRevision: async (note, blob) => {
        restored = { note, blob };
      },
    },
  };
  const snapshot = {
    data: {
      books: [{ id: "personal", name: "Personal" }],
      notes: [
        {
          id: "old",
          book: "personal",
          title: "Earlier note",
          strokes: [],
          texts: [{ x: 10, y: 20, size: 18, text: "Earlier text" }],
        },
      ],
    },
    files: {},
  };
  const modules = {};
  modules["./sync-settings.mjs"] = new vm.SyntheticModule(
    ["createSyncSettings"],
    function () {
      this.setExport("createSyncSettings", () => ({
        /** Implement the load callback in this object. */
        load: async () => ({
          enabled: paired,
          token: paired ? "b".repeat(64) : null,
        }),
      }));
    },
    { context },
  );
  modules["./sync-engine.mjs"] = new vm.SyntheticModule(
    ["createSyncTransport", "blobHash"],
    function () {
      this.setExport("createSyncTransport", () => ({
        /** Implement the history callback in this object. */
        history: async () => {
          requests++;
          return { commits: [{ hash, at: 1, message: "Autosave revision 1" }] };
        },
        /** Implement the revision callback in this object. */
        revision: async () => structuredClone(snapshot),
        /** Implement the abort callback in this object. */
        abort() {},
      }));
      this.setExport("blobHash", async () => null);
    },
    { context },
  );
  for (const module of Object.values(modules)) {
    await module.link(() => {});
    await module.evaluate();
  }
  new vm.Script(
    fs.readFileSync(path.join(__dirname, "../dist/maintenance.js"), "utf8"),
    {
      /** Implement the importModuleDynamically callback in this object. */
      importModuleDynamically: async (s) => modules[s],
    },
  ).runInContext(context);
  return {
    w,
    dom,
    snapshot,
    /** Implement the restored callback in this object. */
    get restored() {
      return restored;
    },
    /** Implement the requests callback in this object. */
    get requests() {
      return requests;
    },
    $: w.$,
  };
}
/** Wait for a dashboard action to settle without fixed long sleeps. */
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Dashboard did not settle");
}
test("Maintenance restores local Trash offline and renders user titles safely", async () => {
  const h = await dashboard(false);
  try {
    h.$("#maintenance").click();
    assert.ok(h.$("#maintenancedialog").open);
    assert.match(h.$("#maintenancelist").textContent, /<img/);
    assert.equal(h.$("#maintenancelist img"), null);
    await h.$("#maintenancelist button").onclick();
    assert.match(h.$("#maintenancelist").textContent, /empty/);
    assert.equal(h.requests, 0);
    h.$("#showhistory").click();
    await until(() =>
      h.$("#maintenancestatus").textContent.includes("Enable Server sync"),
    );
    assert.equal(h.requests, 0);
  } finally {
    h.dom.window.close();
  }
});
test("Maintenance previews a Git revision read-only and restores only the chosen historical note as a copy", async () => {
  const h = await dashboard();
  try {
    h.$("#maintenance").click();
    h.$("#showhistory").click();
    await until(() => h.$("#maintenancelist button"));
    assert.equal(h.restored, null);
    await h.$("#maintenancelist button").onclick();
    assert.match(h.$("#revisionpreview").textContent, /Earlier text/);
    assert.equal(h.restored, null);
    await h.$("#restorerevision").onclick();
    assert.equal(h.restored.note.id, "old");
    assert.equal(h.snapshot.data.notes[0].title, "Earlier note");
    assert.match(h.$("#maintenancestatus").textContent, /new note/);
  } finally {
    h.dom.window.close();
  }
});
