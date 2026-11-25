/** @file Versioned offline shell caching; intentionally excludes note data and optional model downloads. */
/* Offline app shell only. User notes and installed models stay in IndexedDB. */
importScripts("./precache-manifest.js");
const PREFIX = "leafnote-shell-",
  VERSION = PREFIX + self.LEAFNOTE_PRECACHE.version;
const SCOPE = new URL("./", self.location.href);
const ASSETS = new Set(
  self.LEAFNOTE_PRECACHE.assets.map((p) => new URL(p, SCOPE).href),
);

/** Install a complete shell; a failed download leaves the current worker active. */
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        await cache.addAll([...ASSETS]);
      } catch (error) {
        await caches.delete(VERSION);
        throw error;
      }
    })(),
  ),
);
/** Remove only superseded Leafnote shell caches, preserving model/other caches. */
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((k) => k.startsWith(PREFIX) && k !== VERSION)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  ),
);
/** Activate an update only after the UI has saved edits and requested a reload. */
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
/** Serve versioned shell files offline; optional model files always use the network. */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== SCOPE.origin) return;
  url.search = "";
  url.hash = "";
  if (url.href === SCOPE.href) url.pathname += "index.html";
  if (!ASSETS.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION),
        response = await cache.match(url.href);
      return response || fetch(event.request);
    })(),
  );
});
