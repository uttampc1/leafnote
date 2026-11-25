const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."),
  key = "a".repeat(64);
/** Load the production merge, transport, engine, and filesystem server modules. */
async function modules() {
  return {
    ...(await import(pathToFileURL(root + "/dist/sync-merge.mjs"))),
    ...(await import(pathToFileURL(root + "/dist/sync-engine.mjs"))),
    ...(await import(pathToFileURL(root + "/server/sync-server.mjs"))),
  };
}
/** Create a synthetic note using the same durable fields as the real app. */
function note(id, text = "hello") {
  return {
    id,
    book: "personal",
    title: id,
    html: "",
    paper: "plain",
    star: false,
    created: 1,
    updated: 1,
    strokes: [],
    texts: [
      {
        x: 20,
        y: 30,
        size: 18,
        lineHeight: 1.5,
        width: 600,
        font: "monospace",
        color: "#264c3d",
        text,
      },
    ],
  };
}
/** Create one private notebook snapshot with optional PDF hashes. */
function snap(notes = [], files = {}) {
  return {
    data: {
      books: [{ id: "personal", name: "Personal", color: "#839d70" }],
      notes,
    },
    files,
  };
}
/** Start a real isolated HTTP API and delete only its test-owned temporary directory. */
async function api(t, options = {}) {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "leafnote-sync-test-"),
    ),
    { startSyncServer } = await modules(),
    running = await startSyncServer({
      root: directory,
      key,
      port: 0,
      ...options,
    });
  t.after(async () => {
    await new Promise((resolve) => running.server.close(resolve));
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(directory).startsWith("leafnote-sync-test-"),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    ...running,
    directory,
    base: "http://127.0.0.1:" + running.server.address().port + "/api/sync/",
  };
}
/** Provide durable metadata independently from the browser application state. */
function settings() {
  let state = {};
  return {
    /** Implement the load callback in this object. */
    load: async () => structuredClone(state),
    /** Persist layout visibility preferences separately from note content. */
    save: async (patch) => {
      state = { ...state, ...structuredClone(patch) };
    },
  };
}
/** Simulate an application with explicit local versions and guarded atomic adoption. */
function device(initial) {
  let data = structuredClone(initial),
    version = 0,
    busy = false;
  const files = new Map(),
    generations = new Map();
  return {
    /** Implement the version callback in this object. */
    version: () => version,
    /** Implement the busy callback in this object. */
    busy: () => busy,
    /** Implement the setBusy callback in this object. */
    setBusy: (value) => {
      busy = value;
    },
    /** Implement the read callback in this object. */
    read: async () => ({
      data: structuredClone(data),
      version,
      currentId: data.notes[0]?.id,
    }),
    /** Implement the file callback in this object. */
    file: async (id) => files.get(id),
    /** Implement the fileVersion callback in this object. */
    fileVersion: (id) => generations.get(id) || 0,
    /** Implement the apply callback in this object. */
    apply: async (next, originals, expected) => {
      if (busy || expected !== version) return false;
      data = structuredClone(next);
      for (const [id, blob] of originals) files.set(id, blob);
      version++;
      return true;
    },
    /** Open a positioned plain-text editor for an idea card. */
    edit: (change) => {
      change(data);
      version++;
    },
    /** Implement the putFile callback in this object. */
    putFile: (id, blob) => {
      files.set(id, blob);
      generations.set(id, (generations.get(id) || 0) + 1);
      version++;
    },
    /** Implement the data callback in this object. */
    get data() {
      return structuredClone(data);
    },
  };
}
test("three-way merge combines independent notes and preserves both concurrent edits", async () => {
  const { mergeSnapshots, sameSnapshot } = await modules(),
    base = snap([note("n")]),
    a = structuredClone(base),
    b = structuredClone(base);
  a.data.notes.push(note("a"));
  b.data.notes.push(note("b"));
  assert.equal(
    mergeSnapshots(base, a, b, "device").snapshot.data.notes.length,
    3,
  );
  a.data.notes[0].texts[0].text = "local";
  b.data.notes[0].texts[0].text = "remote";
  const merged = mergeSnapshots(base, a, b, "device");
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(
    new Set(
      merged.snapshot.data.notes
        .filter((n) => n.id === "n" || n.id.startsWith("conflict_"))
        .map((n) => n.texts[0].text),
    ),
    new Set(["local", "remote"]),
  );
  const retried = mergeSnapshots(base, a, merged.snapshot, "device");
  assert.equal(
    retried.snapshot.data.notes.length,
    merged.snapshot.data.notes.length,
  );
  assert.ok(sameSnapshot(retried.snapshot, merged.snapshot));
});
test("delete/edit races recover an edited copy and unchanged deletions remain deleted", async () => {
  const { mergeSnapshots } = await modules(),
    base = snap([note("n")]),
    changed = snap([note("n", "new offline text")]),
    deleted = snap([]);
  for (const [a, b] of [
    [changed, deleted],
    [deleted, changed],
  ]) {
    const merged = mergeSnapshots(base, a, b, "device");
    assert.equal(merged.snapshot.data.notes.length, 1);
    assert.ok(merged.snapshot.data.notes[0].id.startsWith("conflict_"));
    assert.equal(
      merged.snapshot.data.notes[0].texts[0].text,
      "new offline text",
    );
  }
  assert.equal(
    mergeSnapshots(base, base, deleted, "device").snapshot.data.notes.length,
    0,
  );
});
test("automatic OCR and timestamps do not create spurious edit conflicts", async () => {
  const { mergeSnapshots } = await modules(),
    base = snap([note("n")]),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.data.notes[0].updated = 200;
  local.data.notes[0].handwriting = {
    reviewed: false,
    text: "guess",
    signature: "ink",
  };
  remote.data.notes[0].updated = 300;
  const merged = mergeSnapshots(base, local, remote, "device");
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.snapshot.data.notes[0].handwriting.text, "guess");
});
test("API requires a pairing code and rejects cross-origin writes", async (t) => {
  const server = await api(t);
  assert.equal((await fetch(server.base + "config")).status, 200);
  assert.equal((await fetch(server.base + "state")).status, 401);
  assert.equal((await fetch(server.base + "state?token=" + key)).status, 401);
  assert.equal(
    (
      await fetch(server.base + "state", {
        headers: {
          Authorization: "Bearer " + key,
          Origin: "https://unrelated.example",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(server.base + "blobs/%2e%2e%2fworkspace.json", {
        headers: { Authorization: "Bearer " + key },
      })
    ).status,
    404,
  );
});
test("filesystem API serializes compare-and-swap writers, supports ETags, and restarts from CURRENT", async (t) => {
  const server = await api(t),
    { createSyncTransport, createSyncStore } = await modules(),
    transport = createSyncTransport({ token: key, base: server.base }),
    state = (await transport.getState(null)).state,
    input = {
      workspaceId: state.workspaceId,
      baseRevision: 0,
      ...snap([note("n")]),
    },
    responses = await Promise.allSettled([
      transport.putState(input),
      transport.putState(input),
    ]);
  assert.equal(responses.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    responses.find((x) => x.status === "rejected").reason.status,
    409,
  );
  const next = (await transport.getState(null)).state;
  assert.equal(next.revision, 1);
  assert.equal((await transport.getState(next)).unchanged, true);
  const restarted = await createSyncStore({ root: server.directory });
  assert.equal(restarted.state().data.notes[0].title, "n");
  assert.equal(restarted.state().revision, 1);
  const pointer = (
    await fs.readFile(path.join(server.directory, "CURRENT"), "utf8")
  ).trim();
  assert.ok(pointer.endsWith(".json"));
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(server.directory, "snapshots", pointer),
        "utf8",
      ),
    ).revision,
    1,
  );
});
test("API verifies immutable PDF hashes, references, and transfer limits", async (t) => {
  const server = await api(t, { maxPdfBytes: 1024, maxStateBytes: 2048 }),
    { createSyncTransport } = await modules(),
    transport = createSyncTransport({ token: key, base: server.base }),
    pdf = new Blob(["%PDF-1.7\nexample original"]),
    hash = crypto
      .createHash("sha256")
      .update(Buffer.from(await pdf.arrayBuffer()))
      .digest("hex");
  await assert.rejects(
    transport.putBlob("0".repeat(64), pdf),
    (e) => e.status === 422,
  );
  await assert.rejects(
    transport.putBlob(hash, new Blob(["%PDF-" + "x".repeat(2000)])),
    (e) => e.status === 413,
  );
  assert.equal(await transport.hasBlob(hash), false);
  const state = (await transport.getState(null)).state,
    n = note("pdf");
  n.pdf = {
    name: "original.pdf",
    pages: [{ width: 400, height: 600, strokes: [], texts: [] }],
  };
  await assert.rejects(
    transport.putState({
      workspaceId: state.workspaceId,
      baseRevision: 0,
      ...snap([n], { pdf: hash }),
    }),
    (e) => e.status === 422,
  );
  await transport.putBlob(hash, pdf);
  await transport.putBlob(hash, pdf);
  assert.equal(await transport.hasBlob(hash), true);
  await transport.putState({
    workspaceId: state.workspaceId,
    baseRevision: 0,
    ...snap([n], { pdf: hash }),
  });
  assert.deepEqual(
    Buffer.from(await (await transport.getBlob(hash)).arrayBuffer()),
    Buffer.from(await pdf.arrayBuffer()),
  );
  await assert.rejects(
    transport.putState({
      workspaceId: state.workspaceId,
      baseRevision: 1,
      ...snap([note("large", "x".repeat(3000))]),
    }),
    (e) => e.status === 413,
  );
});
test("two real HTTP clients synchronize offline edits and preserve a same-note conflict copy", async (t) => {
  const server = await api(t),
    { createSyncEngine, createSyncTransport } = await modules(),
    a = device(snap([note("n")]).data),
    b = device(snap([{ ...note("starter", ""), title: "", texts: [] }]).data),
    sa = settings(),
    sb = settings();
  let online = true;
  const ta = createSyncTransport({
      token: key,
      base: server.base,
      /** Implement the fetcher callback in this object. */
      fetcher: (...args) => {
        if (!online) throw new TypeError("offline");
        return fetch(...args);
      },
    }),
    tb = createSyncTransport({ token: key, base: server.base }),
    ea = createSyncEngine({
      app: a,
      storage: sa,
      transport: ta,
      deviceId: "a",
    }),
    eb = createSyncEngine({
      app: b,
      storage: sb,
      transport: tb,
      deviceId: "b",
    });
  await ea.run();
  await eb.run();
  assert.deepEqual(
    b.data.notes.map((n) => n.id),
    ["n"],
  );
  online = false;
  a.edit((d) => {
    d.notes[0].texts[0].text = "offline A";
  });
  await assert.rejects(ea.run(), /offline/);
  b.edit((d) => {
    d.notes.push(note("independent"));
  });
  await eb.run();
  online = true;
  await ea.run();
  await eb.run();
  assert.equal(
    b.data.notes.find((n) => n.id === "n").texts[0].text,
    "offline A",
  );
  assert.ok(a.data.notes.some((n) => n.id === "independent"));
  a.edit((d) => {
    d.notes.find((n) => n.id === "n").texts[0].text = "edit A";
  });
  b.edit((d) => {
    d.notes.find((n) => n.id === "n").texts[0].text = "edit B";
  });
  await ea.run();
  await eb.run();
  assert.ok(b.data.notes.some((n) => n.texts[0].text === "edit A"));
  assert.ok(
    b.data.notes.some(
      (n) => n.texts[0].text === "edit B" && n.id.startsWith("conflict_"),
    ),
  );
  const count = b.data.notes.length;
  await eb.run();
  assert.equal(b.data.notes.length, count);
});
test("a new edit made during a successful push is rebased through a durable receipt", async (t) => {
  const server = await api(t),
    { createSyncEngine, createSyncTransport } = await modules(),
    app = device(snap([note("n")]).data),
    storage = settings(),
    transport = createSyncTransport({ token: key, base: server.base });
  let intercept = false;
  const hooked = {
    ...transport,
    /** Implement the putState callback in this object. */
    putState: async (input) => {
      const result = await transport.putState(input);
      if (intercept) {
        intercept = false;
        app.edit((d) => {
          d.notes[0].texts[0].text = "newer while request returned";
        });
      }
      return result;
    },
  };
  const first = createSyncEngine({
    app,
    storage,
    transport: hooked,
    deviceId: "one",
  });
  await first.run();
  app.edit((d) => {
    d.notes[0].texts[0].text = "first pending";
  });
  intercept = true;
  assert.equal(await first.run(), false);
  assert.ok((await storage.load()).receipt);
  const restarted = createSyncEngine({
    app,
    storage,
    transport,
    deviceId: "one",
  });
  await restarted.run();
  assert.equal((await transport.getState(null)).state.data.notes.length, 1);
  assert.equal(
    (await transport.getState(null)).state.data.notes[0].texts[0].text,
    "newer while request returned",
  );
  assert.equal((await storage.load()).receipt, null);
});
test("reconnecting clients transfer original PDF bytes and leave editing sessions undisturbed", async (t) => {
  const server = await api(t),
    { createSyncEngine, createSyncTransport } = await modules(),
    transport = createSyncTransport({ token: key, base: server.base }),
    n = note("pdf");
  n.pdf = {
    name: "original.pdf",
    pages: [{ width: 400, height: 600, strokes: [], texts: [] }],
  };
  const a = device(snap([n]).data),
    b = device(snap([{ ...note("starter", ""), title: "", texts: [] }]).data);
  a.putFile("pdf", new Blob(["%PDF-1.7\nclient original"]));
  const ea = createSyncEngine({
      app: a,
      storage: settings(),
      transport,
      deviceId: "a",
    }),
    eb = createSyncEngine({
      app: b,
      storage: settings(),
      transport,
      deviceId: "b",
    });
  await ea.run();
  b.setBusy(true);
  assert.equal(await eb.run(), false);
  assert.equal(b.data.notes[0].id, "starter");
  b.setBusy(false);
  await eb.run();
  assert.equal(await (await b.file("pdf")).text(), "%PDF-1.7\nclient original");
});
test("a lost push response cannot erase notes and an exact retry does not duplicate them", async (t) => {
  const server = await api(t),
    { createSyncEngine, createSyncTransport } = await modules(),
    app = device(snap([note("n")]).data),
    storage = settings(),
    transport = createSyncTransport({ token: key, base: server.base });
  let lose = true;
  const hooked = {
    ...transport,
    /** Implement the putState callback in this object. */
    putState: async (input) => {
      const result = await transport.putState(input);
      if (lose) {
        lose = false;
        throw new TypeError("reply lost");
      }
      return result;
    },
  };
  const engine = createSyncEngine({
    app,
    storage,
    transport: hooked,
    deviceId: "device",
  });
  await assert.rejects(engine.run(), /reply lost/);
  await engine.run();
  assert.equal(app.data.notes.length, 1);
  assert.equal((await transport.getState(null)).state.data.notes.length, 1);
});
test("PDF conflicts retain the correct original bytes for each annotation version", async (t) => {
  const server = await api(t),
    { createSyncEngine, createSyncTransport } = await modules(),
    transport = createSyncTransport({ token: key, base: server.base }),
    pdf = note("pdf");
  pdf.pdf = {
    name: "original.pdf",
    pages: [{ width: 400, height: 600, strokes: [], texts: [] }],
  };
  const a = device(snap([pdf]).data),
    b = device(snap([{ ...note("starter", ""), title: "", texts: [] }]).data);
  a.putFile("pdf", new Blob(["%PDF-1.7\nfirst original"]));
  const ea = createSyncEngine({
      app: a,
      storage: settings(),
      transport,
      deviceId: "a",
    }),
    eb = createSyncEngine({
      app: b,
      storage: settings(),
      transport,
      deviceId: "b",
    });
  await ea.run();
  await eb.run();
  a.putFile("pdf", new Blob(["%PDF-1.7\nreplacement original"]));
  b.edit((d) => {
    d.notes[0].texts[0].text = "annotation on first original";
  });
  await ea.run();
  await eb.run();
  const copy = b.data.notes.find((n) => n.id.startsWith("conflict_"));
  assert.ok(copy);
  assert.equal(
    await (await b.file("pdf")).text(),
    "%PDF-1.7\nreplacement original",
  );
  assert.equal(
    await (await b.file(copy.id)).text(),
    "%PDF-1.7\nfirst original",
  );
  assert.equal(copy.texts[0].text, "annotation on first original");
});
test("sync settings atomically preserve the receipt when unrelated device preferences change", async () => {
  const { IDBFactory } = require("fake-indexeddb"),
    { createSyncSettings } = await import(
      pathToFileURL(root + "/dist/sync-settings.mjs")
    ),
    storage = createSyncSettings(new IDBFactory());
  await storage.save({
    enabled: true,
    receipt: { captured: snap([note("n")]), result: { revision: 1 } },
  });
  await storage.save({ lastSyncAt: 123 });
  assert.equal((await storage.load()).receipt.result.revision, 1);
  assert.equal((await storage.load()).enabled, true);
});

test("disconnecting aborts a pending sync before it can adopt or upload anything", async () => {
  const { createSyncEngine } = await modules();
  let release,
    aborted = false,
    read = false;
  const pending = new Promise((r) => (release = r)),
    app = {
      /** Implement the busy callback in this object. */
      busy: () => false,
      /** Implement the version callback in this object. */
      version: () => 0,
      /** Implement the read callback in this object. */
      read: async () => {
        read = true;
        return { data: snap().data, version: 0 };
      },
    },
    transport = {
      /** Implement the getState callback in this object. */
      getState: () => pending,
      /** Implement the abort callback in this object. */
      abort: () => {
        aborted = true;
      },
    };
  const engine = createSyncEngine({
      app,
      storage: settings(),
      transport,
      deviceId: "one",
    }),
    running = engine.run();
  await new Promise(setImmediate);
  engine.stop();
  release({
    state: { workspaceId: "w", revision: 0, ...snap() },
    unchanged: false,
  });
  assert.equal(await running, false);
  assert.equal(aborted, true);
  assert.equal(read, false);
});
test("a corrupt CURRENT pointer fails closed without resetting stored notes", async (t) => {
  const server = await api(t),
    { createSyncStore } = await modules(),
    state = server.store.state();
  await server.store.commit({
    workspaceId: state.workspaceId,
    baseRevision: 0,
    ...snap([note("saved")]),
  });
  const pointer = (
    await fs.readFile(path.join(server.directory, "CURRENT"), "utf8")
  ).trim();
  await fs.writeFile(
    path.join(server.directory, "CURRENT"),
    "../not-a-snapshot",
  );
  await assert.rejects(
    createSyncStore({ root: server.directory }),
    /Invalid CURRENT/,
  );
  const stored = JSON.parse(
    await fs.readFile(
      path.join(server.directory, "snapshots", pointer),
      "utf8",
    ),
  );
  assert.equal(stored.data.notes[0].id, "saved");
});
test("retrying a conflict never overwrites an already-edited conflict copy", async () => {
  const { mergeSnapshots, emptySnapshot } = await modules(),
    base = emptySnapshot(),
    local = snap([note("n", "local")]),
    remote = snap([note("n", "remote")]),
    first = mergeSnapshots(base, local, remote, "device").snapshot;
  const oldCopy = first.data.notes.find((n) => n.id.startsWith("conflict_"));
  oldCopy.texts[0].text = "edited copy";
  const next = mergeSnapshots(base, local, first, "device").snapshot;
  assert.deepEqual(
    new Set(next.data.notes.map((n) => n.texts[0].text)),
    new Set(["local", "remote", "edited copy"]),
  );
});

test("an edit during baseline persistence remains pending for the next sync", async (t) => {
  const server = await api(t),
    { createSyncEngine, createSyncTransport } = await modules(),
    app = device(snap([note("n")]).data),
    storage = settings(),
    transport = createSyncTransport({ token: key, base: server.base });
  const save = storage.save.bind(storage);
  let inject = true;
  storage.save = async (patch) => {
    if (inject && patch.baseline) {
      inject = false;
      app.edit((d) => {
        d.notes[0].texts[0].text = "edited while recording baseline";
      });
    }
    return save(patch);
  };
  const engine = createSyncEngine({ app, storage, transport, deviceId: "one" });
  await engine.run();
  await engine.run();
  assert.equal(
    (await transport.getState(null)).state.data.notes[0].texts[0].text,
    "edited while recording baseline",
  );
});
