# Application flow and data boundaries

## Runtime overview

```mermaid
flowchart LR
  Client[Browser or installed PWA] -->|trusted HTTPS :8443| Caddy[Caddy static server]
  Caddy --> Files[App shell and bundled models]
  Client --> SW[Versioned service-worker shell cache]
  Client --> Notes[(IndexedDB leafnote)]
  Client --> Models[(IndexedDB leafnote-language-models)]
  Client --> Prefs[(localStorage preferences)]
  Client --> Worker[Recognition Web Worker]
  Worker --> Models
  Worker --> WASM[Local ONNX/WASM inference]
  Caddy --> CA[(Server-only CA/config volumes)]
```

Notebook contents never travel to the container. The browser imports local PDFs and exports backups/downloads. Recognition consumes an RGBA line image in a worker on the client. Model source/licence links are informational; model installation fetches bundled files from the LAN server.

## Startup and script order

```mermaid
flowchart TD
  HTML[index.html] --> Engines[Ink, search, board pure engines]
  Engines --> Base[app.js: base state and original handlers]
  Base --> Features[features.js: open IndexedDB; migrate/validate; install active handlers]
  Features --> Ready[leafnote-ready event]
  Ready --> Board[board.js wraps drawing and text behavior]
  Ready --> Search[search.js wraps search/list/persistence behavior]
  Ready --> UI[minimal.js: popups, Pencil defaults and layout]
  HTML --> ModelUI[language-models.js: lazy model manager]
  HTML --> PWA[pwa.js: install and update controls]
  PWA --> SW[sw.js + generated precache manifest]
```

This is a buildless classic-script app with small ESM recognition/storage modules. `app.js` provides shared lexical bindings (`data`, `current`, `tool`, selectors, base functions). `features.js` replaces storage, drawing, export, undo, and note opening. Board and search modules wrap selected functions after readiness. Read the active override in `features.js` when a base function in `app.js` has the same name. This layering is documented rather than silently refactored during packaging.

## Editing, undo, and persistence

```mermaid
flowchart TD
  Input[Pointer or keyboard] --> Mode{Tool / note type}
  Mode --> Ink[Pencil/pen/highlight: coalesced samples and pressure]
  Mode --> Text[Free-position textarea]
  Mode --> Board[Idea editor, card drag, connector]
  Ink --> State[In-memory note/page state]
  Text --> State
  Board --> State
  State --> SVG[SVG rendering, PDF background separate]
  State --> Undo[Before/after snapshot history]
  State --> Queue[Serialized save queue]
  Queue --> IDB[(Notebook state + original PDF blobs)]
  Queue --> Failure[Visible save error; keep current data in memory]
  Undo --> State
```

Coordinates are document-space values, independent of screen zoom. PDF annotations belong to a specific page. Pencil grade and opacity are retained as stroke fields. Formatting is plain text-box/card styling, not arbitrary rich HTML. Changing style preserves text, spacing, and undo history.

## Search and recognition

```mermaid
flowchart TD
  Query[Search query] --> Records[Titles, text boxes, cards, PDF text, valid transcripts]
  Query --> Pending{Missing or stale handwriting index?}
  Pending --> Lines[Group ink into lines; rasterize black on white]
  Lines --> Worker[Recognition worker]
  Worker --> Language{Page language}
  Language --> EN[Installed English TrOCR]
  Language --> MR[Installed Marathi OCR: three renderings + dictionary ranking]
  EN --> Guard[Check note/page, ink signature and review status]
  MR --> Guard
  Guard --> Index[Save automatic transcript and alternatives]
  Index --> Records
  Records --> Results[Grouped matching notes/pages and temporary highlights]
  Review[User-reviewed correction] --> Protected[Preserved against background overwrite]
  Protected --> Records
```

`search-engine.js` is the pure source of search records, normalization, line grouping, and ink signatures. `search.js` owns scheduling and the review UI. A transcript is stale when its recognition-relevant ink changes. Reviewed corrections survive recognizer upgrades. Marathi remains experimental; bundled sample checks are not an accuracy benchmark.

## Installation and updates

```mermaid
sequenceDiagram
  participant UI as App UI
  participant SW as Service worker
  participant Server as Local HTTPS server
  participant DB as Client IndexedDB
  UI->>SW: register
  SW->>Server: fetch complete versioned shell
  SW->>SW: cache all required shell files
  Note over SW: Install fails atomically if a required download fails
  UI->>UI: show offline-ready status
  Server-->>SW: later app version available
  SW->>SW: install new shell; wait
  UI->>DB: finish edit and await save
  DB-->>UI: saved
  UI->>SW: user-approved ACTIVATE_UPDATE
  SW->>SW: activate; remove older Leafnote shell caches only
  SW-->>UI: controller changed; reload saved app
```

The shell cache never stores note content or optional model assets. Models have their own install/remove lifecycle. The update handler refuses to reload if notebook persistence fails. Service-worker activation does not delete IndexedDB or layout preferences.

## Stored shapes

| Store                                 | Main contents                                                            | Owner               |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| `leafnote` / `state` / `notebook`     | notebooks, notes, PDF page metadata, text, ink, boards, transcripts      | `features.js`       |
| `leafnote` / `pdfs`                   | original imported PDF Blob by note ID                                    | `features.js`       |
| `leafnote-language-models` / `assets` | verified model/revision/file Blobs                                       | `model-storage.mjs` |
| `leafnote-language-models` / `models` | installed/removed state, revision, byte count                            | `model-storage.mjs` |
| `leafnote-shell-*` Cache API          | versioned static app runtime                                             | `sw.js`             |
| localStorage `leafnote-*`             | input, layout, writing, and text-style preferences; legacy recovery copy | app UI modules      |
| Docker `caddy_data`, `caddy_config`   | server TLS CA and Caddy metadata                                         | Caddy               |

`Note` includes stable ID, notebook ID, title, timestamps, favorite, paper, strokes and text boxes. PDF notes add page records and an original-file ID. Board notes add dimensions, nodes, and links. A stroke has color, width, opacity, pressure and sampled points; Pencil adds brush/grade. Text boxes and idea cards retain color, size and line height. Undo snapshots are in memory; exported backups carry persistent note/PDF data, not installed model files or shell caches.

No backend API, server-side authentication, note synchronization, collaboration, or cross-device data replication is introduced by containerization.
