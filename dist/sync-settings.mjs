/** @file Durable device pairing, merge ancestors, and receipts; never stores another copy of PDF bytes. */
/** Open the sync metadata store independently from notebook/model data. */
export function createSyncSettings(indexedDB = globalThis.indexedDB) {
  let opened;
  /** Resolve a single IndexedDB request. */
  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  /** Lazily initialize pairing metadata storage. */
  function db() {
    return (
      opened ||
      (opened = new Promise((resolve, reject) => {
        const req = indexedDB.open("leafnote-sync", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("settings");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }))
    );
  }
  /** Read the durable ancestor and pending successful-push receipt. */
  async function load() {
    const database = await db();
    return (
      (await request(
        database.transaction("settings").objectStore("settings").get("device"),
      )) || {}
    );
  }
  /** Atomically merge pairing/status fields without replacing an unrelated pending receipt. */
  async function save(patch) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("settings", "readwrite"),
        store = tx.objectStore("settings"),
        read = store.get("device");
      read.onsuccess = () => store.put({ ...read.result, ...patch }, "device");
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error || Error("Sync settings could not be saved"));
      tx.onerror = () => {};
    });
  }
  return { load, save };
}
