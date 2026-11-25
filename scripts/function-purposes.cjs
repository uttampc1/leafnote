// Human-written descriptions used by the source annotator and review catalogue.
module.exports = {
  $: "Select the first DOM element matching a CSS selector.",
  $$: "Return all matching DOM elements as an array.",
  uid: "Create a random UUID for a note, notebook, or idea card.",
  fresh:
    "Create an empty notebook collection with starter notebook categories.",
  clean: "Sanitize legacy rich HTML to the small supported tag set.",
  walk: "Recursively remove unsupported tags and attributes from a legacy HTML fragment.",
  validate: "Validate imported notebook data before replacing saved state.",
  note: "Resolve the currently open note from its stable ID.",
  book: "Resolve a note’s notebook, falling back to the first available notebook.",
  persist:
    "Queue a snapshot for device storage; report storage errors without discarding the current note.",
  toast: "Display a temporary status message without blocking editing.",
  plain: "Extract text from a legacy HTML note.",
  escapeText: "Escape text before inserting it into generated HTML.",
  renderNav:
    "Refresh notebook navigation, total counts, favorite counts, and notebook choices.",
  renderList:
    "Render the current filtered note list; search.js later replaces this base implementation.",
  redraw: "Refresh the rendered ink, typed text, and board layers.",
  pathFor: "Build an SVG path representing one stored ink stroke.",
  resizePage:
    "Recalculate the note surface dimensions without changing stored coordinates.",
  loadNote:
    "Open a note, update its controls, and refresh its drawing surface.",
  countWords: "Count words in the original rich-text editor.",
  touch:
    "Update a note’s modified time, persist it, and refresh its list preview.",
  createNote: "Create a blank named-later page in the selected notebook.",
  modal:
    "Open the shared confirmation/input dialog and resolve the user’s response.",
  point: "Convert a pointer event to the original canvas coordinates.",
  eraseAt: "Remove strokes intersecting the original eraser cursor.",
  finishStroke:
    "Commit the original pointer stroke and clear its active state.",
  download: "Create a browser download for an exported note, PDF, or backup.",
  size: "Clamp a numeric board property, or substitute its default.",
  valid: "Validate board nodes and connectors and discard invalid references.",
  textLines:
    "Split and wrap stored text into display lines using the container’s width and font size.",
  hit: "Find the topmost idea card containing a board coordinate.",
  api: "Access the active LeafnoteApp bridge supplied by features.js.",
  scale:
    "Read the current board zoom, using the initial scale for a new board.",
  element: "Create an SVG element and apply its attributes.",
  paint: "Render an active ink stroke or board layer into SVG.",
  refresh:
    "Synchronize board tool hints, zoom, selection, and contextual controls.",
  absorbDraft:
    "Recover a plain-text draft positioned inside an otherwise empty idea card.",
  finishEdit:
    "Commit an idea-card editor to the undo history and persistent note data.",
  edit: "Open a positioned plain-text editor for an idea card.",
  ensure:
    "Expand a board near its edges while preserving existing coordinates.",
  coord: "Convert a pointer position into document-space coordinates.",
  zoom: "Change board magnification while retaining the viewport center.",
  textStyleTarget:
    "Capture a stable reference to the currently edited text box or idea card.",
  setTextStyle:
    "Apply validated text styling to the captured target and retain undo history.",
  setTextColor:
    "Apply a text-color-only style change through the shared styling API.",
  setup:
    "Attach this module’s event handlers after the application state is ready.",
  prepareRGBA:
    "Resize an RGBA line image and normalize its RGB channels into the Devanagari model’s tensor layout.",
  decodeCTC:
    "Decode the model’s repeated character/blank predictions into normalized Unicode text.",
  resources:
    "Load the installed Devanagari weights, character table, dictionary, and WASM session once.",
  visualVariant:
    "Generate an original, narrower, or wider rendering for recognition.",
  recognizeDevanagari:
    "Recognize three renderings of a handwritten line and rank their visual readings.",
  clone: "Copy serializable note state before editing, persistence, or export.",
  page: "Resolve the current PDF page, or the current note through the public bridge.",
  strokes: "Return the active page’s stored ink strokes.",
  annotations: "Return the active page’s free-position typed text boxes.",
  textFont: "Map the stored font choice to its browser font family.",
  validTexts: "Validate, clamp, and normalize imported typed-text annotations.",
  plainFromHTML: "Migrate legacy rich HTML into plain text with line breaks.",
  syncPlainText:
    "Keep the compatibility HTML field and word count aligned with typed text boxes.",
  countPaperWords: "Count text-box and idea-card words for the page status.",
  sizeBlank:
    "Size a blank sheet or board from its stored height and current zoom.",
  positionTextEditor:
    "Position and style the active plain-text editor over its saved coordinates.",
  updateText:
    "Save live typing, grow the page if needed, and refresh its display.",
  commitText:
    "Finish a text edit, remove empty drafts, and add a single undoable operation.",
  beginText:
    "Edit a hit text box or create a new free-position plain-text box.",
  request: "Convert an IndexedDB request to a promise.",
  complete:
    "Resolve an IndexedDB transaction only when it commits successfully.",
  openDB:
    "Open the local notebook database and create its state/PDF stores on first use.",
  getFile: "Read an original imported PDF from the local binary store.",
  writeState:
    "Atomically write notebook metadata and optional PDF blobs, pruning only when requested.",
  validStrokes:
    "Validate imported ink, preserving pressure and pencil-grade metadata.",
  textElement:
    "Render a stored plain-text box as safe SVG text and line spans.",
  snapshot:
    "Capture the active page’s ink, text, and optional board for undo/redo.",
  applySnapshot: "Restore an undo snapshot to its original note and PDF page.",
  remember:
    "Append an undo operation, cap history size, and clear redo history.",
  updateInput:
    "Synchronize drawing mode, text controls, and contextual input hints.",
  setTool: "Finish an active edit before selecting another tool.",
  savePreferences: "Persist pointer pressure and device-input preferences.",
  queuePaint:
    "Coalesce repeated pointer samples into one animation-frame paint.",
  erase: "Remove strokes touched by the pressure-aware eraser hit test.",
  addSamples:
    "Append coalesced pointer samples and pressure to the active stroke.",
  finishInput:
    "Commit or cancel an active stroke and finish any text/card editor.",
  pdfLibrary: "Load the bundled PDF.js module and configure its local worker.",
  pdfOptions: "Build local-only PDF.js asset paths and rendering options.",
  pdfBusy: "Mark the PDF surface unavailable while rendering is in progress.",
  updatePageControls:
    "Synchronize PDF navigation buttons and page number inputs.",
  sizePDF:
    "Fit the current PDF page at the chosen zoom without shifting annotation coordinates.",
  renderPDF:
    "Render the selected PDF with ticketing to reject superseded renders.",
  goTo: "Open a validated PDF page after finishing the current edit.",
  changeZoom: "Change PDF magnification and rerender the selected page.",
  overlayPNG: "Rasterize a page’s annotations for the exported PDF overlay.",
  toBase64: "Encode binary PDF bytes for a portable JSON backup.",
  fromBase64: "Decode and validate PDF bytes while restoring a backup.",
  clamp: "Clamp a numeric value between inclusive limits.",
  widthAt:
    "Calculate stroke width from its base width, pressure, and optional pencil variation.",
  edge: "Build the smoothed path edge used in a pressure-aware ink outline.",
  outline: "Create a filled SVG outline for a complete pressure-aware stroke.",
  hits: "Test an eraser point against stroke segments, including width and pressure.",
  sample:
    "Normalize pointer coordinates and pressure into a stored ink sample.",
  imagePlacement:
    "Calculate a PDF overlay placement for crop bounds and page rotation.",
  modelFor: "Look up an approved recognition model by language ID.",
  assetURL: "Resolve a pinned model asset to its bundled local server URL.",
  mb: "Format a byte count for the model-download UI.",
  storage: "Lazily load the language-model storage module.",
  message: "Update the language-model manager’s status text.",
  render: "Render this module’s controls from the current note and UI state.",
  open: "Open a model dialog or note/page through the module’s public entry point.",
  onProgress: "Report verified model installation progress in the manager.",
  install:
    "Download and verify approved model assets before marking a model installed.",
  remove:
    "Remove only the chosen model’s assets while preserving notes and transcripts.",
  dictionaryWords:
    "Read permitted entries from the bundled Marathi spelling dictionary.",
  ctcConfidence:
    "Summarize visual character scores for candidate ranking, not calibrated accuracy.",
  editDistance:
    "Compute the code-point edit distance between two candidate readings.",
  rankReadings:
    "Choose an unambiguous nearby dictionary-backed visual reading and retain alternatives.",
  mobile: "Determine whether the compact mobile library layout is active.",
  chooseSize:
    "Select a text size, adding an option for an imported non-preset value.",
  textPreview:
    "Update typing-color/size/spacing previews and optionally apply them to edited text.",
  closeInk:
    "Dismiss the contextual writing popup and optionally restore tool focus.",
  inkPreview:
    "Refresh pencil/pen controls, stroke preview, tool icon, and visible color indicator.",
  saveWriting:
    "Remember the selected writing instrument, grade, and ink color.",
  save: "Persist layout visibility preferences separately from note content.",
  finish:
    "Finish active note and board edits before a deliberate layout change.",
  resize: "Schedule an editor resize without cancelling active ink samples.",
  showLibrary: "Reveal the note library and leave Focus mode.",
  done: "Wait for a model-store transaction to commit or reject on abort.",
  db: "Lazily open the dedicated language-model IndexedDB database.",
  definition:
    "Validate a requested language ID against the approved model catalogue.",
  key: "Build a model/revision/file storage key.",
  record:
    "Read a model’s installation metadata, or record an undoable public-API edit.",
  asset: "Read an installed model file as a Blob.",
  putAsset: "Commit a verified model Blob to the asset store.",
  markInstalled:
    "Mark a model installed only after all required files are present.",
  verify:
    "Verify a model file’s SHA-256 when its pinned manifest provides a digest.",
  getInstalled:
    "Return an installation only when its revision and all required assets match.",
  legacyAsset: "Read an old Transformers browser-cache asset for migration.",
  adoptLegacyEnglish:
    "Migrate an earlier English model cache unless the user explicitly removed it.",
  requireInstalled:
    "Require an explicitly installed model before starting recognition.",
  responseFor:
    "Serve a stored Blob under a local URL or the recognizer’s pinned runtime alias.",
  storedBytes: "Count the stored bytes for the selected model.",
  close: "Close the model database connection.",
  createModelStore:
    "Construct an isolated, injectable model store for production or tests.",
  showStatus:
    "Report whether installation/offline support is ready on this connection.",
  showUpdate: "Reveal an available app update without interrupting editing.",
  match: "Look up a pinned recognizer asset in installed local model storage.",
  put: "Ignore runtime cache writes because model installation owns its verified storage.",
  progress_callback:
    "Forward model initialization progress to the main thread.",
  getReader:
    "Load the installed English recognizer and its browser/WASM runtime once.",
  norm: "Normalize searchable text while preserving Devanagari vowel and conjunct marks.",
  ink: "Filter out highlighter marks and empty strokes before handwriting indexing.",
  signature:
    "Hash all recognition-relevant ink fields to detect stale handwriting indexes.",
  bounds: "Calculate padded bounds for one stroke.",
  lines:
    "Group strokes and detached marks into text-line regions for recognition.",
  language:
    "Read the page’s selected recognition language, defaulting to English.",
  currentIndex:
    "Return a transcript only if it still matches the ink and required model/index version.",
  add: "Append a searchable text record with optional document bounds.",
  records:
    "Collect titles, typed text, card text, PDF text, and valid handwriting transcripts.",
  search:
    "Match normalized query terms and group results by note and PDF page.",
  validIndex:
    "Validate a restored handwriting transcript and its alternative readings.",
  app: "Access the active application bridge from the search module.",
  status: "Update the search/indexing status message.",
  snippets:
    "Create a short readable result excerpt around the first matching term.",
  mark: "Build safely escaped highlighted text for search results.",
  eligible: "Apply the selected notebook/favorite filter to the note list.",
  workItems:
    "List pages with missing PDF text or outdated handwriting recognition.",
  scheduleIndex:
    "Debounce automatic indexing and avoid retries while review/editing is active.",
  coverage:
    "Summarize searchable content and missing recognition for the current results.",
  setupWorker:
    "Create the recognition worker and bind progress, result, and error messages.",
  recognize:
    "Submit one rasterized line to the worker with timeout and cancellation handling.",
  raster: "Render a grouped ink line as a normalized black-on-white image.",
  indexAll:
    "Index PDF text and unreviewed handwriting while preserving user corrections.",
  keepReviewDraft:
    "Retain unsaved transcript edits for the active note/page/signature.",
  reviewChanged:
    "Refresh transcript save/discard controls and unsaved-edit status.",
  review:
    "Open the current page’s handwriting review while retaining prior drafts.",
  saveReview:
    "Persist reviewed transcript corrections without changing the underlying ink.",
  retryReview:
    "Create a new recognition draft without overwriting the saved transcript.",
  clearHits: "Remove temporary search highlights from the note surface.",
  showHits: "Render result bounds and scroll the matching content into view.",
  assets:
    "Enumerate deterministic app-shell assets while excluding optional model downloads.",
  drawIcon:
    "Draw the first-party notebook/pencil install icon from vector shapes.",
  startServer:
    "Start the dependency-free development server with safe static paths and correct MIME types.",
  workerHarness:
    "Create an isolated in-memory service-worker environment for offline tests.",
  makeApp:
    "Boot the real app against isolated fake storage and native canvas adapters.",
  wait: "Pause a test between observable asynchronous application events.",
  until: "Wait for a required UI condition with a bounded test timeout.",
  check:
    "Assert an integration outcome and report its human-readable description.",
  event:
    "Create a synthetic pointer sample for pressure/input integration tests.",
  main: "Run the full existing notebook, PDF, board, search, formatting, and pencil regression suite.",
};
