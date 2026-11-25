/** @file Authenticated, single-writer sync API with atomic JSON snapshots and immutable PDF blobs. */
import http from "node:http";
import { createGitHistory } from "./git-history.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HASH = /^[a-f0-9]{64}$/,
  ID = /^[A-Za-z0-9_-]{1,100}$/,
  RESERVED = new Set(["__proto__", "prototype", "constructor"]);
/** Attach an HTTP status to an expected protocol failure. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
/** Write a complete file through an exclusive temporary file and atomic rename. */
async function atomicWrite(file, bytes) {
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    if (process.platform !== "win32") {
      const directory = await fs.open(path.dirname(file), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}
/** Read a limited request without retaining bytes beyond the advertised limit. */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let bytes = 0,
      settled = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) {
        settled = true;
        chunks.length = 0;
        reject(new HttpError(413, "Upload is too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    request.on("error", () => {
      if (!settled) {
        settled = true;
        reject(new HttpError(400, "Upload was interrupted"));
      }
    });
  });
}
/** Validate record IDs without using them as filesystem paths. */
function validId(value) {
  return typeof value === "string" && ID.test(value) && !RESERVED.has(value);
}
/** Validate notebook membership and PDF references before accepting a snapshot. */
function validateNotebook(data, files) {
  if (
    !data ||
    !Array.isArray(data.books) ||
    !data.books.length ||
    data.books.length > 1000 ||
    !Array.isArray(data.notes) ||
    data.notes.length > 3000 ||
    !files ||
    typeof files !== "object" ||
    Array.isArray(files)
  )
    throw new HttpError(422, "Invalid notebook snapshot");
  const books = new Set(),
    notes = new Set(),
    pdfs = new Set();
  for (const b of data.books) {
    if (!validId(b.id) || books.has(b.id) || typeof b.name !== "string")
      throw new HttpError(422, "Invalid notebook identifier");
    books.add(b.id);
  }
  for (const n of data.notes) {
    if (
      !validId(n.id) ||
      notes.has(n.id) ||
      !books.has(n.book) ||
      typeof n.title !== "string" ||
      !Array.isArray(n.strokes)
    )
      throw new HttpError(422, "Invalid note record");
    notes.add(n.id);
    if (n.pdf) {
      if (
        !Array.isArray(n.pdf.pages) ||
        !n.pdf.pages.length ||
        n.pdf.pages.length > 1000 ||
        !HASH.test(files[n.id] || "")
      )
        throw new HttpError(422, "PDF original is missing");
      pdfs.add(n.id);
    }
  }
  for (const [id, hash] of Object.entries(files))
    if (!pdfs.has(id) || !HASH.test(hash))
      throw new HttpError(422, "Invalid PDF reference");
  return { books: data.books, notes: data.notes };
}
/** Open an immutable snapshot/PDF store rooted only in the configured server folder. */
export async function createSyncStore({ root, keepSnapshots = 50 }) {
  root = path.resolve(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  for (const dir of ["snapshots", "blobs"])
    await fs.mkdir(path.join(root, dir), { recursive: true, mode: 0o700 });
  let identity;
  try {
    identity = JSON.parse(
      await fs.readFile(path.join(root, "workspace.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    identity = { id: crypto.randomUUID(), schema: 1 };
    await atomicWrite(
      path.join(root, "workspace.json"),
      JSON.stringify(identity),
    );
  }
  const history = await createGitHistory(root),
    tip = await history.head();
  let needsRepair = false;
  let current = {
    schema: 1,
    workspaceId: identity.id,
    revision: 0,
    data: { books: [], notes: [] },
    files: {},
  };
  try {
    const name = (await fs.readFile(path.join(root, "CURRENT"), "utf8")).trim();
    if (!/^\d{16}-[a-f0-9-]+\.json$/.test(name))
      throw Error("Invalid CURRENT snapshot");
    current = JSON.parse(
      await fs.readFile(path.join(root, "snapshots", name), "utf8"),
    );
    if (
      current.workspaceId !== identity.id ||
      !Number.isSafeInteger(current.revision)
    )
      throw Error("Invalid workspace snapshot");
    validateNotebook(current.data, current.files);
  } catch (e) {
    if (tip) {
      current = tip.snapshot;
      needsRepair = true;
    } else {
      if (e.code !== "ENOENT") throw e;
      const pointerExists = await fs.stat(path.join(root, "CURRENT")).then(
        () => true,
        () => false,
      );
      if (pointerExists)
        throw Error(
          "Current snapshot is missing; restore server backup before starting",
        );
    }
  }
  if (tip) {
    const saved = tip.snapshot;
    if (
      saved.workspaceId !== identity.id ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < current.revision
    )
      throw Error(
        "Git history does not match the server notebook; restore a complete backup",
      );
    validateNotebook(saved.data, saved.files);
    if (
      saved.revision === current.revision &&
      JSON.stringify(saved) !== JSON.stringify(current)
    )
      throw Error("Git history and current snapshot disagree");
    if (saved.revision > current.revision || needsRepair) {
      const name =
        String(saved.revision).padStart(16, "0") +
        "-" +
        crypto.randomUUID() +
        ".json";
      await atomicWrite(
        path.join(root, "snapshots", name),
        JSON.stringify(saved),
      );
      await atomicWrite(path.join(root, "CURRENT"), name + "\n");
      current = saved;
    }
  } else if (current.revision > 0) await history.commit(current);
  let queue = Promise.resolve();
  /** Resolve only a verified SHA-256 name inside the immutable PDF directory. */
  function blobPath(hash) {
    if (!HASH.test(hash)) throw new HttpError(400, "Invalid PDF hash");
    return path.join(root, "blobs", hash + ".pdf");
  }
  /** Report whether an immutable PDF original is already on the server. */
  async function hasBlob(hash) {
    try {
      return (await fs.stat(blobPath(hash))).isFile();
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  }
  /** Verify and persist a PDF by content hash; repeat uploads are idempotent. */
  async function putBlob(hash, bytes) {
    const file = blobPath(hash);
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !== hash ||
      !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    )
      throw new HttpError(422, "PDF bytes do not match their content hash");
    if (!(await hasBlob(hash))) await atomicWrite(file, bytes);
  }
  /** Commit against a known revision, serialize writers, and publish CURRENT last. */
  function commit(input) {
    const operation = queue.then(async () => {
      if (!input || typeof input !== "object")
        throw new HttpError(422, "Invalid snapshot");
      if (
        input.workspaceId !== identity.id ||
        input.baseRevision !== current.revision
      )
        throw new HttpError(
          409,
          "Server notebook changed; fetch and merge again",
        );
      // Older clients/imported backups may omit notes. Retain those records as tombstones.
      const incoming = structuredClone(
          validateNotebook(input.data, input.files),
        ),
        files = structuredClone(input.files);
      if (
        incoming &&
        Array.isArray(incoming.notes) &&
        Array.isArray(incoming.books)
      ) {
        const ids = new Set(incoming.notes.map((n) => n.id));
        for (const previous of current.data.notes)
          if (!ids.has(previous.id)) {
            incoming.notes.push({
              ...previous,
              deleted: true,
              deletedAt: previous.deletedAt || Date.now(),
            });
            if (current.files[previous.id])
              files[previous.id] = current.files[previous.id];
            if (!incoming.books.some((b) => b.id === previous.book))
              incoming.books.push(
                current.data.books.find((b) => b.id === previous.book),
              );
          }
      }
      const data = validateNotebook(incoming, files);
      for (const hash of new Set(Object.values(files)))
        if (!(await hasBlob(hash)))
          throw new HttpError(
            422,
            "Upload referenced PDFs before saving notes",
          );
      const next = {
          schema: 1,
          workspaceId: identity.id,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
          data,
          files,
        },
        name =
          String(next.revision).padStart(16, "0") +
          "-" +
          crypto.randomUUID() +
          ".json";
      await atomicWrite(
        path.join(root, "snapshots", name),
        JSON.stringify(next),
      );
      await history.commit(next);
      current = next;
      try {
        await atomicWrite(path.join(root, "CURRENT"), name + "\n");
      } catch {
        /* Git HEAD already durably committed; startup repairs a lagging pointer. */
      }
      try {
        const names = (await fs.readdir(path.join(root, "snapshots")))
          .filter((n) => /^\d{16}-[a-f0-9-]+\.json$/.test(n))
          .sort()
          .reverse();
        for (const old of names.slice(Math.max(2, keepSnapshots)))
          if (old !== name) await fs.unlink(path.join(root, "snapshots", old));
      } catch {
        /* Retention failure must not turn a committed save into a failed response. */
      }
      return structuredClone(next);
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    /** Implement the state callback in this object. */
    state: () => structuredClone(current),
    /** Implement the version callback in this object. */
    version: () => ({ workspaceId: identity.id, revision: current.revision }),
    commit,
    history,
    hasBlob,
    putBlob,
    /** Implement the readBlob callback in this object. */
    readBlob: (hash) => fs.readFile(blobPath(hash)),
  };
}
/** Serve the authenticated sync protocol; only one process may write a storage folder. */
export async function startSyncServer({
  root,
  key,
  host = "127.0.0.1",
  port = 3000,
  maxStateBytes = 64 * 1024 * 1024,
  maxPdfBytes = 25 * 1024 * 1024,
  keepSnapshots = 50,
}) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
    throw Error("A 64-character private connection code is required");
  const secret = Buffer.from(key),
    store = await createSyncStore({ root, keepSnapshots });
  let inFlight = 0;
  const server = http.createServer(async (req, res) => {
    /** Return JSON without caching authenticated notebook responses. */
    function json(status, value) {
      const bytes = Buffer.from(JSON.stringify(value));
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Content-Length": bytes.length,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(bytes);
    }
    let counted = false;
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {
          throw new HttpError(403, "Origin not allowed");
        }
        if (origin.host !== req.headers.host)
          throw new HttpError(403, "Origin not allowed");
      }
      if (url.pathname === "/api/sync/health" && req.method === "GET") {
        json(200, { ok: true });
        return;
      }
      if (url.pathname === "/api/sync/config" && req.method === "GET") {
        json(200, { enabled: true, protocol: 2, requiresKey: true });
        return;
      }
      const supplied = Buffer.from(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      if (
        supplied.length !== secret.length ||
        !crypto.timingSafeEqual(supplied, secret)
      )
        throw new HttpError(401, "Connection code is missing or incorrect");
      if (inFlight >= 4)
        throw new HttpError(503, "Sync server is busy; retry shortly");
      inFlight++;
      counted = true;
      if (url.pathname === "/api/sync/history" && req.method === "GET") {
        const offset = Number(url.searchParams.get("offset") || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
          throw new HttpError(400, "Invalid history offset");
        json(200, { commits: await store.history.list(offset) });
        return;
      }
      const revision = url.pathname.match(
        /^\/api\/sync\/history\/([a-f0-9]{40}|[a-f0-9]{64})$/,
      );
      if (revision && req.method === "GET") {
        try {
          json(200, await store.history.read(revision[1]));
        } catch {
          throw new HttpError(404, "Revision is unavailable");
        }
        return;
      }
      if (url.pathname === "/api/sync/state") {
        if (req.headers["x-leafnote-protocol"] !== "2")
          throw new HttpError(
            426,
            "Update Leafnote and close older app windows before syncing recoverable notes",
          );
        if (req.method === "GET") {
          const version = store.version(),
            etag = '\"' + version.workspaceId + ":" + version.revision + '\"';
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { "Cache-Control": "no-store", ETag: etag });
            res.end();
            return;
          }
          res.setHeader("ETag", etag);
          json(200, store.state());
          return;
        }
        if (req.method === "PUT") {
          let input;
          try {
            input = JSON.parse(
              (await readBody(req, maxStateBytes)).toString("utf8"),
            );
          } catch (e) {
            if (e.status) throw e;
            throw new HttpError(400, "Invalid JSON");
          }
          json(200, await store.commit(input));
          return;
        }
      }
      const match = url.pathname.match(/^\/api\/sync\/blobs\/([a-f0-9]{64})$/);
      if (match) {
        const hash = match[1];
        if (req.method === "HEAD") {
          res.writeHead((await store.hasBlob(hash)) ? 200 : 404, {
            "Cache-Control": "no-store",
          });
          res.end();
          return;
        }
        if (req.method === "GET") {
          const bytes = await store.readBlob(hash);
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Cache-Control": "no-store",
            "Content-Length": bytes.length,
            "X-Content-Type-Options": "nosniff",
          });
          res.end(bytes);
          return;
        }
        if (req.method === "PUT") {
          await store.putBlob(hash, await readBody(req, maxPdfBytes));
          json(200, { hash });
          return;
        }
      }
      throw new HttpError(404, "Unknown sync endpoint");
    } catch (e) {
      if (!res.headersSent)
        json(
          e.status ||
            (e.code === "ENOENT" ? 404 : e.code === "ENOSPC" ? 507 : 500),
          {
            error: e.status
              ? e.message
              : e.code === "ENOSPC"
                ? "Server storage is full"
                : "Sync request could not be completed",
          },
        );
      else res.end();
    } finally {
      if (counted) inFlight--;
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, store }));
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = process.env.LEAFNOTE_SYNC_ROOT || "/sync",
    key = (await fs.readFile(path.join(root, "auth.key"), "utf8")).trim();
  await startSyncServer({
    root,
    key,
    host: "0.0.0.0",
    port: Number(process.env.PORT || 3000),
  });
  console.log(
    "Leafnote sync API ready. Connection codes are never written to logs.",
  );
}
