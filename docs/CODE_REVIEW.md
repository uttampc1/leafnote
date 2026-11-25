# Suggested code review

1. **Deployment boundary:** read [DEPLOYMENT.md](DEPLOYMENT.md), `Dockerfile`, `compose.yaml`, and `deploy/Caddyfile`. Confirm the actual host address, trusted HTTPS, local-only CA volumes, and separation between offline IndexedDB and the chosen private sync folder.
2. **Page and loading order:** read `dist/index.html`, then the startup diagram in [ARCHITECTURE.md](ARCHITECTURE.md). The order of classic scripts and readiness listeners is significant.
3. **Data safety first:** inspect `features.js` functions `validStrokes`, `validTexts`, `writeState`, the serialized `persist` override, backup restore, and `finishInput`. Review rejection paths before happy paths.
4. **Drawing and PDF coordinates:** inspect `ink-engine.js` (`widthAt`, `outline`, `hits`, `imagePlacement`) and `features.js` (`coord`, `renderPDF`, `overlayPNG`, export). Stored coordinates must not depend on zoom or crop rotation.
5. **Text and mind maps:** review `beginText`, `setTextStyle`, `commitText`, then `board.js` editing/drag/connection handlers and `board-engine.js` validation. The app styles whole text boxes/cards and preserves plain text.
6. **Recognition integrity:** review `search-engine.js` transcript signatures and Unicode normalization, `search.js` save/retry race guards, and `model-storage.mjs` checksum/install/remove paths. User-reviewed corrections must win over background OCR.
7. **Local models:** inspect `language-catalog.mjs` pinned sizes/digests and local asset URLs. English keeps a pinned runtime URL alias for Transformers’ cache lookup; this alias is served from installed local Blobs, not fetched remotely.
8. **Offline updates:** review `pwa.js`, `sw.js`, and `scripts/build-precache.mjs`. No automatic `skipWaiting` is used. User-triggered updates finish and persist edits first. Cache cleanup is confined to Leafnote shell caches.
9. **Tests:** `npm test` covers the inherited app behaviors plus manifest icons, offline shell reads, cache isolation, update behavior, model aliases/checksums, and the development server. See [VERIFICATION.md](VERIFICATION.md) for browser/container limitations.

Use [FUNCTIONS.md](FUNCTIONS.md) to find every named helper and callback. The JSON index includes the same source locations and facts for programmatic review. Run `npm run docs` after edits; `npm run check:docs` detects stale references.

## Changes from the hosted source snapshot

- Added PWA manifest, generated install icons, shell service worker, and explicit install/update controls.
- Removed the remote Google Fonts import; platform serif/sans-serif fallbacks and bundled Devanagari font keep rendering local.
- Bundled pinned English weights alongside the Marathi model. Both installers read the local server; checksums remain verified.
- Added Docker/Caddy HTTPS packaging, Linux scripts, local developer server, and reproducible test dependencies.
- Formatted maintained source and added function comments/catalogue; vendored libraries remain unformatted and unmodified.
- Preserved the existing app behavior and local data model. The original notebook regression suite is included.

The local Git history separates the imported app snapshot from the packaging/PWA/documentation changes. No remote is configured for this repository.

## Sync review additions (1.1)

Read [SYNC.md](SYNC.md) and inspect `server/sync-server.mjs`, `dist/sync-merge.mjs`, `dist/sync-engine.mjs`, `dist/sync-settings.mjs`, and `dist/sync.js`. Verify opt-in before notebook requests, bearer authentication and same-origin guards, blob hashes, atomic CURRENT publication, CAS rejection, deletion/edit recovery, retry receipts, disconnect cancellation, and the guarded IndexedDB adoption bridge. `features.js` acquires a browser writer lock before opening notebook storage. The sync API is internal to Docker; Caddy is its only published route. Client/server tests cover offline/reconnect and two-device conflicts.

## Revision and recovery review (1.2)

Review `server/git-history.mjs` (fixed CLI arguments, no shell/remote/hooks, Git commit durability), Git-before-publication and startup recovery in `sync-server.mjs`, deleted flags in validation/backup/search/counts, delete/edit conflict recovery in `sync-merge.mjs`, atomic local restoration in `features.js`, and read-only browsing/new-copy restoration in `maintenance.js`. Test coverage includes a failed Git commit, revision reads, protocol fencing, pointer recovery, offline Trash, retained PDFs, synchronized restoration, and user-title HTML escaping.

## Thumbnail library review (1.3)

Review `library-preview.js` for safe DOM rendering and unchanged note data; `library.js` for default/remembered view behavior, existing result navigation, lazy PDF rendering, caching, and import/maintenance access; and `library.css` for desktop/mobile layouts. Integration tests render real PDF backgrounds with annotations and exercise note opening and reload. Preview tests preserve ink opacity, exact safe text, board content/connections, and PDF page coordinates.
