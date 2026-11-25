/** @file Authenticated notebook-directory byte accounting, excluding symlinks and exposing no file contents. */
import fs from "node:fs/promises";
import path from "node:path";
/** Cache a directory size scan briefly so opening Dashboard does not repeatedly traverse Git objects. */
export function createStorageReporter(root, displayRoot = root) {
  let last = null,
    inflight = null;
  /** Sum regular-file logical sizes, partitioned by retained Git history, snapshots and original PDFs. */
  async function measure() {
    const categories = { history: 0, snapshots: 0, blobs: 0, other: 0 };
    /** Walk only real directories under the configured root; do not follow symbolic links. */
    async function visit(directory, bucket) {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name),
          group =
            bucket ||
            (Object.hasOwn(categories, entry.name) ? entry.name : "other");
        try {
          const stat = await fs.lstat(file);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) await visit(file, group);
          else if (stat.isFile()) categories[group] += stat.size;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    await visit(path.resolve(root), null);
    return {
      folder: displayRoot,
      bytes: Object.values(categories).reduce((a, b) => a + b, 0),
      categories,
      measuredAt: Date.now(),
    };
  }
  return async () => {
    if (last && Date.now() - last.measuredAt < 15000) return last;
    if (!inflight)
      inflight = measure()
        .then((value) => (last = value))
        .finally(() => (inflight = null));
    return inflight;
  };
}
