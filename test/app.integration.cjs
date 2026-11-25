const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const { JSDOM } = require("jsdom"),
  { indexedDB, IDBKeyRange } = require("fake-indexeddb"),
  native = require("@napi-rs/canvas");
const root = path.resolve(__dirname, "../dist");
const Ink = require(root + "/ink-engine.js"),
  PDFLib = require(root + "/vendor/pdf-lib.min.js"),
  Search = require(root + "/search-engine.js");
global.DOMMatrix = native.DOMMatrix;
global.ImageData = native.ImageData;
global.Path2D = native.Path2D;
/** Pause a test between observable asynchronous application events. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait for a required UI condition with a bounded test timeout. */
async function until(test, message) {
  for (let i = 0; i < 200; i++) {
    if (await test()) return;
    await wait(25);
  }
  throw Error("Timed out: " + message);
}
let checks = 0;
/** Assert an integration outcome and report its human-readable description. */
function check(test, message) {
  assert.ok(test, message);
  checks++;
  console.log("PASS " + message);
}
/** Boot the real app against isolated fake storage and native canvas adapters. */
async function makeApp(
  legacy,
  layout,
  textColor,
  textFormat,
  writing,
  writerLock,
  expectBlocked = false,
  libraryView,
  pagePositions,
) {
  const html = fs
    .readFileSync(root + "/index.html", "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "http://localhost:4173/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    ctx = dom.getInternalVMContext();
  if (writerLock)
    Object.defineProperty(w.navigator, "locks", { value: writerLock });
  w.indexedDB = indexedDB;
  w.IDBKeyRange = IDBKeyRange;
  w.structuredClone = structuredClone;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.Blob = Blob;
  w.File = File;
  w.devicePixelRatio = 1;
  w.requestAnimationFrame = (fn) => setTimeout(fn, 1);
  w.cancelAnimationFrame = clearTimeout;
  w.document.querySelector("#surface").getBoundingClientRect = () => ({
    width: 600,
    height: 800,
    left: 0,
    top: 0,
  });
  const objects = new Map();
  let seq = 0;
  w.URL.createObjectURL = (b) => {
    const id = "blob:qa/" + seq++;
    objects.set(id, b);
    return id;
  };
  w.URL.revokeObjectURL = (id) => objects.delete(id);
  w.Image = class {
    async decode() {
      const b = objects.get(this.src);
      this.image = await native.loadImage(Buffer.from(await b.arrayBuffer()));
    }
  };
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (
      !this._native ||
      this._native.width !== this.width ||
      this._native.height !== this.height
    )
      this._native = native.createCanvas(this.width || 300, this.height || 150);
    const c = this._native.getContext("2d");
    if (!c._wrapped) {
      const draw = c.drawImage.bind(c);
      c.drawImage = (im, ...args) => draw(im.image || im, ...args);
      c._wrapped = true;
    }
    return c;
  };
  w.HTMLCanvasElement.prototype.toBlob = function (callback) {
    const b = this._native.toBuffer("image/png");
    callback(new Blob([b], { type: "image/png" }));
  };
  Object.defineProperty(w.SVGElement.prototype, "viewBox", {
    /** Implement the get callback in this object. */
    get() {
      const v = (this.getAttribute("viewBox") || "0 0 800 1050")
        .split(/\s+/)
        .map(Number);
      return { baseVal: { x: v[0], y: v[1], width: v[2], height: v[3] } };
    },
  });
  w.SVGElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 1050,
  });
  w.SVGElement.prototype.setPointerCapture = function (id) {
    this._capture = id;
  };
  w.SVGElement.prototype.hasPointerCapture = function (id) {
    return this._capture === id;
  };
  w.SVGElement.prototype.releasePointerCapture = function () {
    this._capture = null;
  };
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    /** Implement the get callback in this object. */
    get() {
      return this.textContent;
    },
    /** Implement the set callback in this object. */
    set(v) {
      this.textContent = v;
    },
  });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function (value) {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  const lib = await import(
    "file:///" + root.replace(/\\/g, "/") + "/vendor/pdf.mjs"
  );
  lib.GlobalWorkerOptions.workerSrc =
    "file:///" + root.replace(/\\/g, "/") + "/vendor/pdf.worker.mjs";
  const mockModule = new vm.SyntheticModule(
    ["GlobalWorkerOptions", "getDocument"],
    function () {
      this.setExport("GlobalWorkerOptions", {});
      this.setExport("getDocument", (options) => {
        const task = lib.getDocument({
          ...options,
          standardFontDataUrl: root + "/vendor/standard_fonts/",
          cMapUrl: root + "/vendor/cmaps/",
          wasmUrl: root + "/vendor/wasm/",
          iccUrl: root + "/vendor/iccs/",
        });
        return task;
      });
    },
    { context: ctx },
  );
  await mockModule.link(() => {});
  await mockModule.evaluate();
  const catalogue = (
      await import(
        "file:///" + root.replace(/\\/g, "/") + "/language-catalog.mjs"
      )
    ).languageModels,
    installed = new Set();
  const fakeModelStore = {
    /** Migrate an earlier English model cache unless the user explicitly removed it. */
    adoptLegacyEnglish: async () => false,
    /** Return an installation only when its revision and all required assets match. */
    getInstalled: async (id) =>
      installed.has(id) ? { installed: true } : null,
    /** Count the stored bytes for the selected model. */
    storedBytes: async (id) => (installed.has(id) ? 100 : 0),
    /** Download and verify approved model assets before marking a model installed. */
    install: async (id, { onProgress }) => {
      onProgress({ file: "weights", loaded: 100, total: 100 });
      installed.add(id);
    },
    /** Remove only the chosen model’s assets while preserving notes and transcripts. */
    remove: async (id) => installed.delete(id),
  };
  const modelModule = new vm.SyntheticModule(
    ["languageModels", "modelStore"],
    function () {
      this.setExport("languageModels", catalogue);
      this.setExport("modelStore", fakeModelStore);
    },
    { context: ctx },
  );
  await modelModule.link(() => {});
  await modelModule.evaluate();
  if (libraryView)
    w.localStorage.setItem("leafnote-library-view-v1", libraryView);
  if (pagePositions)
    w.localStorage.setItem("leafnote-page-positions-v1", pagePositions);
  if (legacy) w.localStorage.setItem("leafnote-v1", JSON.stringify(legacy));
  if (layout)
    w.localStorage.setItem("leafnote-layout-v1", JSON.stringify(layout));
  if (textColor) w.localStorage.setItem("leafnote-text-color", textColor);
  if (textFormat) w.localStorage.setItem("leafnote-text-format", textFormat);
  if (writing) w.localStorage.setItem("leafnote-writing", writing);
  for (const file of [
    "vendor/pdf-lib.min.js",
    "ink-engine.js",
    "search-engine.js",
    "board-engine.js",
    "app.js",
    "paper-engine.js",
    "features.js",
    "board.js",
    "search.js",
    "language-models.js",
    "minimal.js",
    "pwa.js",
    "maintenance.js",
    "dashboard.js",
    "library-preview.js",
    "library.js",
    "document-pages.js",
  ]) {
    new vm.Script(fs.readFileSync(root + "/" + file, "utf8"), {
      filename: file,
      /** Implement the importModuleDynamically callback in this object. */
      importModuleDynamically: async (specifier) =>
        specifier.includes("model-storage") ? modelModule : mockModule,
    }).runInContext(ctx);
  }
  if (expectBlocked)
    await until(
      () =>
        w.document
          .querySelector("#loading")
          ?.textContent.includes("already open"),
      "blocked second writer",
    );
  else await until(() => !w.document.querySelector("#loading"), "app startup");
  /** Evaluate an inline callback in test/app.integration.cjs; its direct operations are listed below. */
  const evaluate = (code) => vm.runInContext(code, ctx);
  return { w, dom, evaluate, objects, lib };
}
/** Create a synthetic pointer sample for pressure/input integration tests. */
function event(w, id, x, y, type = "pen", extra = {}) {
  return {
    pointerId: id,
    clientX: x,
    clientY: y,
    pointerType: type,
    pressure: 0.5,
    button: 0,
    buttons: 1,
    /** Implement the preventDefault callback in this object. */
    preventDefault() {},
    ...extra,
  };
}
/** Run the full existing notebook, PDF, board, search, formatting, and pencil regression suite. */
async function main() {
  check(
    Search.norm("  RÉSUMÉ   Ideas ") === "resume ideas",
    "search ignores case, accents, and repeated whitespace",
  );
  const lineInk = [
    {
      width: 2,
      opacity: 1,
      points: [
        [10, 10],
        [20, 30],
      ],
    },
    {
      width: 2,
      opacity: 1,
      points: [
        [30, 11],
        [40, 31],
      ],
    },
    {
      width: 2,
      opacity: 1,
      points: [
        [10, 80],
        [20, 100],
      ],
    },
  ];
  check(
    Search.lines(lineInk).length === 2,
    "handwriting is segmented into separate text lines",
  );
  const dottedInk = [
    {
      width: 2,
      opacity: 1,
      points: [
        [20, 8],
        [21, 9],
      ],
    },
    {
      width: 2,
      opacity: 1,
      points: [
        [20, 30],
        [20, 65],
      ],
    },
    {
      width: 2,
      opacity: 1,
      points: [
        [35, 31],
        [45, 65],
      ],
    },
  ];
  check(
    Search.lines(dottedInk).length === 1,
    "a detached dot is kept with its handwriting line",
  );
  check(
    Search.signature(lineInk) ===
      Search.signature([
        ...lineInk,
        {
          opacity: 0.3,
          width: 20,
          points: [
            [0, 0],
            [90, 0],
          ],
        },
      ]),
    "highlighter marks do not invalidate handwriting recognition",
  );
  check(
    Ink.widthAt({ width: 4, pressure: true }, [0, 0, 0.9]) >
      Ink.widthAt({ width: 4, pressure: true }, [0, 0, 0.1]),
    "ink width responds to pen pressure",
  );
  check(
    Ink.hits(
      {
        width: 3,
        points: [
          [0, 0],
          [100, 0],
        ],
      },
      [50, 2],
    ),
    "eraser hits between sampled points",
  );
  check(
    !Ink.hits(
      {
        width: 3,
        points: [
          [0, 0],
          [100, 0],
        ],
      },
      [50, 40],
    ),
    "eraser preserves distant strokes",
  );
  for (const r of [0, 90, 180, 270]) {
    const p = Ink.imagePlacement({ x: 20, y: 30, width: 400, height: 600 }, r);
    check(
      p.rotation === r && p.width === (r % 180 ? 600 : 400),
      "export placement handles crop origin and " + r + " degree rotation",
    );
  }
  const legacy = {
    books: [{ id: "old", name: "Existing notebook", color: "#839d70" }],
    notes: [
      {
        id: "legacy-note",
        book: "old",
        title: "Keep this",
        html: "<p>Existing work</p>",
        paper: "lined",
        strokes: [
          {
            color: "#264c3d",
            width: 3,
            opacity: 1,
            points: [
              [1, 2],
              [3, 4],
            ],
          },
        ],
        created: 1,
        updated: 2,
      },
    ],
  };
  const app = await makeApp(legacy),
    { w, evaluate: ev } = app;
  /** Select the first DOM element matching a CSS selector. */
  const $ = (s) => w.document.querySelector(s),
    c = $("#canvas");
  check(
    $(".app").classList.contains("library-home") &&
      $("#viewgrid").getAttribute("aria-pressed") === "true",
    "large thumbnail library is the default starting view",
  );
  await until(() => $("#notes .note-thumbnail svg"), "initial thumbnails");
  check(
    !!$("#notes .note-thumbnail svg"),
    "library cards render actual page previews",
  );
  $("#continuewriting").click();
  check(
    $(".app").classList.contains("library-hidden") &&
      !$("#searchoptions").open &&
      !$("#notemenu").open &&
      !$("#toolsettings").open,
    "minimal view starts with the library and optional controls tucked away",
  );
  check(
    $(".topbar").contains($(".toolbar")) && !w.document.querySelector("aside"),
    "writing tools share one top strip without a separate navigation column",
  );
  $("#mobile").click();
  check(
    !$(".app").classList.contains("library-hidden") &&
      $("#mobile").getAttribute("aria-expanded") === "true",
    "Notes reveals the library and its search field",
  );
  $("#continuewriting").click();
  $("#notemenu summary").click();
  check(
    $("#notemenu").open &&
      $("#notemenu").contains($("#importpdf")) &&
      $("#notemenu").contains($("#reviewhandwriting")) &&
      $("#notemenu").contains($("#newboard")),
    "More provides PDF import, handwriting review, and a new brainstorming board",
  );
  $("#toolsettings summary").click();
  check(
    $("#toolsettings").open &&
      !$("#notemenu").open &&
      $("#toolsettings").contains($("#pressure")) &&
      $("#inkoptions").contains($("#textsize")) &&
      $("#inkoptions").contains($("#textspacing")),
    "Type owns text formatting while Settings retains stylus options",
  );
  w.document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  check(!$("#toolsettings").open, "Escape closes writing settings");
  $("#focusmode").click();
  check(
    $(".app").classList.contains("focus-mode") &&
      $("#focusmode").getAttribute("aria-pressed") === "true",
    "Focus hides the library and reports its selected state",
  );
  w.document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
  );
  check(
    !$(".app").classList.contains("focus-mode") &&
      !$(".app").classList.contains("library-hidden") &&
      w.document.activeElement === $("#search"),
    "Ctrl+K leaves Focus and reveals and focuses search",
  );
  $("#continuewriting").click();
  $("#reviewhandwriting").click();
  await until(
    () => $(".canvas-row").classList.contains("review-open"),
    "review side panel opens",
  );
  check(
    $(".canvas-row").contains($("#recognitionreview")) &&
      $(".canvas-row").contains($(".workspace")),
    "handwriting review shares the canvas row as an optional side panel",
  );
  $("#cancelreview").click();
  await until(
    () => !$(".canvas-row").classList.contains("review-open"),
    "review side panel closes",
  );
  check(
    $("#recognitionreview").hidden,
    "closing handwriting review restores the unobstructed page",
  );
  const inkBeforeLayout = JSON.stringify(ev("note().strokes"));
  w.innerWidth = 390;
  w.dispatchEvent(new w.Event("resize"));
  $(".app").classList.remove("showlist");
  $("#mobile").click();
  check(
    $(".app").classList.contains("showlist") &&
      $("#mobile").getAttribute("aria-expanded") === "true",
    "Notes opens the thumbnail overview on a small screen",
  );
  $("#continuewriting").click();
  check(
    !$(".app").classList.contains("showlist") &&
      JSON.stringify(ev("note().strokes")) === inkBeforeLayout,
    "dismissing the mobile library leaves note ink unchanged",
  );
  w.innerWidth = 1024;
  w.dispatchEvent(new w.Event("resize"));
  check(
    ev("note().title") === "Keep this" && ev("note().strokes.length") === 1,
    "existing notes and ink migrate without loss",
  );
  check(
    ev('document.querySelector("#saved").textContent') === "Saved on device",
    "migration completes before showing saved status",
  );
  check(
    ev("note().texts[0].text") === "Existing work",
    "existing note text migrates to plain text on paper",
  );
  ev("createNote()");
  check(
    ev("note().paper") === "lined" &&
      ev("note().texts.length") === 0 &&
      ev("note().html") === "",
    "new note opens as an empty lined sheet",
  );
  check(
    ev("tool") === "pen" &&
      $("#writingkind").value === "pencil" &&
      $("#pencilgrade").value === "HB",
    "first use starts with Pencil and the HB grade",
  );
  const pencilSampleId = ev("current"),
    pencilSamples = [];
  for (const [i, grade] of ["H", "HB", "1B", "2B"].entries()) {
    $("#pencilgrade").value = grade;
    $("#pencilgrade").dispatchEvent(new w.Event("change", { bubbles: true }));
    await c.onpointerdown(event(w, 450 + i, 35, 500 + i * 40, "mouse"));
    c.onpointermove(event(w, 450 + i, 95, 510 + i * 40, "mouse"));
    c.onpointerup(event(w, 450 + i, 95, 510 + i * 40, "mouse"));
    pencilSamples.push(ev("structuredClone(note().strokes.at(-1))"));
  }
  check(
    pencilSamples.every(
      (stroke, i) =>
        stroke.brush === "pencil" &&
        stroke.grade === ["H", "HB", "1B", "2B"][i],
    ) &&
      pencilSamples[0].width < pencilSamples[3].width &&
      pencilSamples[0].opacity < pencilSamples[3].opacity,
    "pencil grades produce distinct weights and darkness",
  );
  $("#undo").click();
  check(
    ev("note().strokes.at(-1).grade") === "1B",
    "undo removes the last pencil stroke",
  );
  $("#redo").click();
  check(
    ev("note().strokes.at(-1).grade") === "2B",
    "redo restores the pencil grade and appearance",
  );
  check(
    ev("LeafSearch.lines(note().strokes).length") === 4,
    "pencil strokes remain available to handwriting recognition",
  );
  $("#writingkind").value = "pen";
  $("#writingkind").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#color").value = "#264c3d";
  const penButton = $('[data-tool="pen"]'),
    initialColor = $("#color").value,
    initialWidth = $("#width").value;
  penButton.click();
  check(
    !$("#inkoptions").hidden &&
      $("#inkoptions").contains($("#color")) &&
      $("#inkoptions").contains($("#width")) &&
      ev("tool") === "pen",
    "clicking Pen selects it and opens color and thickness beside the tool",
  );
  $("#color").value = "#2463eb";
  $("#color").dispatchEvent(new w.Event("input", { bubbles: true }));
  $("#width").value = "9";
  $("#width").dispatchEvent(new w.Event("change", { bubbles: true }));
  check(
    !$("#inkoptions").hidden && $("#inkpreview").style.borderTopWidth === "9px",
    "changing pen controls keeps the popup open and updates its stroke preview",
  );
  w.document.body.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  check(
    $("#inkoptions").hidden && ev("tool") === "pen",
    "tapping outside closes pen options while keeping the pen selected",
  );
  await c.onpointerdown(event(w, 390, 300, 300, "mouse"));
  c.onpointermove(event(w, 390, 330, 320, "mouse"));
  c.onpointerup(event(w, 390, 330, 320, "mouse"));
  check(
    ev("note().strokes.at(-1).color") === "#2463eb" &&
      ev("note().strokes.at(-1).width") === 9,
    "new ink uses the color and thickness chosen in the Pen popup",
  );
  $("#undo").click();
  $("#color").value = initialColor;
  $("#width").value = initialWidth;
  penButton.click();
  w.document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  check(
    $("#inkoptions").hidden &&
      w.document.activeElement === penButton &&
      penButton.getAttribute("aria-expanded") === "false",
    "Escape closes pen options and returns focus to the pen",
  );
  penButton.click();
  penButton.click();
  check(
    $("#inkoptions").hidden,
    "clicking an already-open Pen button toggles its options closed",
  );
  $('[data-tool="highlighter"]').click();
  check(
    !$("#inkoptions").hidden &&
      $("#inkoptionstitle").textContent === "Highlighter",
    "the highlighter also exposes its ink settings",
  );
  $('[data-tool="text"]').click();
  check(
    !$("#inkoptions").hidden && $("#inkoptions").dataset.mode === "text",
    "switching to Type shows text color instead of pen options",
  );
  check(
    !$("#sheet").querySelector("input,select,form"),
    "note title and notebook controls sit outside the paper",
  );
  $('[data-tool="text"]').click();
  await c.onpointerdown(event(w, 30, 100, 160, "mouse"));
  let field = $("#papertext");
  check(
    !!field && !$("#modal").open,
    "clicking blank paper starts inline typing without a dialog",
  );
  field.value = "one  two\n    three";
  field.oninput();
  field.setSelectionRange(field.value.length, field.value.length);
  field.onkeydown({
    key: "Tab" /** Implement the preventDefault callback in this object. */,
    /** Implement the preventDefault callback in this object. */
    preventDefault() {} /** Implement the stopPropagation callback in this object. */,
    /** Implement the stopPropagation callback in this object. */
    stopPropagation() {},
  });
  check(
    field.value === "one  two\n    three    ",
    "plain text preserves spaces, newlines, and tab indentation",
  );
  field.onblur();
  check(
    ev("note().texts[0].text") === "one  two\n    three    ",
    "free-position text saves without formatting",
  );
  await c.onpointerdown(event(w, 31, 100, 170, "mouse"));
  field = $("#papertext");
  check(
    field.value.includes("one  two") && ev("note().texts.length") === 1,
    "clicking existing text edits it in place",
  );
  field.onblur();
  $("#undo").click();
  check(
    ev("note().texts.length") === 0,
    "undo removes a completed plain-text edit",
  );
  $("#redo").click();
  check(
    ev("note().texts.length") === 1,
    "redo restores plain text and spacing",
  );
  ev("download=(body,name,type)=>{window.__plainExport={body,name,type}}");
  await $("#export").onclick();
  const plainExport = new JSDOM(w.__plainExport.body);
  check(
    plainExport.window.document.querySelector("svg text").textContent ===
      "one  two    three    " &&
      plainExport.window.document.querySelectorAll("svg tspan").length === 2,
    "plain note export retains indentation and separate lines",
  );
  plainExport.window.close();
  const plainId = ev("current");
  ev('filter="learning"');
  $("#search").value = "THREE";
  $("#search").oninput();
  check(
    !!$('#notes [data-result-id="' + plainId + '"]'),
    "global search finds typed text outside the selected notebook",
  );
  $('#notes [data-result-id="' + plainId + '"]').click();
  await until(
    () => ev("current") === plainId && !!$("#searchoverlay"),
    "typed search result",
  );
  check(
    !!$("#searchoverlay rect"),
    "search opens the matching note and highlights its text",
  );
  $("#clearsearch").click();
  const initialTextColor = $("#textcolor").value,
    penColorBeforeText = $("#color").value;
  await c.onpointerdown(event(w, 401, 100, 170, "mouse"));
  const unchangedTypedText = $("#papertext").value,
    typeButton = $('[data-tool="text"]');
  typeButton.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  typeButton.focus();
  typeButton.click();
  $("#textcolor").value = "#d13f3f";
  $("#textcolor").dispatchEvent(new w.Event("input", { bubbles: true }));
  check(
    ev("note().texts[0].color") === "#d13f3f" &&
      ev("note().texts[0].text") === unchangedTypedText,
    "Type color recolors the edited text box without changing text or indentation",
  );
  check(
    $("#color").value === penColorBeforeText,
    "typed text color is independent of pen color",
  );
  $("#undo").click();
  check(
    ev("note().texts[0].color") === initialTextColor,
    "undo restores the previous typed-text color",
  );
  $("#redo").click();
  check(
    ev("note().texts[0].color") === "#d13f3f",
    "redo restores a typed-text color change",
  );
  await c.onpointerdown(event(w, 403, 100, 170, "mouse"));
  typeButton.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  typeButton.focus();
  typeButton.click();
  $("#textsize").value = "24";
  $("#textsize").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#textspacing").value = "2";
  $("#textspacing").dispatchEvent(new w.Event("change", { bubbles: true }));
  check(
    ev("note().texts[0].size") === 24 &&
      ev("note().texts[0].lineHeight") === 2 &&
      ev("note().texts[0].text") === unchangedTypedText,
    "Type popup resizes and spaces existing text without altering words or indentation",
  );
  const formattedSpans = c.querySelectorAll("text tspan");
  check(
    c.querySelector("text").getAttribute("font-size") === "24" &&
      Number(formattedSpans[1].getAttribute("y")) -
        Number(formattedSpans[0].getAttribute("y")) ===
        48,
    "displayed text uses the selected font size and double spacing",
  );
  $("#undo").click();
  check(
    ev("note().texts[0].lineHeight") === 1.5 &&
      ev("note().texts[0].size") === 24,
    "undo restores line spacing independently of text size",
  );
  $("#undo").click();
  $("#redo").click();
  $("#redo").click();
  check(
    ev("note().texts[0].size") === 24 && ev("note().texts[0].lineHeight") === 2,
    "redo restores text size and line spacing",
  );
  await c.onpointerdown(event(w, 402, 500, 400, "mouse"));
  field = $("#papertext");
  field.value = "Color sample";
  field.oninput();
  field.onblur();
  check(
    ev("note().texts.at(-1).color") === "#d13f3f",
    "new plain-text boxes use the selected text color",
  );
  check(
    ev("note().texts.at(-1).size") === 24 &&
      ev("note().texts.at(-1).lineHeight") === 2,
    "new text boxes inherit the selected size and spacing",
  );
  $('[data-tool="pen"]').click();
  typeButton.click();
  $("#textcolor").value = initialTextColor;
  $("#textcolor").dispatchEvent(new w.Event("input", { bubbles: true }));
  $("#textsize").value = "18";
  $("#textsize").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#textspacing").value = "1.5";
  $("#textspacing").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#newboard").click();
  check(
    ev("note().board.width") === 3200 && ev("note().board.height") === 2400,
    "brainstorm board starts with a large two-dimensional canvas",
  );
  const boardId = ev("current");
  /** Convert a pointer event to the original canvas coordinates. */
  const point = (id, x, y) => {
    const r = c.getBoundingClientRect(),
      v = c.viewBox.baseVal;
    return event(
      w,
      id,
      r.left + (x / v.width) * r.width,
      r.top + (y / v.height) * r.height,
      "mouse",
    );
  };
  await c.onpointerdown(point(50, 120, 150));
  let nodeField = $("#nodeeditor");
  nodeField.value = "Launch strategy";
  nodeField.oninput();
  nodeField.onblur();
  await c.onpointerdown(point(51, 650, 230));
  nodeField = $("#nodeeditor");
  nodeField.value = "Customer research";
  nodeField.oninput();
  nodeField.onblur();
  check(
    ev("note().board.nodes.length") === 2,
    "brainstorm idea cards can be created and edited inline",
  );
  ev(
    'note().texts.push({x:134,y:225,size:18,width:232,lineHeight:1.5,font:"monospace",text:"Visible draft",color:"#293e2d"});LeafnoteApp.redraw()',
  );
  const visibilitySVG = c.cloneNode(true);
  visibilitySVG.setAttribute("viewBox", "120 150 260 100");
  visibilitySVG.setAttribute("width", "260");
  visibilitySVG.setAttribute("height", "100");
  const cardImage = await native.loadImage(
      Buffer.from(new w.XMLSerializer().serializeToString(visibilitySVG)),
    ),
    cardSurface = native.createCanvas(260, 100),
    cardContext = cardSurface.getContext("2d");
  cardContext.drawImage(cardImage, 0, 0);
  const glyphPixels = cardContext.getImageData(10, 53, 225, 28).data;
  let visibleGlyphs = 0;
  for (let i = 0; i < glyphPixels.length; i += 4)
    if (
      glyphPixels[i] < 150 &&
      glyphPixels[i + 1] < 160 &&
      glyphPixels[i + 3] > 200
    )
      visibleGlyphs++;
  check(
    visibleGlyphs > 30,
    "typed text inside a card remains visibly above its background",
  );
  ev("note().texts.pop();LeafnoteApp.redraw()");
  $('[data-tool="text"]').click();
  let defaultPrevented = false;
  const editPointer = point(59, 150, 170);
  editPointer.preventDefault = () => {
    defaultPrevented = true;
  };
  await c.onpointerdown(editPointer);
  nodeField = $("#nodeeditor");
  check(
    defaultPrevented &&
      nodeField?.value === "Launch strategy" &&
      !$("#papertext"),
    "Type opens the card editor and prevents a competing canvas focus action",
  );
  check(
    w.document.activeElement === nodeField,
    "idea card editor has keyboard focus",
  );
  typeButton.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  typeButton.focus();
  typeButton.click();
  $("#textcolor").value = "#2463eb";
  $("#textcolor").dispatchEvent(new w.Event("input", { bubbles: true }));
  check(
    ev("note().board.nodes[0].textColor") === "#2463eb" &&
      ev("note().board.nodes[0].color") === "#f3f7ed",
    "Type color changes idea-card lettering while preserving its background",
  );
  $("#textsize").value = "24";
  $("#textsize").dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#textspacing").value = "2";
  $("#textspacing").dispatchEvent(new w.Event("change", { bubbles: true }));
  check(
    ev("note().board.nodes[0].size") === 24 &&
      ev("note().board.nodes[0].lineHeight") === 2,
    "Type size and spacing also format idea-card lettering",
  );
  $("#title").focus();
  check(
    !$("#nodeeditor") &&
      c.querySelector("[data-board]").textContent.includes("Launch strategy"),
    "leaving the editor restores visible saved card text",
  );
  $('[data-tool="idea"]').click();
  const createPointer = point(60, 1100, 500);
  let creationPrevented = false;
  createPointer.preventDefault = () => {
    creationPrevented = true;
  };
  await c.onpointerdown(createPointer);
  check(
    creationPrevented && w.document.activeElement === $("#nodeeditor"),
    "creating a card retains focus for typing",
  );
  $("#title").focus();
  ev(
    'note().texts.push({x:1114,y:530,size:18,width:232,lineHeight:1.5,font:"monospace",text:"Recovered\\n   idea",color:"#293e2d"});LeafnoteApp.redraw()',
  );
  $('[data-tool="text"]').click();
  await c.onpointerdown(point(61, 1120, 530));
  check(
    $("#nodeeditor").value === "Recovered\n   idea" &&
      ev("note().texts.length") === 0,
    "previously hidden draft text is recovered into its blank card without duplication",
  );
  $("#title").focus();
  $("#undo").click();
  check(
    ev("note().board.nodes[2].text") === "" &&
      ev("note().texts[0].text") === "Recovered\n   idea",
    "undo restores recovered text to its original draft without losing it",
  );
  $("#redo").click();
  $("#deleteidea").click();
  check(
    ev("note().board.nodes.length") === 2,
    "card recovery leaves existing cards intact",
  );
  $('[data-tool="link"]').click();
  await c.onpointerdown(point(52, 150, 170));
  await c.onpointerdown(point(53, 680, 250));
  check(
    ev("note().board.links.length") === 1,
    "mind-map cards can be connected",
  );
  $('[data-tool="select"]').click();
  await c.onpointerdown(point(62, 150, 170));
  c.onpointerup(point(62, 150, 170));
  check(
    !$("#nodeeditor"),
    "a single Select click leaves the card available for dragging",
  );
  $('[data-tool="select"]').click();
  await c.onpointerdown(point(54, 150, 170));
  c.onpointermove(point(54, 250, 270));
  c.onpointerup(point(54, 250, 270));
  check(
    ev("note().board.nodes[0].x") === 220,
    "idea cards can be dragged around the board",
  );
  $("#undo").click();
  check(
    ev("note().board.nodes[0].x") === 120,
    "undo restores a moved idea card",
  );
  $("#redo").click();
  await c.onpointerdown(point(63, 250, 280));
  const outside = point(63, 350, 380),
    windowMove = new w.MouseEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: outside.clientX,
      clientY: outside.clientY,
      buttons: 1,
    });
  Object.defineProperty(windowMove, "pointerId", { value: 63 });
  w.dispatchEvent(windowMove);
  const windowUp = new w.MouseEvent("pointerup", {
    clientX: outside.clientX,
    clientY: outside.clientY,
  });
  Object.defineProperty(windowUp, "pointerId", { value: 63 });
  w.dispatchEvent(windowUp);
  check(
    ev("note().board.nodes[0].x") === 320 && !$("#nodeeditor"),
    "drag and drop continue when pointer events are delivered outside the canvas",
  );
  $("#undo").click();
  c.ondblclick(point(64, 250, 280));
  check(
    $("#nodeeditor")?.value === "Launch strategy",
    "double-click opens card editing in Select mode",
  );
  $("#title").focus();
  check(
    !$("#nodeeditor"),
    "finishing a double-click edit returns the card to a movable state",
  );
  $("#extendboard").click();
  check(
    ev("note().board.width") === 4800 && ev("note().board.height") === 3600,
    "More space expands the canvas in both dimensions",
  );
  $("#undo").click();
  check(ev("note().board.width") === 3200, "canvas expansion can be undone");
  $("#boardin").click();
  check(
    $("#boardzoom").textContent === "75%",
    "brainstorm board zoom changes independently of note content",
  );
  $('[data-tool="pen"]').click();
  await c.onpointerdown(point(55, 3180, 2380));
  c.onpointerup(point(55, 3180, 2380));
  check(
    ev("note().board.width") === 4800 && ev("note().board.height") === 3600,
    "drawing near a board edge automatically adds more room",
  );
  check(
    ev("note().strokes.at(-1).points[0][0]") === 3180,
    "canvas expansion preserves ink coordinates",
  );
  $("#undo").click();
  $('[data-tool="select"]').click();
  await c.onpointerdown(point(56, 250, 280));
  c.onpointerup(point(56, 250, 280));
  $("#deleteidea").click();
  check(
    ev("note().board.nodes.length") === 1 &&
      ev("note().board.links.length") === 0,
    "deleting an idea card also removes its connectors",
  );
  $("#undo").click();
  check(
    ev("note().board.nodes.length") === 2 &&
      ev("note().board.links.length") === 1,
    "undo restores a deleted card and its connector",
  );
  $("#search").value = "customer";
  $("#search").oninput();
  check(
    !!$('#notes [data-result-id="' + boardId + '"]'),
    "mind-map idea cards are included in all-note search",
  );
  $("#clearsearch").click();
  await ev("persist()");
  ev('loadNote("legacy-note")');
  $("#reviewhandwriting").click();
  $("#inktranscript").value = "Zebra river";
  $("#savetranscript").click();
  $("#search").value = "zebra";
  $("#searchkind").value = "handwriting";
  $("#search").oninput();
  check(
    !!$('#notes [data-result-id="legacy-note"]'),
    "reviewed handwriting search text is searchable without changing ink",
  );
  $("#clearsearch").click();
  $("#searchkind").value = "all";
  $('[data-tool="pen"]').click();
  await c.onpointerdown(event(w, 7, 20, 30));
  c.onpointermove(event(w, 8, 700, 800, "touch"));
  check(
    ev("note().strokes.at(-1).points.length") === 1,
    "palm pointer cannot modify an active pen stroke",
  );
  c.onpointermove(
    event(w, 7, 40, 50, "pen", {
      /** Implement the getCoalescedEvents callback in this object. */
      getCoalescedEvents() {
        return [
          event(w, 7, 30, 40, "pen", { pressure: 0.2 }),
          event(w, 7, 40, 50, "pen", { pressure: 0.8 }),
        ];
      },
    }),
  );
  c.onpointerup(event(w, 7, 40, 50));
  check(
    ev("note().strokes.at(-1).pressure") &&
      ev("note().strokes.at(-1).points.length") === 3,
    "coalesced samples and pressure are retained",
  );
  check(
    ev("LeafSearch.currentIndex(note())") === null,
    "changed handwriting excludes the previous recognition from search",
  );
  $("#undo").click();
  check(
    ev("note().strokes.length") === 1,
    "undo restores the previous drawing",
  );
  $("#redo").click();
  check(ev("note().strokes.length") === 2, "redo restores pressure ink");
  await c.onpointerdown(event(w, 9, 100, 100));
  c.onpointercancel(event(w, 9, 200, 200));
  check(
    ev("note().strokes.length") === 2,
    "cancelled pointer does not leave a partial stroke",
  );
  await c.onpointerdown(event(w, 10, 100, 100, "touch"));
  check(
    ev("note().strokes.length") === 2,
    "fingers scroll instead of drawing by default",
  );
  c.onpointerup(event(w, 10, 100, 100, "touch"));
  await c.onpointerdown(
    event(w, 11, 100, 100, "pen", { button: 5, buttons: 32 }),
  );
  c.onpointerup(event(w, 11, 100, 100, "pen", { button: 5, buttons: 0 }));
  check(
    ev("note().strokes.length") === 2,
    "hardware eraser input does not create ink",
  );
  await ev("persist()");
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("leafnote", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = reject;
  });
  const saved = await new Promise((resolve) => {
    const r = db.transaction("state").objectStore("state").get("notebook");
    r.onsuccess = () => resolve(r.result);
  });
  check(
    saved.notes.find((n) => n.id === "legacy-note").strokes[1].points[2][2] ===
      0.8,
    "pressure data persists in IndexedDB",
  );
  $("#inputmode").value = "stylus";
  $("#inputmode").onchange();
  let before = ev("note().strokes.length");
  await c.onpointerdown(event(w, 20, 400, 500, "mouse"));
  c.onpointerup(event(w, 20, 450, 550, "mouse"));
  check(
    ev("note().strokes.length") === before,
    "stylus-only mode rejects mouse drawing",
  );
  $("#inputmode").value = "all";
  $("#inputmode").onchange();
  await c.onpointerdown(event(w, 21, 500, 600, "touch"));
  c.onpointerup(event(w, 21, 510, 610, "touch"));
  check(
    ev("note().strokes.length") === before + 1,
    "finger drawing requires explicit all-input mode",
  );
  $("#undo").click();
  $("#inputmode").value = "pen";
  $("#inputmode").onchange();
  await c.onpointerdown(event(w, 22, 500, 600, "mouse"));
  c.onpointerup(event(w, 22, 510, 610, "mouse"));
  check(
    ev("note().strokes.length") === before + 1,
    "default input mode supports mouse annotations",
  );
  await c.onpointerdown(
    event(w, 23, 505, 605, "pen", { button: 5, buttons: 32 }),
  );
  c.onpointerup(event(w, 23, 505, 605, "pen", { button: 5, buttons: 0 }));
  check(
    ev("note().strokes.length") === before,
    "hardware eraser removes ink rather than adding it",
  );
  const raw = ev("structuredClone(data)");
  raw.version = 2;
  raw.files = { unexpected: "large payload" };
  const validated = ev("validate(" + JSON.stringify(raw) + ")");
  check(
    !("files" in validated),
    "backup PDF bytes are excluded from note metadata",
  );
  const doc = await PDFLib.PDFDocument.create();
  for (const r of [0, 90, 180, 270]) {
    const p = doc.addPage([440, 660]);
    p.setCropBox(20, 30, 400, 600);
    p.setRotation(PDFLib.degrees(r));
    p.drawRectangle({
      x: 20,
      y: 30,
      width: 400,
      height: 600,
      color: PDFLib.rgb(0.95, 0.95, 0.95),
    });
    if (r === 0)
      p.drawText("Searchable document text", { x: 40, y: 580, size: 12 });
  }
  const bytes = await doc.save();
  const file = new File([bytes], "Rotations.pdf", { type: "application/pdf" });
  Object.defineProperty($("#pdffile"), "files", {
    value: [file],
    configurable: true,
  });
  await $("#pdffile").onchange({ target: $("#pdffile") });
  try {
    await until(
      () => $("#pdfstatus").textContent.includes("Saved locally"),
      "PDF page render",
    );
  } catch (e) {
    console.log(
      "PDF diagnostic:",
      $("#toast").textContent,
      $("#pdfstatus").textContent,
    );
    throw e;
  }
  check(
    ev("note().pdf.pages.length") === 4 && $("#pdfpage").width > 0,
    "PDF import stores all pages and renders the first page",
  );
  $("#search").value = "searchable document";
  $("#searchkind").value = "pdf";
  $("#search").oninput();
  check(
    !!$('#notes [data-result-page="0"]'),
    "imported PDF text is indexed and searchable",
  );
  $("#clearsearch").click();
  $("#searchkind").value = "all";
  const countBeforeBad = ev("data.notes.length");
  Object.defineProperty($("#pdffile"), "files", {
    value: [new File(["not a PDF"], "wrong.pdf")],
    configurable: true,
  });
  await $("#pdffile").onchange({ target: $("#pdffile") });
  check(
    ev("data.notes.length") === countBeforeBad &&
      $("#toast").textContent.includes("not a PDF"),
    "invalid PDF is rejected without losing notes",
  );
  Object.defineProperty($("#pdffile"), "files", {
    value: [{ size: 26 * 1024 * 1024, name: "too-large.pdf" }],
    configurable: true,
  });
  await $("#pdffile").onchange({ target: $("#pdffile") });
  check(
    ev("data.notes.length") === countBeforeBad &&
      $("#toast").textContent.includes("25 MB"),
    "oversized PDF is rejected without losing notes",
  );
  await c.onpointerdown(event(w, 12, 200, 300));
  c.onpointermove(event(w, 12, 250, 350));
  c.onpointerup(event(w, 12, 250, 350));
  check(
    ev("note().pdf.pages[0].strokes.length") === 1,
    "PDF annotations attach to the current page",
  );
  const originalPoints = JSON.stringify(ev("note().pdf.pages[0].strokes"));
  $("#zoomin").click();
  await until(
    () => $("#pdfstatus").textContent.includes("Saved locally"),
    "PDF zoom",
  );
  check(
    JSON.stringify(ev("note().pdf.pages[0].strokes")) === originalPoints &&
      $("#zoomvalue").textContent === "125%",
    "zoom retains annotation coordinates",
  );
  $("#zoomfit").click();
  await until(
    () => $("#pdfstatus").textContent.includes("Saved locally"),
    "PDF fit",
  );
  $('[data-tool="highlighter"]').click();
  await c.onpointerdown(event(w, 24, 400, 450, "mouse"));
  c.onpointermove(event(w, 24, 500, 450, "mouse"));
  c.onpointerup(event(w, 24, 500, 450, "mouse"));
  check(
    ev("note().pdf.pages[0].strokes.at(-1).opacity") === 0.3,
    "highlighter annotations retain translucency",
  );
  $("#undo").click();
  $('[data-tool="pen"]').click();
  await $("#nextpage").onclick();
  await until(
    () => $("#pdfstatus").textContent.includes("Saved locally"),
    "second page",
  );
  check(
    ev("note().pdf.pages[1].strokes.length") === 0,
    "page navigation keeps page annotations separate",
  );
  await c.onpointerdown(event(w, 13, 100, 200));
  c.onpointerup(event(w, 13, 100, 200));
  $("#undo").click();
  check(
    ev("note().pdf.pages[0].strokes.length") === 1 &&
      ev("note().pdf.pages[1].strokes.length") === 0,
    "PDF undo affects only the current page",
  );
  $("#redo").click();
  $('[data-tool="text"]').click();
  await c.onpointerdown(event(w, 14, 200, 200, "mouse"));
  field = $("#papertext");
  field.value = "<script>safe text</script>";
  field.oninput();
  field.onblur();
  check(
    $("#canvas text").textContent === "<script>safe text</script>",
    "inline PDF annotations render as safe plain text",
  );
  $('[data-tool="pen"]').click();
  await $("#prevpage").onclick();
  $("#writingkind").value = "pencil";
  $("#pencilgrade").value = "2B";
  for (let i = 0; i < 4; i++) {
    if (i === 1) {
      $("#writingkind").value = "pen";
      $("#writingkind").dispatchEvent(new w.Event("change", { bubbles: true }));
    }
    if (i) await $("#nextpage").onclick();
    const pg = ev("note().pdf.pages[" + i + "]");
    const marker = event(
      w,
      100 + i,
      (60 / pg.width) * 800,
      (80 / pg.height) * 1050,
      "mouse",
    );
    await c.onpointerdown(marker);
    c.onpointerup(marker);
  }
  check(
    ev(
      'note().pdf.pages[0].strokes.some(s=>s.brush==="pencil"&&s.grade==="2B")',
    ),
    "PDF pages accept pencil annotations alongside pen ink",
  );
  await ev("persist()");
  let exported;
  ev("download=(body,name,type)=>{window.__export={body,name,type}}");
  await $("#export").onclick();
  exported = w.__export;
  if (exported?.type !== "application/pdf")
    console.log("Export diagnostic:", $("#toast").textContent);
  check(
    exported?.type === "application/pdf",
    "annotated export produces a PDF",
  );
  const output = await PDFLib.PDFDocument.load(new Uint8Array(exported.body));
  check(
    output.getPages().length === 4,
    "annotated PDF keeps every original page",
  );
  const exportedDoc = await app.lib.getDocument({
    data: new Uint8Array(exported.body),
  }).promise;
  for (let i = 1; i <= 4; i++) {
    const p = await exportedDoc.getPage(i),
      v = p.getViewport({ scale: 1 });
    check(
      v.width === (i % 2 ? 400 : 600),
      "export preserves rotated/cropped page dimensions " + i,
    );
    const surface = native.createCanvas(v.width, v.height),
      context = surface.getContext("2d");
    await p.render({ canvasContext: context, viewport: v }).promise;
    const pixel = context.getImageData(60, 80, 1, 1).data;
    check(
      pixel[1] > pixel[0] + 10 && pixel[0] < 160,
      "exported ink stays aligned on rotation " + (i - 1) * 90,
    );
  }
  await $("#backup").onclick();
  check(
    w.__export.type === "application/json" &&
      Object.keys(JSON.parse(w.__export.body).files).length === 1,
    "full backup includes the original PDF",
  );
  const backup = JSON.parse(w.__export.body);
  check(
    backup.notes.find((n) => n.pdf).pdf.pages[1].texts.length === 1,
    "full backup includes text and ink annotations",
  );
  const backupFile = new File([JSON.stringify(backup)], "backup.json", {
    type: "application/json",
  });
  Object.defineProperty($("#backupfile"), "files", {
    value: [backupFile],
    configurable: true,
  });
  const restoring = $("#backupfile").onchange({ target: $("#backupfile") });
  await until(() => $("#modal").open, "backup confirmation");
  $("#modal").close("ok");
  await restoring;
  check(
    ev("note().pdf.pages[1].texts.length") === 1,
    "backup restore recovers per-page annotations and documents",
  );
  const invalid = JSON.parse(JSON.stringify(backup));
  delete invalid.files;
  Object.defineProperty($("#backupfile"), "files", {
    value: [new File([JSON.stringify(invalid)], "invalid.json")],
    configurable: true,
  });
  await $("#backupfile").onchange({ target: $("#backupfile") });
  check(
    ev("note().pdf.pages[1].texts.length") === 1 &&
      $("#toast").textContent.includes("Could not import"),
    "invalid PDF backup leaves existing notes intact",
  );
  // Reload the application against the same origin database, without legacy localStorage.
  w.__ocrResponse = { text: "Recognized sample", alternatives: [] };
  w.Worker = class {
    postMessage(m) {
      w.__ocrLanguage = m.language;
      w.__ocrJobs = (w.__ocrJobs || 0) + 1;
      setTimeout(
        () =>
          this.onmessage({
            data: w.__ocrError
              ? { type: "error", id: m.id, error: w.__ocrError }
              : { type: "result", id: m.id, ...w.__ocrResponse },
          }),
        w.__ocrDelay || 1,
      );
    }
    terminate() {}
  };
  await $("#indexnotes").onclick();
  check(
    ev(
      'LeafSearch.currentIndex(data.notes.find(n=>n.id==="legacy-note"))?.text.includes("Recognized sample")',
    ),
    "handwriting indexing stores recognition output against the current ink signature",
  );
  $("#search").value = "recognized sample";
  $("#searchkind").value = "handwriting";
  $("#search").oninput();
  check(
    !!$('#notes [data-result-id="legacy-note"]'),
    "recognized ink becomes discoverable through handwriting search",
  );
  $("#clearsearch").click();
  $("#searchkind").value = "all";
  const handId = ev('createNote();note().title="test2";current');
  $('[data-tool="pen"]').click();
  await c.onpointerdown(event(w, 120, 120, 140, "mouse"));
  c.onpointermove(event(w, 120, 140, 160, "mouse"));
  c.onpointerup(event(w, 120, 140, 160, "mouse"));
  w.__ocrResponse = { text: "teat", alternatives: ["test Uttam"] };
  $("#search").value = "uttam";
  $("#search").oninput();
  await until(
    () => !!$('#notes [data-result-id="' + handId + '"]'),
    "automatic handwriting search",
  );
  await until(
    () => $("#indexnotes").textContent === "Index all notes",
    "automatic recognition completes",
  );
  check(
    ev("!!LeafSearch.currentIndex(note())"),
    "search automatically indexes unrecognized handwriting",
  );
  check(
    !!$('#notes [data-result-id="' + handId + '"]'),
    "alternative recognition readings are searchable",
  );
  $("#searchkind").value = "typed";
  $("#searchkind").onchange();
  check(
    !$("#searchallcontent").hidden &&
      $("#searchscope").textContent.includes("Typed text"),
    "a filter that hides handwriting results shows an all-content alternative",
  );
  $("#searchallcontent").click();
  check(
    $("#searchkind").value === "all" &&
      !!$('#notes [data-result-id="' + handId + '"]'),
    "Show all content restores handwriting matches",
  );
  $("#reviewinksearch").click();
  check(
    !$("#recognitionreview").hidden && $("#inktranscript").value === "teat",
    "a visible search-panel button shows recognized handwriting",
  );
  $("#inktranscript").value = "test\nuttam";
  $("#savetranscript").click();
  check(
    !!$('#notes [data-result-id="' + handId + '"]') &&
      ev("LeafSearch.currentIndex(note()).reviewed"),
    "correcting a proper name makes it searchable without changing ink",
  );
  $("#clearsearch").click();
  ev('createNote();note().title="Unreadable writing"');
  await c.onpointerdown(event(w, 121, 150, 150, "mouse"));
  c.onpointerup(event(w, 121, 150, 150, "mouse"));
  w.__ocrResponse = { text: "", alternatives: [] };
  await $("#indexnotes").onclick();
  check(
    $("#indexstatus").textContent.includes("no readable handwriting"),
    "empty recognition is reported explicitly instead of just ready",
  );
  ev('createNote();note().title="Recognition failure"');
  await c.onpointerdown(event(w, 122, 180, 180, "mouse"));
  c.onpointerup(event(w, 122, 180, 180, "mouse"));
  w.__ocrError = "model unavailable";
  await $("#indexnotes").onclick();
  check(
    $("#indexstatus").textContent.includes("incomplete") &&
      $("#indexstatus").textContent.includes("model unavailable"),
    "recognition failures remain visible in the final status",
  );
  w.__ocrError = "";
  const editId = ev('createNote();note().title="Character correction";current');
  await c.onpointerdown(event(w, 123, 120, 140, "mouse"));
  c.onpointerup(event(w, 123, 120, 140, "mouse"));
  ev(
    'note().handwriting={version:2,signature:LeafSearch.signature(note().strokes),text:"testtt\\nuttaamm",reviewed:false,lines:[],updated:Date.now()}',
  );
  const correctionInk = ev("LeafSearch.signature(note().strokes)");
  $("#reviewinksearch").click();
  const transcript = $("#inktranscript");
  transcript.setSelectionRange(4, 6);
  transcript.setRangeText("", 4, 6, "end");
  transcript.dispatchEvent(
    new w.InputEvent("input", { inputType: "deleteContentBackward" }),
  );
  let wordStart = transcript.value.indexOf("uttaamm");
  transcript.setRangeText("", wordStart + 4, wordStart + 5, "end");
  transcript.setRangeText(
    "",
    transcript.value.length - 1,
    transcript.value.length,
    "end",
  );
  transcript.dispatchEvent(
    new w.InputEvent("input", { inputType: "deleteContentBackward" }),
  );
  check(
    transcript.value === "test\nuttam" &&
      $("#reviewstatus").textContent.includes("Unsaved"),
    "extra characters can be deleted from recognized text with an unsaved indicator",
  );
  await $("#savetranscript").onclick();
  check(
    ev("note().handwriting.text") === "test\nuttam" &&
      $("#reviewstatus").textContent.includes("saved"),
    "Save corrections persists the edited characters",
  );
  check(
    ev("LeafSearch.signature(note().strokes)") === correctionInk,
    "text corrections preserve the original ink",
  );
  transcript.value = "test\nuttam revised";
  transcript.dispatchEvent(new w.Event("input"));
  $("#cancelreview").click();
  $("#reviewinksearch").click();
  check(
    $("#inktranscript").value === "test\nuttam revised",
    "closing and reopening review retains an unsaved draft",
  );
  $("#discardreview").click();
  check(
    $("#inktranscript").value === "test\nuttam",
    "Discard edits restores the last saved correction",
  );
  w.__ocrResponse = { text: "different automatic words", alternatives: [] };
  await $("#retryrecognition").onclick();
  check(
    $("#inktranscript").value === "different automatic words" &&
      ev("note().handwriting.text") === "test\nuttam",
    "recognition retry creates a draft without replacing a saved correction",
  );
  $("#discardreview").click();
  w.__ocrError = "could not fetch model";
  await $("#retryrecognition").onclick();
  check(
    $("#reviewstatus").textContent.includes("Could not retry") &&
      ev("note().handwriting.text") === "test\nuttam",
    "a failed retry preserves saved corrections",
  );
  w.__ocrError = "";
  ev('createNote();note().title="Review race"');
  await c.onpointerdown(event(w, 124, 120, 140, "mouse"));
  c.onpointerup(event(w, 124, 120, 140, "mouse"));
  w.__ocrDelay = 100;
  w.__ocrResponse = { text: "wrong background result", alternatives: [] };
  const jobsBefore = w.__ocrJobs || 0,
    backgroundIndex = $("#indexnotes").onclick();
  await until(
    () => (w.__ocrJobs || 0) > jobsBefore,
    "background recognition started",
  );
  $("#reviewinksearch").click();
  $("#inktranscript").value = "test\nuttam";
  $("#inktranscript").dispatchEvent(new w.Event("input"));
  await $("#savetranscript").onclick();
  await backgroundIndex;
  check(
    ev("note().handwriting.reviewed") &&
      ev("note().handwriting.text") === "test\nuttam",
    "background recognition cannot overwrite a correction saved while it was running",
  );
  w.__ocrDelay = 0;

  check(
    Search.norm("किताब") !== Search.norm("कताब"),
    "Devanagari vowel marks stay significant in search",
  );
  ev('createNote();note().title="Marathi handwriting"');
  await c.onpointerdown(event(w, 125, 120, 140, "mouse"));
  c.onpointermove(event(w, 125, 160, 170, "mouse"));
  c.onpointerup(event(w, 125, 160, 170, "mouse"));
  const marathiId = ev("current"),
    marathiInk = JSON.stringify(ev("note().strokes"));
  await $("#languagemodels").onclick();
  check(
    $("#modelsdialog").open && $("#modelcards").children.length === 2,
    "Language models opens the reviewed English and Marathi catalogue",
  );
  check(
    $("#modelcards").textContent.includes("Experimental") &&
      $("#modelcards").querySelectorAll("details").length === 2 &&
      $("#modelcards").querySelectorAll('a[rel="noopener noreferrer"]')
        .length >= 2,
    "model cards expose source, licence, size, and validation limits",
  );
  check(
    $('#modelcards [data-use-model="mr"]').disabled,
    "an uninstalled model cannot be used",
  );
  $('#modelcards [data-install-model="mr"]').click();
  await until(
    () => !$('#modelcards [data-use-model="mr"]').disabled,
    "model install UI",
  );
  check(
    $("#modelstatus").textContent.includes("installed"),
    "successful installation updates the model controls",
  );
  $('#modelcards [data-use-model="mr"]').click();
  check(
    !$("#modelsdialog").open &&
      !$("#recognitionreview").hidden &&
      ev("note().recognitionLanguage") === "mr",
    "Use for this page selects Marathi and opens handwriting review",
  );
  w.__ocrResponse = { text: "मराठी", alternatives: [] };
  await $("#retryrecognition").onclick();
  check(
    w.__ocrLanguage === "mr" && $("#inktranscript").value === "मराठी",
    "Marathi recognition requests use the selected language and return a review draft",
  );
  await $("#savetranscript").onclick();
  $("#search").value = "मराठी";
  $("#searchkind").value = "handwriting";
  $("#search").oninput();
  check(
    !!$('#notes [data-result-id="' + marathiId + '"]'),
    "saved Devanagari recognition is searchable",
  );
  $("#clearsearch").click();
  await $("#languagemodels").onclick();
  $('#modelcards [data-remove-model="mr"]').click();
  await until(
    () => $('#modelcards [data-use-model="mr"]').disabled,
    "remove model UI",
  );
  check(
    JSON.stringify(ev("note().strokes")) === marathiInk &&
      ev("note().handwriting.text") === "मराठी" &&
      ev("!!LeafSearch.currentIndex(note())"),
    "removing a model preserves ink and searchable saved text",
  );
  $("#closemodels").click();
  $("#cancelreview").click();
  const pdfId = ev("data.notes.find(n=>n.pdf).id");
  await ev("loadNote(" + JSON.stringify(pdfId) + ")");
  $("#reviewinksearch").click();
  $("#recognitionlanguage").value = "mr";
  $("#recognitionlanguage").onchange();
  check(
    ev("note().pdf.pages[LeafnoteApp.pageIndex()].recognitionLanguage") ===
      "mr" &&
      ev('note().pdf.pages.some(p=>(p.recognitionLanguage||"en")==="en")'),
    "PDF handwriting languages are selected per page",
  );
  await ev("persist()");
  $("#cancelreview").click();
  check(
    $("#favoritecount").textContent === "0",
    "Favorites displays a zero count before any note is starred",
  );
  const allBeforeFavorite = $("#count").textContent;
  $("#favorite").click();
  check(
    $("#favoritecount").textContent === "1" &&
      $("#count").textContent === allBeforeFavorite,
    "starring a note immediately increases Favorites without changing All notes",
  );
  $('[data-filter="star"]').click();
  check(
    $("#listtitle").textContent === "Favorites" && $("#notes [data-id]"),
    "Favorites opens the starred note",
  );
  $("#favorite").click();
  check(
    $("#favoritecount").textContent === "0" && !$("#notes [data-id]"),
    "unstarring the last favorite immediately clears its count and filtered list",
  );
  $("#favorite").click();
  await ev("persist()");
  $('[data-filter="all"]').click();
  w.LeafnoteApp.finish();
  $("#inkoptions").hidden = true;
  $("#recognitionreview").hidden = true;
  $("#notemenu").open = false;
  $("#toolsettings").open = false;
  w.document.activeElement?.blur();

  w.LeafLibrary.open();
  await until(
    () => $("#notes .note-thumbnail canvas"),
    "real PDF page thumbnail",
  );
  const pdfCard = [...w.document.querySelectorAll("#notes .note")].find(
    (el) => el.dataset.id === pdfId,
  );
  check(
    !!pdfCard?.querySelector("canvas") &&
      !!pdfCard?.querySelector("svg [data-ink]"),
    "PDF thumbnails combine a real original page with ink annotations",
  );
  const boardCard = [...w.document.querySelectorAll("#notes .note")].find(
    (el) =>
      ev(
        "data.notes.find(n=>n.id===" +
          JSON.stringify(el.dataset.id) +
          ")?.board",
      ),
  );
  check(
    !!boardCard?.querySelector("svg rect") &&
      !!boardCard?.querySelector("svg text"),
    "brainstorm thumbnails contain visible idea cards and their labels",
  );
  $("#viewlist").click();
  check(
    $(".app").classList.contains("notes-list") &&
      $("#viewlist").getAttribute("aria-pressed") === "true",
    "the library offers a remembered list alternative",
  );
  $("#viewgrid").click();
  const chosen = $("#notes .note[data-id]"),
    chosenId = chosen.dataset.id;
  chosen.click();
  check(
    !$(".app").classList.contains("library-home") && ev("current") === chosenId,
    "opening a thumbnail returns to the matching editable note",
  );
  w.LeafLibrary.open();
  $("#viewlist").click();
  w.LeafLibrary.close();
  const retainedSource = ev("data.notes.find(n=>n.pdf)"),
    retainedBytes = await w.LeafnoteApp.file(retainedSource.id);
  await w.LeafnoteApp.maintenance.restoreRevision(
    retainedSource,
    retainedBytes,
  );
  const retainedId = ev("current");
  check(
    retainedId !== retainedSource.id &&
      (await (await w.LeafnoteApp.file(retainedId)).text()) ===
        (await retainedBytes.text()),
    "historical PDF restore creates a separate note with the original bytes",
  );
  ev('note().title="Retainedonly sentinel";touch()');
  await ev("persist()");
  const activeBeforeTrash = Number($("#count").textContent),
    deleting = $("#delete").onclick();
  await until(() => $("#modal").open, "trash confirmation");
  $("#modal").close("ok");
  await deleting;
  check(
    ev(
      "data.notes.find(n=>n.id===" + JSON.stringify(retainedId) + ").deleted",
    ) && Number($("#count").textContent) === activeBeforeTrash - 1,
    "delete retains a flagged record while removing it from active counts",
  );
  check(
    !!(await w.LeafnoteApp.file(retainedId)),
    "moving a PDF to Trash keeps its original blob",
  );
  check(
    !Search.search(ev("data"), "Retainedonly").length,
    "Trash content is excluded from all-note search",
  );
  $("#maintenance").click();
  $("#showtrash").click();
  check(
    $("#maintenancedialog").open &&
      $("#maintenancelist").textContent.includes("Retainedonly"),
    "Dashboard opens local Trash with retained notes",
  );
  await $("#maintenancelist button").onclick();
  check(
    !ev(
      "data.notes.find(n=>n.id===" + JSON.stringify(retainedId) + ").deleted",
    ) && ev("current") === retainedId,
    "Trash restore returns the original note to the library",
  );
  $("#closemaintenance").click();
  await w.LeafnoteApp.maintenance.trashNote(retainedId);

  w.LeafLibrary.open();
  $("#viewlist").click();
  const splitCard = $("#notes [data-id]"),
    splitId = splitCard.dataset.id;
  splitCard.click();
  check(
    $(".app").classList.contains("library-split") &&
      !$(".app").classList.contains("library-home") &&
      !$(".app").classList.contains("library-hidden") &&
      ev("current") === splitId,
    "List keeps the note list beside the selected editable content",
  );
  check(
    $(".library-top").contains($("#librarymore")) &&
      $("#librarymore summary").textContent === "Library actions" &&
      $("#librarymore").contains($("#librarymaintenance")) &&
      !$("#librarydashboard"),
    "Dashboard is accessible through Library actions without a duplicate main button",
  );
  $("#librarymaintenance").click();
  await until(
    () => $("#dashboardcontent").textContent !== "Measuring…",
    "Dashboard storage measurement",
  );
  const measured = await w.LeafnoteApp.maintenance.usage();
  check(
    measured.contentBytes === measured.metadataBytes + measured.pdfBytes &&
      measured.pdfBytes > 0 &&
      measured.trashBytes > 0 &&
      $("#maintenancetitle").textContent === "Dashboard",
    "Dashboard measures content, PDFs and retained Trash and uses its new name",
  );
  $("#closemaintenance").click();
  w.LeafLibrary.close();
  const purgeSource = structuredClone(retainedSource);
  purgeSource.star = false;
  await w.LeafnoteApp.maintenance.restoreRevision(purgeSource, retainedBytes);
  const purgedId = ev("current");
  await w.LeafnoteApp.maintenance.trashNote(purgedId);
  $("#maintenance").click();
  $("#showtrash").click();
  const purgeRow = [...w.document.querySelectorAll(".maintenance-row")].find(
    (row) => row.textContent.includes("restored revision"),
  );
  w.confirm = () => false;
  await purgeRow.querySelector(".danger").onclick();
  check(
    ev("data.notes.some(n=>n.id===" + JSON.stringify(purgedId) + ")"),
    "cancelling permanent deletion keeps the retained note",
  );
  w.confirm = () => true;
  await purgeRow.querySelector(".danger").onclick();
  check(
    !ev("data.notes.some(n=>n.id===" + JSON.stringify(purgedId) + ")") &&
      !(await w.LeafnoteApp.file(purgedId)) &&
      ev("data.purged.some(n=>n.id===" + JSON.stringify(purgedId) + ")"),
    "permanent deletion atomically removes current content/PDF and saves a content-free marker",
  );
  $("#closemaintenance").click();
  ev("createNote()");
  const mixedId = ev("current");
  $("#pagepaper").value = "lined";
  $("#pagepaper").onchange();
  await $("#addpaperpage").onclick();
  $("#pagepaper").value = "grid";
  $("#pagepaper").onchange();
  ev(
    'LeafnoteApp.page().texts.push({x:40,y:80,size:18,width:700,lineHeight:1.5,font:"monospace",color:"#264c3d",text:"Grid page needle"});touch()',
  );
  await w.LeafnoteApp.goToPage(0);
  await $("#addpaperpage").onclick();
  $("#pagepaper").value = "plain";
  $("#pagepaper").onchange();
  check(
    ev('LeafSearch.pages(note()).map(p=>p.paper).join(",")') ===
      "lined,plain,grid" && w.LeafnoteApp.pageIndex() === 1,
    "Add page inserts after the current page and paper styles remain independent",
  );
  check(
    w.document.querySelectorAll(".document-page-preview").length === 2 &&
      !!$(".insert-page-inline") &&
      !!$("#words"),
    "all old/new pages are scrollable around the active page without losing the footer",
  );
  await w.LeafnoteApp.goToPage(2);
  ev('tool="pen"');
  const savedGridInk = event(w, 902, 200, 200, "mouse");
  await c.onpointerdown(savedGridInk);
  c.onpointerup(savedGridInk);
  const gridInkCount = w.LeafnoteApp.page().strokes.length;
  await w.LeafnoteApp.goToPage(0);
  const savedFirstInk = event(w, 903, 240, 240, "mouse");
  await c.onpointerdown(savedFirstInk);
  c.onpointerup(savedFirstInk);
  $("#undo").click();
  check(
    gridInkCount > 0 &&
      ev("note().extraPages[1].strokes.length") === gridInkCount &&
      ev("note().strokes.length") === 0,
    "undo on one ordinary page leaves other pages intact",
  );
  const mixedMatch = Search.search(ev("data"), "Grid page needle");
  check(
    mixedMatch.some((r) => r.id === mixedId && r.page === 2),
    "all-note search finds text on added pages at its correct page number",
  );
  const oldPageButton = [
    ...w.document.querySelectorAll(".document-page-preview"),
  ]
    .find((el) => el.dataset.page === "2")
    .querySelector("button");
  oldPageButton.click();
  await until(
    () => w.LeafnoteApp.pageIndex() === 2,
    "scrolling to edit another page",
  );
  check(
    $("#pagepaper").value === "grid" &&
      w.LeafnoteApp.page().texts.some((t) => t.text === "Grid page needle"),
    "a scrolled page can become the active editor with its own paper and contents",
  );
  const scrollFrame = [...w.document.querySelectorAll(".document-page-preview")]
    .find((el) => el.dataset.page === "0")
    .querySelector(".document-page-surface");
  const scrollInk = event(w, 904, 160, 160, "mouse");
  scrollFrame.onpointerdown({
    ...scrollInk,
    type: "pointerdown",
    target: scrollFrame,
    /** Implement the stopPropagation callback in this object. */
    stopPropagation() {},
  });
  await until(
    () => w.LeafnoteApp.pageIndex() === 0 && ev("note().strokes.length") > 0,
    "write directly on a scrolled page",
  );
  c.onpointerup(scrollInk);
  check(
    ev("note().strokes.length") > 0 &&
      ev("note().extraPages[1].strokes.length") === gridInkCount,
    "writing on a neighboring ordinary page activates it and preserves other pages",
  );
  await $("#export").onclick();
  const mixedExport = new JSDOM(w.__export?.body || w.__plainExport.body);
  check(
    mixedExport.window.document.querySelectorAll("section").length === 3 &&
      mixedExport.window.document.body.textContent.includes("Grid page needle"),
    "ordinary note export includes every mixed-paper page",
  );
  mixedExport.window.close();
  const pdfInsertSource = structuredClone(retainedSource);
  pdfInsertSource.star = false;
  await w.LeafnoteApp.maintenance.restoreRevision(
    pdfInsertSource,
    retainedBytes,
  );
  const mixedPdfId = ev("current");
  await w.LeafnoteApp.goToPage(0);
  $("#pagepaper").value = "lined";
  $("#pagepaper").onchange();
  await w.LeafnoteApp.goToPage(1);
  $("#pagepaper").value = "grid";
  $("#pagepaper").onchange();
  await $("#addpaperpage").onclick();
  $("#pagepaper").value = "dots";
  $("#pagepaper").onchange();
  const insertedPDF = await PDFLib.PDFDocument.load(
    new Uint8Array(await (await w.LeafnoteApp.file(mixedPdfId)).arrayBuffer()),
  );
  check(
    insertedPDF.getPageCount() === 5 &&
      ev('note().pdf.pages.map(p=>p.paper).slice(0,3).join(",")') ===
        "lined,grid,dots",
    "PDF insertion updates the original atomically and supports different paper overlays per page",
  );
  check(
    (await (await w.LeafnoteApp.file(retainedSource.id)).text()) ===
      (await retainedBytes.text()),
    "adding a page to a restored PDF leaves the source document unchanged",
  );
  await $("#export").onclick();
  const mixedPDFExport = await PDFLib.PDFDocument.load(
    new Uint8Array(w.__export.body),
  );
  check(
    mixedPDFExport.getPageCount() === 5,
    "annotated PDF export includes inserted pages and their paper overlays",
  );
  await ev("persist()");
  w.LeafnoteApp.finish();
  w.LeafBoard.finish();
  $("#inkoptions").hidden = true;
  $("#recognitionreview").hidden = true;
  $("#notemenu").open = false;
  $("#toolsettings").open = false;
  w.document.activeElement?.blur();

  ev(
    'createNote();note().title="Page order fixture";note().book="old";note().paper="plain";note().recognitionLanguage="mr";note().texts=[{x:40,y:60,size:18,width:700,lineHeight:1.5,font:"monospace",color:"#264c3d",text:"Page A"}];touch()',
  );
  const orderId = ev("current");
  await $("#addpaperpage").onclick();
  check(
    w.LeafnoteApp.pageIndex() === 1 && $("#pagepaper").value === "lined",
    "new pages default to Lined even when the preceding page is Plain",
  );
  ev(
    'LeafnoteApp.page().texts=[{x:40,y:60,size:18,width:700,lineHeight:1.5,font:"monospace",color:"#264c3d",text:"Page B"}];touch()',
  );
  await $("#addpaperpage").onclick();
  ev(
    'LeafnoteApp.page().texts=[{x:40,y:60,size:18,width:700,lineHeight:1.5,font:"monospace",color:"#264c3d",text:"Page C"}];touch()',
  );
  await w.LeafnoteApp.open(mixedId);
  await w.LeafnoteApp.open(orderId);
  check(
    w.LeafnoteApp.pageIndex() === 2 &&
      $("#addpaperpage").textContent === "Add after page 3",
    "returning to a note keeps the selected page and the Add label follows it",
  );
  check(
    [...w.document.querySelectorAll(".insert-page-inline")]
      .map((el) => el.textContent)
      .join("|") ===
      "Add page after page 1|Add page after page 2|Add page after page 3",
    "every displayed page has its own correctly numbered Add button",
  );
  await w.document
    .querySelector('.insert-page-inline[data-after-page="0"]')
    .onclick();
  check(
    w.LeafnoteApp.pageIndex() === 1 &&
      ev(
        'LeafSearch.pages(note()).map(p=>p.texts[0]?.text||"blank").join(",")',
      ) === "Page A,blank,Page B,Page C",
    "adding after a non-selected earlier page inserts at that exact position",
  );
  ev(
    'LeafnoteApp.page().texts=[{x:40,y:60,size:18,width:700,lineHeight:1.5,font:"monospace",color:"#264c3d",text:"Inserted page"}];touch()',
  );
  $("#pagepaper").value = "grid";
  $("#pagepaper").onchange();
  let actionHeader = w.document.querySelector('[data-page-controls="3"]');
  actionHeader.querySelector("input").value = "1";
  await [...actionHeader.querySelectorAll("button")]
    .find((el) => el.textContent === "Move to position")
    .onclick();
  check(
    ev('LeafSearch.pages(note()).map(p=>p.texts[0]?.text).join(",")') ===
      "Page C,Page A,Inserted page,Page B" &&
      ev("note().extraPages[0].recognitionLanguage") === "mr" &&
      ev("note().book") === "old" &&
      ev("note().title") === "Page order fixture",
    "moving a later page to the front keeps page content, language and parent note metadata",
  );
  check(
    w.LeafnoteApp.pageIndex() === 2 && $("#pagepaper").value === "grid",
    "moving another page retains the selected page rather than selecting page 1",
  );
  await w.LeafnoteApp.movePage(2, 3);
  check(
    w.LeafnoteApp.pageIndex() === 3 &&
      ev("LeafSearch.pages(note())[3].texts[0].text") === "Inserted page",
    "moving the selected page follows it to its new position",
  );
  actionHeader = w.document.querySelector('[data-page-controls="3"]');
  await [...actionHeader.querySelectorAll("button")]
    .find((el) => el.textContent === "Move up")
    .onclick();
  check(
    w.LeafnoteApp.pageIndex() === 2 &&
      ev("LeafSearch.pages(note())[2].texts[0].text") === "Inserted page",
    "Move up updates both the order and selected page",
  );
  w.confirm = () => false;
  await w.LeafnoteApp.deletePage(1);
  check(
    ev("LeafSearch.pages(note()).length") === 4,
    "cancelling page deletion leaves the document unchanged",
  );
  w.confirm = () => true;
  await w.LeafnoteApp.deletePage(1);
  check(
    ev('LeafSearch.pages(note()).map(p=>p.texts[0]?.text).join(",")') ===
      "Page C,Inserted page,Page B" && w.LeafnoteApp.pageIndex() === 1,
    "deleting an earlier page preserves remaining page order and current content",
  );
  await $("#export").onclick();
  const orderExport = new JSDOM(w.__export.body);
  check(
    [...orderExport.window.document.querySelectorAll("section")]
      .map((section) => section.textContent)
      .join("|") === "Page C|Inserted page|Page B",
    "ordinary note export follows the edited page order",
  );
  orderExport.window.close();
  ev("createNote()");
  const singlePageId = ev("current");
  await w.LeafnoteApp.deletePage(0);
  check(
    ev("LeafSearch.pages(note()).length") === 1 &&
      [...w.document.querySelectorAll(".page-actions-panel button")].find(
        (el) => el.textContent === "Delete page 1",
      ).disabled,
    "the last page is protected from deletion",
  );
  const pdfOrderSource = structuredClone(retainedSource);
  pdfOrderSource.star = false;
  pdfOrderSource.pdf.pages.forEach((pg, i) =>
    pg.texts.push({
      x: 30,
      y: 35,
      size: 16,
      width: 350,
      lineHeight: 1.5,
      font: "monospace",
      color: "#264c3d",
      text: "Order label " + i,
    }),
  );
  await w.LeafnoteApp.maintenance.restoreRevision(
    pdfOrderSource,
    retainedBytes,
  );
  const pdfOrderId = ev("current");
  await w.LeafnoteApp.goToPage(1);
  await w.LeafnoteApp.movePage(0, 3);
  let rawOrder = await PDFLib.PDFDocument.load(
    new Uint8Array(await (await w.LeafnoteApp.file(pdfOrderId)).arrayBuffer()),
  );
  check(
    rawOrder
      .getPages()
      .map((p) => p.getRotation().angle)
      .join(",") === "90,180,270,0" &&
      ev(
        'note().pdf.pages.map(p=>p.texts.find(t=>t.text.startsWith("Order label")).text).join(",")',
      ) === "Order label 1,Order label 2,Order label 3,Order label 0",
    "PDF reordering moves original page bytes and annotation metadata together",
  );
  w.confirm = () => false;
  await w.LeafnoteApp.deletePage(1);
  check(
    ev("note().pdf.pages.length") === 4,
    "cancelling PDF page deletion retains every original page",
  );
  w.confirm = () => true;
  await w.LeafnoteApp.deletePage(1);
  rawOrder = await PDFLib.PDFDocument.load(
    new Uint8Array(await (await w.LeafnoteApp.file(pdfOrderId)).arrayBuffer()),
  );
  check(
    rawOrder
      .getPages()
      .map((p) => p.getRotation().angle)
      .join(",") === "90,270,0" &&
      ev(
        'note().pdf.pages.map(p=>p.texts.find(t=>t.text.startsWith("Order label")).text).join(",")',
      ) === "Order label 1,Order label 3,Order label 0",
    "PDF deletion removes only the chosen page and keeps remaining annotations aligned",
  );
  await $("#export").onclick();
  const orderedPDFExport = await PDFLib.PDFDocument.load(
    new Uint8Array(w.__export.body),
  );
  check(
    orderedPDFExport
      .getPages()
      .map((p) => p.getRotation().angle)
      .join(",") === "90,270,0",
    "annotated PDF export follows moved and deleted page order",
  );
  await w.LeafnoteApp.open(orderId);
  await w.LeafnoteApp.goToPage(1);
  await ev("persist()");
  w.LeafnoteApp.finish();
  w.LeafBoard.finish();
  $("#inkoptions").hidden = true;
  $("#recognitionreview").hidden = true;
  $("#notemenu").open = false;
  $("#toolsettings").open = false;
  w.document.activeElement?.blur();
  const syncEvents = [];
  w.document.addEventListener("leafnote-local-saved", (e) =>
    syncEvents.push(e.detail),
  );
  const localSync = await w.LeafnoteApp.sync.read(),
    incoming = structuredClone(localSync.data),
    arrival = structuredClone(incoming.notes.find((n) => !n.pdf && !n.board));
  arrival.id = "sync-arrival";
  arrival.title = "Arrived from server";
  incoming.notes.push(arrival);
  await ev("persist()");
  check(
    !(await w.LeafnoteApp.sync.apply(incoming, [], localSync.version)),
    "remote adoption refuses to replace a newer local version",
  );
  $("#notemenu").open = true;
  $("#syncdialog").setAttribute("open", "");
  check(
    !w.LeafnoteApp.sync.busy(),
    "sync status controls do not block a requested synchronization",
  );
  const latestSync = await w.LeafnoteApp.sync.read();
  const adoption = w.LeafnoteApp.sync.apply(incoming, [], latestSync.version, {
    keepUndoIds: latestSync.data.notes.map((n) => n.id),
  });
  const duringAdoption = new w.KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  w.document.dispatchEvent(duringAdoption);
  check(
    duringAdoption.defaultPrevented,
    "document shortcuts cannot mutate notes during atomic remote adoption",
  );
  check(
    await adoption,
    "remote adoption atomically saves a merged notebook when the editor is idle",
  );
  check(
    ev('data.notes.some(n=>n.id==="sync-arrival")') &&
      syncEvents.some((e) => e.remote),
    "remote adoption is marked separately from local edits to avoid echo uploads",
  );
  $("#syncdialog").removeAttribute("open");
  $("#notemenu").open = false;
  const again = await makeApp(
    undefined,
    JSON.parse(w.localStorage.getItem("leafnote-layout-v1")),
    w.localStorage.getItem("leafnote-text-color"),
    w.localStorage.getItem("leafnote-text-format"),
    w.localStorage.getItem("leafnote-writing"),
    undefined,
    false,
    w.localStorage.getItem("leafnote-library-view-v1"),
    w.localStorage.getItem("leafnote-page-positions-v1"),
  );
  check(
    again.evaluate("data.notes.some(n=>n.pdf)") &&
      again.evaluate(
        'data.notes.find(n=>n.id==="legacy-note").strokes.length',
      ) === 2,
    "reload recovers both migrated notes and imported documents",
  );
  check(
    again.evaluate(
      'data.notes.some(n=>n.texts?.some(t=>t.text==="one  two\\n    three    "))',
    ),
    "reload preserves free-position text and exact indentation",
  );
  check(
    again.evaluate(
      "data.notes.some(n=>n.board?.nodes.length===2&&n.board.links.length===1)",
    ),
    "reload preserves brainstorm cards, their positions, and connectors",
  );
  check(
    again.evaluate(
      'data.notes.some(n=>n.board?.nodes.some(c=>c.text==="Launch strategy")&&n.board.nodes.some(c=>c.text==="Customer research"))',
    ),
    "card labels survive backup restore and reload",
  );
  check(
    again.evaluate(
      '!!LeafSearch.currentIndex(data.notes.find(n=>n.id==="legacy-note"))',
    ),
    "reload preserves the handwriting search index",
  );
  check(
    again.evaluate(
      'LeafSearch.search(data,"uttam","handwriting").some(r=>r.title==="test2")',
    ),
    "reviewed handwriting remains searchable after reload",
  );
  check(
    again.evaluate(
      "data.notes.find(n=>n.id===" +
        JSON.stringify(marathiId) +
        ").recognitionLanguage",
    ) === "mr" &&
      again.evaluate(
        'LeafSearch.search(data,"मराठी","handwriting").some(r=>r.id===' +
          JSON.stringify(marathiId) +
          ")",
      ),
    "Marathi language choice and searchable corrections survive reload",
  );
  check(
    again.w.document.querySelector("#favoritecount").textContent === "1",
    "Favorites count is restored from saved notes after reload",
  );
  check(
    !again.w.document
      .querySelector(".app")
      .classList.contains("library-hidden"),
    "a chosen library visibility preference survives reopening",
  );
  check(
    again.w.document.querySelector("#textcolor").value === "#2463eb" &&
      again.evaluate(
        'data.notes.some(n=>n.texts?.some(t=>t.text==="Color sample"&&t.color==="#d13f3f"))',
      ),
    "text colors and the current color preference survive reopening",
  );
  check(
    again.evaluate(
      'data.notes.some(n=>n.board?.nodes.some(n=>n.textColor==="#2463eb"))',
    ),
    "idea-card lettering colors survive backup validation and reload",
  );
  check(
    again.evaluate(
      'data.notes.some(n=>n.texts?.some(t=>t.text==="Color sample"&&t.size===24&&t.lineHeight===2))',
    ),
    "typed size and line spacing survive saved-note reload",
  );
  check(
    again.evaluate(
      "data.notes.some(n=>n.board?.nodes.some(n=>n.size===24&&n.lineHeight===2))",
    ),
    "idea-card size and spacing survive backup validation and reload",
  );
  check(
    again.w.document.querySelector("#textsize").value ===
      w.document.querySelector("#textsize").value &&
      again.w.document.querySelector("#textspacing").value ===
        w.document.querySelector("#textspacing").value,
    "current typing size and spacing preferences survive reopening",
  );
  check(
    again.evaluate(
      "data.notes.find(n=>n.id===" +
        JSON.stringify(pencilSampleId) +
        ').strokes.filter(s=>s.brush==="pencil").length',
    ) === 4,
    "all pencil strokes survive backup validation and reload",
  );
  check(
    again.evaluate(
      "data.notes.find(n=>n.id===" +
        JSON.stringify(pencilSampleId) +
        ').strokes.some(s=>s.grade==="2B"&&s.width===3.4&&s.opacity===.9)',
    ),
    "pencil softness and grade are preserved after reload",
  );
  check(
    again.evaluate(
      "!!LeafSearch.currentIndex(data.notes.find(n=>n.id===" +
        JSON.stringify(pencilSampleId) +
        "))",
    ),
    "the pencil handwriting search index stays valid after reload",
  );
  check(
    again.w.document.querySelector("#writingkind").value === "pen",
    "an explicitly chosen Pen is remembered after reopening",
  );
  check(
    again.evaluate('data.notes.some(n=>n.id==="sync-arrival")'),
    "a synced note survives real IndexedDB validation and reopening",
  );
  check(
    again.evaluate(
      "data.notes.find(n=>n.id===" + JSON.stringify(retainedId) + ").deleted",
    ) && !!(await again.w.LeafnoteApp.file(retainedId)),
    "Trash metadata and retained PDF bytes survive reload",
  );
  check(
    again.w.document
      .querySelector(".app")
      .classList.contains("library-split") &&
      again.w.document
        .querySelector("#viewlist")
        .getAttribute("aria-pressed") === "true",
    "reopening starts in the library and remembers the selected view",
  );
  check(
    again.evaluate(
      "data.notes.find(n=>n.id===" +
        JSON.stringify(mixedId) +
        ").extraPages[1].paper",
    ) === "grid" &&
      again.evaluate(
        "data.notes.find(n=>n.id===" +
          JSON.stringify(mixedPdfId) +
          ").pdf.pages.length",
      ) === 5,
    "added pages and mixed paper survive validation and reopening",
  );
  check(
    again.evaluate(
      "data.purged.some(n=>n.id===" + JSON.stringify(purgedId) + ")",
    ) && !(await again.w.LeafnoteApp.file(purgedId)),
    "permanent deletion markers and removed PDF state survive reopening",
  );
  await again.w.LeafnoteApp.open(orderId);
  check(
    again.w.LeafnoteApp.pageIndex() === 1 &&
      again.evaluate(
        'LeafSearch.pages(note()).map(p=>p.texts[0]?.text).join(",")',
      ) === "Page C,Inserted page,Page B",
    "page ordering and selected page survive reopening",
  );
  check(
    again.evaluate(
      "data.notes.find(n=>n.id===" +
        JSON.stringify(pdfOrderId) +
        ").pdf.pages.length",
    ) === 3,
    "PDF page removal survives persisted validation and reopening",
  );
  const blocked = await makeApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      /** Convert an IndexedDB request to a promise. */
      request: async (name, options, callback) => callback(null),
    },
    true,
  );
  check(
    !blocked.w.LeafnoteApp.ready &&
      blocked.w.document
        .querySelector("#loading")
        .textContent.includes("already open"),
    "a second writer window is blocked before it can touch notebook storage",
  );
  const granted = await makeApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      /** Convert an IndexedDB request to a promise. */
      request: async (name, options, callback) => callback({ name }),
    },
  );
  check(
    granted.w.LeafnoteApp.sync.supported(),
    "a granted browser writer lock enables the sync bridge",
  );
  check(
    granted.evaluate('data.notes.some(n=>n.id==="sync-arrival")'),
    "opening a blocked writer cannot replace the saved notebook",
  );
  blocked.dom.window.close();
  granted.dom.window.close();
  console.log("ALL " + checks + " CHECKS PASSED");
  await exportedDoc.loadingTask.destroy();
  db.close();
  app.dom.window.close();
  again.dom.window.close();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
