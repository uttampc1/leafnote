/** @file Offline-first sync orchestration with durable ancestors, crash receipts, CAS retries, and PDF integrity checks. */
import {
  emptySnapshot,
  mergeSnapshots,
  noteKey,
  sameSnapshot,
} from "./sync-merge.mjs";
/** Hash a PDF Blob without changing its original bytes. */
export async function blobHash(blob) {
  const bytes = await blob.arrayBuffer(),
    hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** Build the same-origin authenticated transport; bearer codes never enter URLs. */
export function createSyncTransport({
  token,
  fetcher = fetch,
  base = "./api/sync/",
}) {
  const controllers = new Set();
  /** Fetch bounded-duration protocol responses without browser or service-worker caching. */
  async function request(path, options = {}, consume = (response) => response) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 60000);
    controllers.add(controller);
    try {
      const response = await fetcher(
        new URL(
          path,
          new URL(base, globalThis.location?.href || "http://localhost/"),
        ).href,
        {
          ...options,
          signal: controller.signal,
          cache: "no-store",
          headers: { ...options.headers, Authorization: "Bearer " + token },
        },
      );
      if (
        !response.ok &&
        response.status !== 304 &&
        !(options.method === "HEAD" && response.status === 404)
      ) {
        let message = "Sync request failed";
        try {
          message = (await response.json()).error || message;
        } catch {}
        const error = Error(message);
        error.status = response.status;
        throw error;
      }
      return await consume(response);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  return {
    /** Implement the abort callback in this object. */
    abort: () => {
      for (const controller of controllers) controller.abort();
    },
    /** Fetch a snapshot only when its revision differs from the durable ancestor. */
    getState: async (known) => {
      return request(
        "state",
        {
          headers: known
            ? {
                "If-None-Match":
                  '"' + known.workspaceId + ":" + known.revision + '"',
              }
            : {},
        },
        async (response) =>
          response.status === 304
            ? { state: structuredClone(known), unchanged: true }
            : { state: await response.json(), unchanged: false },
      );
    },
    /** Implement the putState callback in this object. */
    putState: async (input) =>
      request(
        "state",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        (response) => response.json(),
      ),
    /** Implement the hasBlob callback in this object. */
    hasBlob: async (hash) =>
      request(
        "blobs/" + hash,
        { method: "HEAD" },
        (response) => response.status === 200,
      ),
    /** Implement the putBlob callback in this object. */
    putBlob: async (hash, blob) => {
      await request(
        "blobs/" + hash,
        {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: blob,
        },
        (response) => response.json(),
      );
    },
    /** Implement the getBlob callback in this object. */
    getBlob: async (hash) =>
      request("blobs/" + hash, {}, (response) => response.blob()),
  };
}
/** Synchronize one device; the application bridge owns local atomic writes and edit guards. */
export function createSyncEngine({
  app,
  storage,
  transport,
  deviceId,
  onStatus = () => {},
}) {
  let stopped = false;
  let running = null,
    lastVersion = null;
  const hashes = new Map();
  /** Stop issuing requests or adopting data after this device disconnects sync. */
  function guard() {
    if (stopped) {
      const error = Error("Sync stopped");
      error.name = "AbortError";
      throw error;
    }
  }
  /** Report state only while this pairing is still active. */
  function report(state) {
    if (!stopped) onStatus(state);
  }
  /** Fence each network operation against a disabled or replaced pairing. */
  async function io(method, ...args) {
    guard();
    const value = await transport[method](...args);
    guard();
    return value;
  }
  /** Retain PDF hashes until an import/restore changes that note’s original file. */
  function invalidateFiles(ids) {
    for (const id of ids || []) hashes.delete(id);
  }
  /** Capture durable local note metadata and hashes, retaining originals for uploads/copies. */
  async function localSnapshot() {
    const captured = await app.read(),
      files = {},
      blobs = new Map();
    for (const note of captured.data.notes.filter((n) => n.pdf)) {
      const version = app.fileVersion?.(note.id) || 0;
      let cached = hashes.get(note.id);
      if (!cached || cached.version !== version) {
        const blob = await app.file(note.id);
        if (!blob) throw Error("An original PDF is missing on this device");
        cached = { version, blob, hash: await blobHash(blob) };
        hashes.set(note.id, cached);
      }
      files[note.id] = cached.hash;
      blobs.set(cached.hash, cached.blob);
    }
    return { ...captured, files, blobs };
  }
  /** Avoid uploading the automatic empty page of a newly paired, otherwise unused device. */
  function removeStarter(local, remote, hasAncestor) {
    if (
      hasAncestor ||
      !remote.data.notes.length ||
      local.data.notes.length !== 1
    )
      return local;
    const n = local.data.notes[0];
    if (
      !n.title &&
      !n.star &&
      !n.pdf &&
      !n.board &&
      !n.strokes.length &&
      !(n.texts || []).some((t) => t.text)
    )
      return { ...local, data: { ...local.data, notes: [] } };
    return local;
  }
  /** Execute one retryable synchronization transaction, retaining local edits on every failure. */
  async function synchronize() {
    guard();
    if (app.busy()) {
      report({
        phase: "queued",
        message: "Sync is queued while you are editing.",
      });
      return false;
    }
    const settings = await storage.load();
    let known = settings.receipt?.result || settings.baseline || null;
    report({ phase: "syncing", message: "Checking the server notebook…" });
    let response = await io("getState", known),
      remote = response.state;
    if (
      response.unchanged &&
      !settings.receipt &&
      lastVersion === app.version()
    ) {
      report({
        phase: "synced",
        message: "Up to date",
        at: settings.lastSyncAt,
      });
      return true;
    }
    if (app.busy()) return false;
    const actual = await localSnapshot();
    let local = { data: actual.data, files: actual.files },
      base =
        settings.baseline?.workspaceId === remote.workspaceId
          ? settings.baseline
          : emptySnapshot();
    if (settings.receipt) {
      local = mergeSnapshots(
        settings.receipt.captured,
        local,
        settings.receipt.result,
        deviceId,
      ).snapshot;
      base =
        settings.receipt.result.workspaceId === remote.workspaceId
          ? settings.receipt.result
          : emptySnapshot();
    }
    local = removeStarter(
      local,
      remote,
      !!settings.baseline || !!settings.receipt,
    );
    let merged,
      committed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (app.version() !== actual.version || app.busy()) return false;
      merged = mergeSnapshots(base, local, remote, deviceId);
      if (sameSnapshot(merged.snapshot, remote)) break;
      report({
        phase: "syncing",
        message: "Saving notes and PDF originals to the server…",
      });
      for (const hash of new Set(Object.values(merged.snapshot.files)))
        if (
          !Object.values(remote.files).includes(hash) &&
          !(await io("hasBlob", hash))
        ) {
          const blob = actual.blobs.get(hash);
          if (!blob)
            throw Error(
              "A required PDF original is unavailable; your notes remain on this device",
            );
          await io("putBlob", hash, blob);
        }
      if (app.version() !== actual.version || app.busy()) return false;
      try {
        remote = await io("putState", {
          workspaceId: remote.workspaceId,
          baseRevision: remote.revision,
          ...merged.snapshot,
        });
        committed = true;
        await storage.save({
          receipt: {
            captured: { data: actual.data, files: actual.files },
            result: remote,
          },
        });
        break;
      } catch (e) {
        if (e.status !== 409 || attempt === 2) throw e;
        response = await io("getState", null);
        remote = response.state;
        base =
          settings.baseline?.workspaceId === remote.workspaceId
            ? settings.baseline
            : emptySnapshot();
        if (settings.receipt?.result.workspaceId === remote.workspaceId)
          base = settings.receipt.result;
      }
    }
    const result = committed
        ? { data: remote.data, files: remote.files }
        : merged.snapshot,
      filesToWrite = [];
    for (const note of result.data.notes.filter((n) => n.pdf)) {
      const hash = result.files[note.id];
      if (actual.files[note.id] === hash) continue;
      let blob = actual.blobs.get(hash);
      if (!blob) {
        report({
          phase: "syncing",
          message: "Receiving PDF originals from the server…",
        });
        blob = await io("getBlob", hash);
        if ((await blobHash(blob)) !== hash)
          throw Error("A downloaded PDF failed its integrity check");
        actual.blobs.set(hash, blob);
      }
      filesToWrite.push([note.id, blob]);
    }
    if (app.version() !== actual.version || app.busy()) {
      report({
        phase: "queued",
        message:
          "New edits are saved on this device; sync will continue shortly.",
      });
      return false;
    }
    guard();
    const currentId = actual.currentId,
      preferred =
        merged.conflicts.find((c) => c.noteId === currentId)?.copyId ||
        currentId;
    const keepUndoIds = result.data.notes
      .filter(
        (n) =>
          noteKey(n, result.files[n.id]) ===
          noteKey(
            actual.data.notes.find((x) => x.id === n.id),
            actual.files[n.id],
          ),
      )
      .map((n) => n.id);
    if (
      !sameSnapshot({ data: actual.data, files: actual.files }, result) ||
      filesToWrite.length
    ) {
      if (
        !(await app.apply(result.data, filesToWrite, actual.version, {
          keepUndoIds,
          preferredId: preferred,
        }))
      ) {
        report({
          phase: "queued",
          message: "Sync is queued until the current edit finishes.",
        });
        return false;
      }
      invalidateFiles(filesToWrite.map(([id]) => id));
    }
    const synchronizedVersion = app.version();
    await storage.save({
      baseline: remote,
      receipt: null,
      lastSyncAt: Date.now(),
    });
    lastVersion = synchronizedVersion;
    report({
      phase: "synced",
      message: merged.conflicts.length
        ? "Synced. Conflicting edits were kept as copies."
        : "Synced with your Linux server",
      conflicts: merged.conflicts,
      at: Date.now(),
    });
    return true;
  }
  /** Coalesce simultaneous local/online/timer triggers into a single sync attempt. */
  function run() {
    if (!running)
      running = synchronize()
        .catch((error) => {
          if (stopped) return false;
          report({
            phase: "error",
            message:
              error.status === 401
                ? "Connection code rejected. Open Server sync to reconnect."
                : error.message ||
                  "Server unavailable; changes remain on this device.",
          });
          throw error;
        })
        .finally(() => {
          running = null;
        });
    return running;
  }
  return {
    run,
    invalidateFiles,
    /** Implement the stop callback in this object. */
    stop: () => {
      stopped = true;
      transport.abort?.();
    },
  };
}
