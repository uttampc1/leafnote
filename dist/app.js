/** @file Base notebook state, legacy migration helpers, navigation, and event wiring. features.js replaces the original storage and drawing handlers after IndexedDB is ready. */
"use strict";
/** Select the first DOM element matching a CSS selector. Return all matching DOM elements as an array. */
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const KEY = "leafnote-v1",
  NS = "http://www.w3.org/2000/svg";
const palette = ["#839d70", "#c69a75", "#899fc1", "#b398bb", "#c6b36c"];
/** Create a random UUID for a note, notebook, or idea card. */
const uid = () => crypto.randomUUID();
let data,
  filter = "all",
  current,
  tool = "pen",
  redo = [],
  stroke = null,
  eraseBefore = null,
  pendingModal;
const welcome =
  "<p>Every good idea starts somewhere.</p><p>This is your space to collect the things that matter — a passing thought, a project taking shape, or something you don’t want to forget.</p><h2>Make yourself at home</h2><ul><li>Type your thoughts right here.</li><li>Pick up the pen to sketch or write by hand.</li><li>Try a highlighter, a new ink color, or dotted paper.</li><li>Keep related ideas together in a notebook.</li></ul><blockquote>Leave a little room for your next idea.</blockquote><p><br></p>";
/** Create an empty notebook collection with starter notebook categories. */
function fresh() {
  return {
    books: [
      { id: "personal", name: "Personal", color: palette[0] },
      { id: "work", name: "Work & ideas", color: palette[1] },
      { id: "learning", name: "Learning", color: palette[2] },
    ],
    notes: [
      {
        id: uid(),
        book: "personal",
        title: "",
        html: "",
        paper: "plain",
        texts: [],
        strokes: [],
        star: false,
        created: Date.now(),
        updated: Date.now(),
      },
    ],
  };
}
/** Sanitize legacy rich HTML to the small supported tag set. */
function clean(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const allowed = new Set([
    "P",
    "DIV",
    "BR",
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "UL",
    "OL",
    "LI",
    "H2",
    "H3",
    "BLOCKQUOTE",
  ]);
  /** Recursively remove unsupported tags and attributes from a legacy HTML fragment. */
  function walk(el) {
    for (const child of [...el.children]) {
      if (!allowed.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent));
        continue;
      }
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      walk(child);
    }
  }
  walk(doc.body);
  return doc.body.innerHTML;
}
/** Validate imported notebook data before replacing saved state. */
function validate(x) {
  if (
    !x ||
    !Array.isArray(x.books) ||
    !x.books.length ||
    !Array.isArray(x.notes) ||
    x.notes.length > 3000
  )
    throw Error("Invalid backup");
  x.books = x.books.map((b) => ({
    id: String(b.id),
    name: String(b.name).slice(0, 100),
    color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : palette[0],
  }));
  if (new Set(x.books.map((b) => b.id)).size !== x.books.length)
    throw Error("Duplicate notebooks");
  x.notes = x.notes.map((n) => ({
    id: String(n.id),
    book: x.books.some((b) => b.id === n.book) ? n.book : x.books[0].id,
    title: String(n.title || "").slice(0, 200),
    html: clean(n.html || ""),
    paper: ["lined", "dots", "grid", "plain"].includes(n.paper)
      ? n.paper
      : "lined",
    star: !!n.star,
    ...(n.deleted === true
      ? {
          deleted: true,
          deletedAt: Number(n.deletedAt) || Number(n.updated) || Date.now(),
        }
      : {}),
    created: Number(n.created) || Date.now(),
    updated: Number(n.updated) || Date.now(),
    strokes: (Array.isArray(n.strokes) ? n.strokes : [])
      .filter(
        (s) =>
          Array.isArray(s.points) &&
          s.points.length &&
          s.points.every(
            (p) =>
              Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
          ),
      )
      .map((s) => ({
        color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#264c3d",
        width: Math.max(1, Math.min(40, Number(s.width) || 3)),
        opacity: s.opacity === 0.3 ? 0.3 : 1,
        points: s.points,
      })),
  }));
  if (new Set(x.notes.map((n) => n.id)).size !== x.notes.length)
    throw Error("Duplicate notes");
  return x;
}
data = fresh();
current = data.notes[0]?.id;
/** Resolve the currently open note from its stable ID. */
function note() {
  return data.notes.find((n) => n.id === current && !n.deleted);
}
/** Resolve a note’s notebook, falling back to the first available notebook. */
function book(n) {
  return data.books.find((b) => b.id === n.book) || data.books[0];
}
/** Queue a snapshot for device storage; report storage errors without discarding the current note. */
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    $("#saved").textContent = "Saved on device";
    return true;
  } catch (e) {
    $("#saved").textContent = "Not saved";
    toast(
      "Browser storage is full or unavailable. Export a backup to keep your work.",
    );
    return false;
  }
}
/** Display a temporary status message without blocking editing. */
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
/** Extract text from a legacy HTML note. */
function plain(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent || "";
}
/** Escape text before inserting it into generated HTML. */
function escapeText(t) {
  return String(t).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
/** Refresh notebook navigation, total counts, favorite counts, and notebook choices. */
function renderNav() {
  $("#count").textContent = data.notes.filter((n) => !n.deleted).length;
  $("#favoritecount").textContent = data.notes.filter(
    (n) => !n.deleted && n.star,
  ).length;
  $("#books").innerHTML = data.books
    .map(
      (b) =>
        `<button class="nav ${filter === b.id ? "active" : ""}" data-filter="${escapeText(b.id)}"><i class="bookdot" style="--bookcolor:${b.color}"></i><span>${escapeText(b.name)}</span><b>${data.notes.filter((n) => !n.deleted && n.book === b.id).length}</b></button>`,
    )
    .join("");
  $$("nav .nav").forEach((b) =>
    b.classList.toggle("active", b.dataset.filter === filter),
  );
  $("#notebook").innerHTML = data.books
    .map(
      (b) =>
        `<option value="${escapeText(b.id)}">${escapeText(b.name)}</option>`,
    )
    .join("");
}
/** Render the current filtered note list; search.js later replaces this base implementation. */
function renderList() {
  const q = $("#search").value.toLowerCase();
  const notes = data.notes
    .filter(
      (n) =>
        !n.deleted &&
        (filter === "all" ||
          (filter === "star" && n.star) ||
          n.book === filter) &&
        (!q || (n.title + " " + plain(n.html)).toLowerCase().includes(q)),
    )
    .sort((a, b) =>
      $("#sort").value === "title"
        ? a.title.localeCompare(b.title)
        : b.updated - a.updated,
    );
  $("#listtitle").textContent =
    filter === "all"
      ? "All notes"
      : filter === "star"
        ? "Favorites"
        : data.books.find((b) => b.id === filter)?.name || "Notes";
  $("#results").textContent =
    notes.length + " " + (notes.length === 1 ? "note" : "notes");
  $("#notes").innerHTML = notes.length
    ? notes
        .map(
          (n) =>
            `<button class="note ${n.id === current ? "active" : ""}" data-id="${escapeText(n.id)}"><span class="tag">${escapeText(book(n).name)}</span><h3>${escapeText(n.title || "Untitled note")}${n.star ? " ☆" : ""}</h3><div class="preview">${escapeText(plain(n.html).slice(0, 140) || "A blank page, ready for you.")}</div><div class="meta"><span>${new Date(n.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>${n.strokes.length ? "Handwritten" : "Text note"}</span></div></button>`,
        )
        .join("")
    : '<div class="empty">No notes here yet.<br>Create a note to get started.</div>';
}
/** Refresh the rendered ink, typed text, and board layers. */
function redraw() {
  const c = $("#canvas");
  c.replaceChildren();
  for (const s of note()?.strokes || []) c.append(pathFor(s));
}
/** Build an SVG path representing one stored ink stroke. */
function pathFor(s) {
  const p = document.createElementNS(NS, "path");
  p.setAttribute(
    "d",
    "M" +
      s.points.map((p) => p.join(",")).join(" L") +
      (s.points.length === 1 ? " l0.1,0.1" : ""),
  );
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", s.color);
  p.setAttribute("stroke-width", s.width);
  p.setAttribute("stroke-opacity", s.opacity);
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  return p;
}
/** Recalculate the note surface dimensions without changing stored coordinates. */
function resizePage() {
  $("#surface").style.height =
    Math.max(640, $("#editor").scrollHeight + 25) + "px";
}
/** Open a note, update its controls, and refresh its drawing surface. */
function loadNote(id) {
  current =
    data.notes.find((n) => n.id === id && !n.deleted)?.id ||
    data.notes.find((n) => !n.deleted)?.id;
  redo = [];
  stroke = null;
  const n = note();
  if (!n) {
    createNote();
    return;
  }
  $("#title").value = n.title;
  $("#editor").innerHTML = n.html;
  $("#notebook").value = n.book;
  $("#crumb").textContent = book(n).name;
  $("#paper").value = n.paper;
  $("#sheet").className = n.paper;
  $("#date").textContent = new Date(n.created).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  $("#favorite").textContent = n.star ? "★" : "☆";
  $("#favorite").setAttribute("aria-pressed", n.star);
  redraw();
  countWords();
  resizePage();
  renderList();
  $(".app").classList.remove("showlist");
}
/** Count words in the original rich-text editor. */
function countWords() {
  const t = $("#editor").innerText.trim();
  $("#words").textContent = (t ? t.split(/\s+/).length : 0) + " words";
}
/** Update a note’s modified time, persist it, and refresh its list preview. */
function touch() {
  if (!note()) return;
  note().updated = Date.now();
  persist();
  renderList();
}
/** Create a blank named-later page in the selected notebook. */
function createNote() {
  const n = {
    id: uid(),
    book: data.books.some((b) => b.id === filter) ? filter : data.books[0].id,
    title: "",
    html: "",
    paper: "plain",
    texts: [],
    strokes: [],
    star: false,
    created: Date.now(),
    updated: Date.now(),
  };
  data.notes.unshift(n);
  current = n.id;
  persist();
  renderNav();
  loadNote(n.id);
  $("#title").focus();
}
/** Open the shared confirmation/input dialog and resolve the user’s response. */
function modal(title, text, input = false, ok = "Create") {
  return new Promise((resolve) => {
    $("#modal-title").textContent = title;
    $("#modal-text").textContent = text;
    $("#modal-input").hidden = !input;
    $("#modal-input").value = "";
    $("#modal-ok").textContent = ok;
    $("#modal").returnValue = "cancel";
    pendingModal = resolve;
    $("#modal").showModal();
    if (input) $("#modal-input").focus();
  });
}
$("#modal").addEventListener("close", () => {
  pendingModal?.({
    ok: $("#modal").returnValue === "ok",
    value: $("#modal-input").value.trim(),
  });
  pendingModal = null;
});
$("#new").onclick = createNote;
const newSmall = document.createElement("button");
newSmall.textContent = "＋ New";
newSmall.title = "Create note";
newSmall.onclick = createNote;
$(".listbar").insertBefore(newSmall, $("#sort"));
document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-filter]");
  if (f) {
    filter = f.dataset.filter;
    renderNav();
    renderList();
  }
  const n = e.target.closest("[data-id]");
  if (n) loadNote(n.dataset.id);
  const t = e.target.closest("[data-tool]");
  if (t) {
    tool = t.dataset.tool;
    $$("[data-tool]").forEach((b) => b.classList.toggle("selected", b === t));
    $("#surface").classList.toggle("drawing", tool !== "text");
    $("#editor").contentEditable = tool === "text";
    $("#hint").textContent =
      tool === "text"
        ? "Click anywhere on the page to write"
        : tool === "eraser"
          ? "Touch a stroke to erase it"
          : "Write with a stylus, mouse, or touch";
  }
});
$("#addbook").onclick = async () => {
  const r = await modal(
    "A home for related ideas",
    "Give your new notebook a name.",
    true,
  );
  if (!r.ok || !r.value) return;
  const b = {
    id: uid(),
    name: r.value.slice(0, 100),
    color: palette[data.books.length % palette.length],
  };
  data.books.push(b);
  filter = b.id;
  persist();
  renderNav();
  renderList();
  $("#notebook").value = note().book;
};
$("#search").oninput = renderList;
$("#sort").onchange = renderList;
$("#mobile").onclick = () => $(".app").classList.toggle("showlist");
$("#title").oninput = () => {
  note().title = $("#title").value.slice(0, 200);
  touch();
};
$("#editor").oninput = () => {
  note().html = clean($("#editor").innerHTML);
  countWords();
  resizePage();
  touch();
};
$("#editor").addEventListener("paste", (e) => {
  e.preventDefault();
  document.execCommand(
    "insertText",
    false,
    e.clipboardData.getData("text/plain"),
  );
});
$("#editor").addEventListener("drop", (e) => e.preventDefault());
$$("[data-cmd]").forEach((b) => {
  b.onmousedown = (e) => e.preventDefault();
  b.onclick = () => {
    if (tool !== "text") $('[data-tool="text"]').click();
    $("#editor").focus();
    document.execCommand(b.dataset.cmd, false);
    note().html = clean($("#editor").innerHTML);
    touch();
  };
});
$("#notebook").onchange = () => {
  note().book = $("#notebook").value;
  $("#crumb").textContent = book(note()).name;
  touch();
  renderNav();
  $("#notebook").value = note().book;
};
$("#paper").onchange = () => {
  note().paper = $("#paper").value;
  $("#sheet").className = note().paper;
  touch();
};
$("#favorite").onclick = () => {
  note().star = !note().star;
  $("#favorite").textContent = note().star ? "★" : "☆";
  $("#favorite").setAttribute("aria-pressed", note().star);
  touch();
  renderNav();
};
$("#delete").onclick = async () => {
  const r = await modal(
    "Move this note to Trash?",
    `“${note().title || "Untitled note"}” can be restored later from Dashboard.`,
    false,
    "Move to Trash",
  );
  if (!r.ok) return;
  note().deleted = true;
  note().deletedAt = Date.now();
  persist();
  renderNav();
  if (data.notes.some((n) => !n.deleted))
    loadNote(data.notes.find((n) => !n.deleted).id);
  else createNote();
  toast("Moved to Trash");
};
/** Convert a pointer event to the original canvas coordinates. */
function point(e) {
  const r = $("#canvas").getBoundingClientRect();
  return [
    Math.round(((e.clientX - r.left) / r.width) * 800 * 10) / 10,
    Math.round(((e.clientY - r.top) / r.height) * 1050 * 10) / 10,
  ];
}
/** Remove strokes intersecting the original eraser cursor. */
function eraseAt(p) {
  const n = note();
  n.strokes = n.strokes.filter(
    (s) =>
      !s.points.some((q, i) => {
        if (i === 0)
          return Math.hypot(p[0] - q[0], p[1] - q[1]) < 15 + s.width / 2;
        const a = s.points[i - 1],
          dx = q[0] - a[0],
          dy = q[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          );
        return (
          Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <
          15 + s.width / 2
        );
      }),
  );
  redraw();
}
$("#canvas").onpointerdown = (e) => {
  if (tool === "text" || e.button !== 0 || stroke || eraseBefore) return;
  e.preventDefault();
  $("#canvas").setPointerCapture(e.pointerId);
  if (tool === "eraser") {
    eraseBefore = structuredClone(note().strokes);
    eraseAt(point(e));
    return;
  }
  stroke = {
    color: $("#color").value,
    width: Number($("#width").value) * (tool === "highlighter" ? 5 : 1),
    opacity: tool === "highlighter" ? 0.3 : 1,
    points: [point(e)],
  };
  note().strokes.push(stroke);
  redraw();
};
$("#canvas").onpointermove = (e) => {
  if (eraseBefore) {
    eraseAt(point(e));
    return;
  }
  if (!stroke) return;
  stroke.points.push(point(e));
  $("#canvas").lastChild.replaceWith(pathFor(stroke));
};
/** Commit the original pointer stroke and clear its active state. */
function finishStroke() {
  if (eraseBefore) {
    redo = [];
    history.push({
      id: current,
      before: eraseBefore,
      after: structuredClone(note().strokes),
    });
    eraseBefore = null;
    touch();
  }
  if (stroke) {
    history.push({
      id: current,
      before: structuredClone(note().strokes.slice(0, -1)),
      after: structuredClone(note().strokes),
    });
    stroke = null;
    redo = [];
    touch();
  }
}
const history = [];
$("#canvas").onpointerup = finishStroke;
$("#canvas").onpointercancel = finishStroke;
$("#undo").onclick = () => {
  const i = history.findLastIndex((h) => h.id === current);
  if (i < 0) {
    toast("No drawing changes to undo");
    return;
  }
  const h = history.splice(i, 1)[0];
  redo.push(h);
  note().strokes = structuredClone(h.before);
  redraw();
  touch();
};
$("#redo").onclick = () => {
  const h = redo.pop();
  if (!h) {
    toast("No drawing changes to redo");
    return;
  }
  history.push(h);
  note().strokes = structuredClone(h.after);
  redraw();
  touch();
};
/** Create a browser download for an exported note, PDF, or backup. */
function download(text, name, type) {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$("#backup").onclick = () =>
  download(
    JSON.stringify(data, null, 2),
    "leafnote-backup-" + new Date().toISOString().slice(0, 10) + ".json",
    "application/json",
  );
$("#restore").onclick = () => {
  $("#backupfile").value = "";
  $("#backupfile").click();
};
$("#backupfile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > 20 * 1024 * 1024) throw Error("Backup exceeds 20 MB");
    const imported = validate(JSON.parse(await f.text()));
    const r = await modal(
      "Import backup?",
      "This replaces notes on this device. Export a backup first if you want to keep them.",
      false,
      "Replace notes",
    );
    if (!r.ok) return;
    data = imported;
    history.length = 0;
    filter = "all";
    persist();
    renderNav();
    loadNote(data.notes[0]?.id);
    toast("Backup imported");
  } catch (err) {
    toast("Could not import: " + err.message);
  }
};
$("#export").onclick = () => {
  const n = note();
  const svg = $("#canvas").outerHTML;
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(n.title || "Untitled note")}</title><style>body{font:18px/1.8 Georgia,serif;max-width:800px;margin:50px auto;padding:25px;color:#29332e}.surface{position:relative;height:${$("#surface").offsetHeight}px}.text{position:absolute;inset:0}svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}h1{line-height:1.3}button{padding:10px;margin-bottom:25px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>${escapeText(n.title || "Untitled note")}</h1><div class="surface"><div class="text">${clean(n.html)}</div>${svg}</div></body></html>`;
  download(
    body,
    (n.title || "Untitled note").replace(/[^a-z0-9 _-]/gi, "").slice(0, 80) +
      ".html",
    "text/html",
  );
  toast("Exported note. Open it to print or save as PDF.");
};
window.addEventListener("beforeunload", () => persist());
// Startup is handled by features.js after local database migration.
