/** @file Search UI, PDF/handwriting indexing, recognition-worker messages, result highlighting, and protected transcript review. */
(function () {
  "use strict";
  const S = LeafSearch;
  let busy = false,
    cancelled = false,
    worker = null,
    nextRequest = 0,
    pending = new Map(),
    reviewTarget = null,
    currentHits = null,
    autoTimer = null,
    jobError = "";
  const attempted = new Set();
  /** Access the active application bridge from the search module. */
  const app = () => window.LeafnoteApp,
    reviewDrafts = new Map();
  /** Update the search/indexing status message. */
  function status(text) {
    $("#indexstatus").textContent = text;
  }
  /** Create a short readable result excerpt around the first matching term. */
  function snippets(text, query) {
    const folded = S.norm(text),
      term = S.norm(query).split(" ")[0],
      i = folded.indexOf(term),
      start = Math.max(0, i - 35);
    return (
      (start ? "…" : "") +
      text.slice(start, start + 155).replace(/\s+/g, " ") +
      (text.length > start + 155 ? "…" : "")
    );
  }
  /** Build safely escaped highlighted text for search results. */
  function mark(text, query) {
    const terms = S.norm(query).split(" ").filter(Boolean),
      parts = String(text).split(/(\s+)/);
    return parts
      .map((p) =>
        terms.some((t) => S.norm(p).includes(t))
          ? "<mark>" + escapeText(p) + "</mark>"
          : escapeText(p),
      )
      .join("");
  }
  /** Apply the selected notebook/favorite filter to the note list. */
  function eligible(n) {
    return (
      filter === "all" || (filter === "star" && n.star) || n.book === filter
    );
  }
  /** List pages with missing PDF text or outdated handwriting recognition. */
  function workItems(includeInk = true, includePdf = true) {
    const result = [];
    for (const n of data.notes)
      for (const [i, p] of (n.pdf ? n.pdf.pages : [n]).entries()) {
        if (includePdf && n.pdf && p.pdfText === undefined)
          result.push(n.id + ":pdf:" + i);
        if (
          includeInk &&
          p.strokes?.some((s) => s.opacity !== 0.3) &&
          !S.currentIndex(p)
        )
          result.push(
            n.id +
              ":ink:" +
              i +
              ":" +
              S.signature(p.strokes) +
              ":" +
              S.language(p),
          );
      }
    return result;
  }
  /** Debounce automatic indexing and avoid retries while review/editing is active. */
  function scheduleIndex() {
    clearTimeout(autoTimer);
    if (
      !$("#search").value.trim() ||
      busy ||
      (reviewTarget && !$("#recognitionreview").hidden) ||
      !$("#autohandwriting").checked
    )
      return;
    const kind = $("#searchkind").value,
      includeInk = kind === "all" || kind === "handwriting",
      includePdf = kind === "all" || kind === "pdf";
    const items = workItems(includeInk, includePdf).filter(
      (k) => !attempted.has(k),
    );
    if (!items.length) return;
    autoTimer = setTimeout(() => {
      if (
        busy ||
        !$("#search").value.trim() ||
        (reviewTarget && !$("#recognitionreview").hidden)
      )
        return;
      items.forEach((k) => attempted.add(k));
      indexAll({ automatic: true, includeInk, includePdf });
    }, 650);
  }
  /** Summarize searchable content and missing recognition for the current results. */
  function coverage() {
    let ink = 0,
      indexed = 0,
      empty = 0,
      cards = 0,
      boards = 0;
    for (const n of data.notes) {
      if (n.board) {
        boards++;
        cards += n.board.nodes.length;
      }
      for (const p of n.pdf ? n.pdf.pages : [n])
        if (p.strokes?.some((s) => s.opacity !== 0.3)) {
          ink++;
          const index = S.currentIndex(p);
          if (index) {
            indexed++;
            if (!index.text.trim()) empty++;
          }
        }
    }
    $("#searchcoverage").textContent =
      data.notes.length +
      " notes · " +
      boards +
      " boards · " +
      cards +
      " cards · Handwriting " +
      indexed +
      "/" +
      ink +
      " pages indexed" +
      (empty ? " (" + empty + " unreadable)" : "");
  }
  /** Render this module’s controls from the current note and UI state. */
  function render() {
    const query = $("#search").value.trim(),
      kind = $("#searchkind").value;
    if (query) {
      const results = S.search(data, query, kind);
      $("#listtitle").textContent = "Search results";
      $("#results").textContent =
        results.length + " page" + (results.length === 1 ? "" : "s");
      $("#notes").innerHTML = results.length
        ? results
            .map(
              (r) =>
                `<button class="note search-result ${r.id === current ? "active" : ""}" data-result-id="${escapeText(r.id)}" data-result-page="${r.page}"><span class="tag">${escapeText(data.books.find((b) => b.id === r.book)?.name || "Notes")}${r.pdf ? " · Page " + (r.page + 1) : ""}</span><h3>${mark(r.title, query)}</h3><div class="preview">${mark(snippets(r.text, query), query)}</div><div class="meta"><span>${r.matches
                  .map(
                    (m) =>
                      ({
                        title: "Name",
                        typed: "Typed text",
                        pdf: "PDF text",
                        handwriting: "Handwriting",
                      })[m.kind],
                  )
                  .filter((x, i, a) => a.indexOf(x) === i)
                  .join(" · ")}</span></div></button>`,
            )
            .join("")
        : '<div class="empty">No matches yet. Try another word, or index your handwriting and PDF text.</div>';
      $("#searchscope").textContent = "Searching all notebooks";
    } else {
      const notes = data.notes
        .filter(eligible)
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
      $("#results").textContent = notes.length + " notes";
      $("#notes").innerHTML =
        notes
          .map((n) => {
            const text = n.pdf
                ? n.pdf.name
                : (n.texts || []).map((t) => t.text).join(" ") ||
                  n.board?.nodes.map((c) => c.text).join(" ") ||
                  plain(n.html),
              hasInk = (n.pdf ? n.pdf.pages : [n]).some((p) =>
                p.strokes?.some((s) => s.opacity !== 0.3),
              ),
              fresh = (n.pdf ? n.pdf.pages : [n]).every(
                (p) =>
                  !p.strokes?.some((s) => s.opacity !== 0.3) ||
                  S.currentIndex(p),
              );
            return `<button class="note ${n.id === current ? "active" : ""}" data-id="${escapeText(n.id)}"><span class="tag">${escapeText(book(n).name)}</span><h3>${escapeText(n.title || "Untitled note")}${n.star ? " ☆" : ""}</h3><div class="preview">${escapeText(text.slice(0, 140) || "A blank page, ready for you.")}</div><div class="meta"><span>${n.pdf ? "PDF · " + n.pdf.pages.length + " pages" : n.board ? "Brainstorm board" : "Paper note"}</span><span>${hasInk ? (fresh ? "Ink indexed" : "Ink needs indexing") : ""}</span></div></button>`;
          })
          .join("") || '<div class="empty">No notes here yet.</div>';
      $("#searchscope").textContent =
        "Names · typed text · PDF text · handwriting";
    }
    let other = 0;
    if (query && kind !== "all") {
      const visible = new Set(
        S.search(data, query, kind).map((h) => h.id + ":" + h.page),
      );
      other = S.search(data, query, "all").filter(
        (r) => !visible.has(r.id + ":" + r.page),
      ).length;
    }
    $("#searchallcontent").hidden = !other;
    $("#searchallcontent").textContent =
      "Show " +
      other +
      " more match" +
      (other === 1 ? "" : "es") +
      " in all content";
    if (query)
      $("#searchscope").textContent =
        "All notebooks · " +
        ({
          all: "All content",
          typed: "Typed text & ideas only",
          handwriting: "Handwriting only",
          pdf: "PDF text only",
        }[kind] || "All content");
    $("#clearsearch").hidden = !query;
    coverage();
    if (query && busy && !$("#notes .search-pending")) {
      const message = document.createElement("div");
      message.className = "search-pending";
      message.textContent =
        "Handwriting/PDF indexing is running. Results will update as pages finish.";
      $("#notes").append(message);
    }
  }
  /** Create the recognition worker and bind progress, result, and error messages. */
  function setupWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./recognition-worker.js?v=4", location.href), {
      type: "module",
    });
    worker.onmessage = ({ data: m }) => {
      if (m.type === "progress") {
        status(
          m.status === "progress"
            ? "Downloading handwriting model… " +
                Math.round(m.progress || 0) +
                "%"
            : "Preparing handwriting recognition…",
        );
        return;
      }
      const job = pending.get(m.id);
      if (!job) return;
      pending.delete(m.id);
      clearTimeout(job.timer);
      m.type === "error"
        ? job.reject(Error(m.error))
        : job.resolve({
            text: m.text || "",
            alternatives: m.alternatives || [],
          });
    };
    worker.onerror = (e) => {
      for (const job of pending.values()) {
        clearTimeout(job.timer);
        job.reject(Error(e.message || "Handwriting worker failed"));
      }
      pending.clear();
      worker.terminate();
      worker = null;
    };
    return worker;
  }
  /** Submit one rasterized line to the worker with timeout and cancellation handling. */
  function recognize(image, language = "en") {
    const id = ++nextRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Recognition timed out. Try fewer words or retry."));
        if (worker) {
          worker.terminate();
          worker = null;
        }
      }, 240000);
      pending.set(id, { resolve, reject, timer });
      try {
        setupWorker().postMessage(
          {
            id,
            language,
            pixels: image.data.buffer,
            width: image.width,
            height: image.height,
          },
          [image.data.buffer],
        );
      } catch (e) {
        pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  /** Render a grouped ink line as a normalized black-on-white image. */
  async function raster(line) {
    const pad = Math.max(10, line.height * 0.2),
      scale = Math.min(
        3,
        96 / Math.max(12, line.height),
        2048 / (line.width + pad * 2),
      ),
      svg = document.createElementNS(NS, "svg");
    svg.setAttribute("xmlns", NS);
    svg.setAttribute(
      "viewBox",
      `${line.x - pad} ${line.y - pad} ${line.width + pad * 2} ${line.height + pad * 2}`,
    );
    svg.setAttribute(
      "width",
      Math.max(32, Math.ceil((line.width + pad * 2) * scale)),
    );
    svg.setAttribute(
      "height",
      Math.max(32, Math.ceil((line.height + pad * 2) * scale)),
    );
    const bg = document.createElementNS(NS, "rect");
    for (const [k, v] of Object.entries({
      x: line.x - pad,
      y: line.y - pad,
      width: line.width + pad * 2,
      height: line.height + pad * 2,
      fill: "white",
    }))
      bg.setAttribute(k, v);
    svg.append(bg);
    for (const stroke of line.strokes) {
      const p = pathFor({ ...stroke, color: "#000000", opacity: 1 });
      svg.append(p);
    }
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = Number(svg.getAttribute("width"));
      c.height = Number(svg.getAttribute("height"));
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  /** Index PDF text and unreviewed handwriting while preserving user corrections. */
  async function indexAll(options = {}) {
    if (busy) {
      if (!options.automatic) {
        cancelled = true;
        status("Stopping after the current line…");
      }
      return;
    }
    clearTimeout(autoTimer);
    if (!options.automatic) attempted.clear();
    const includeInk = options.includeInk !== false,
      includePdf = options.includePdf !== false;
    workItems(includeInk, includePdf).forEach((k) => attempted.add(k));
    app().finish();
    window.LeafBoard?.finish();
    busy = true;
    cancelled = false;
    jobError = "";
    $("#indexnotes").textContent = "Stop indexing";
    let indexed = 0,
      failures = 0,
      scans = 0,
      unreadable = 0;
    render();
    try {
      const targets = data.notes.slice();
      for (const n of targets) {
        if (cancelled) break;
        if (!data.notes.includes(n)) continue;
        let pdf;
        try {
          if (
            includePdf &&
            n.pdf &&
            n.pdf.pages.some((p) => p.pdfText === undefined)
          ) {
            status("Reading PDF text: " + (n.title || "Untitled PDF"));
            const file = await app().file(n.id);
            if (!file) throw Error("Original PDF is missing");
            const lib = await app().pdfLibrary();
            pdf = await lib.getDocument(
              app().pdfOptions(await file.arrayBuffer()),
            ).promise;
          }
          const pages = n.pdf ? n.pdf.pages : [n];
          for (let i = 0; i < pages.length; i++) {
            if (cancelled) break;
            const pg = pages[i];
            if (pdf && pg.pdfText === undefined) {
              const page = await pdf.getPage(i + 1),
                text = await page.getTextContent();
              pg.pdfText = text.items
                .map((t) => t.str + (t.hasEOL ? "\n" : " "))
                .join("")
                .slice(0, 1000000);
              if (!pg.pdfText.trim()) scans++;
            }
            const signature = S.signature(pg.strokes),
              language = S.language(pg);
            if (
              !includeInk ||
              S.currentIndex(pg) ||
              !pg.strokes?.some((s) => s.opacity !== 0.3)
            )
              continue;
            const output = [],
              rows = S.lines(pg.strokes);
            for (let j = 0; j < rows.length; j++) {
              if (cancelled) break;
              status(
                "Recognizing " +
                  (n.title || "Untitled note") +
                  (n.pdf ? " · Page " + (i + 1) : "") +
                  " · line " +
                  (j + 1) +
                  "/" +
                  rows.length,
              );
              const line = rows[j],
                recognized = await recognize(await raster(line), language),
                text = recognized.text.trim();
              output.push({
                text,
                alternatives: recognized.alternatives,
                rect: {
                  x: line.x,
                  y: line.y,
                  width: line.width,
                  height: line.height,
                },
              });
            }
            if (
              !cancelled &&
              signature === S.signature(pg.strokes) &&
              language === S.language(pg) &&
              data.notes.includes(n) &&
              !S.currentIndex(pg)?.reviewed
            ) {
              pg.handwriting = {
                version: language === "mr" ? 3 : 2,
                language,
                signature,
                text: output.map((l) => l.text).join("\n"),
                lines: output,
                reviewed: false,
                updated: Date.now(),
              };
              indexed++;
              if (!pg.handwriting.text.trim()) unreadable++;
              await persist();
              render();
            }
          }
          await persist();
        } catch (e) {
          failures++;
          jobError = (n.title || "Untitled note") + ": " + e.message;
          status("Could not index " + jobError);
        } finally {
          if (pdf) await pdf.loadingTask.destroy();
        }
      }
      status(
        (cancelled
          ? "Stopped. "
          : failures
            ? "Indexing incomplete. "
            : "Index ready. ") +
          indexed +
          " handwriting page" +
          (indexed === 1 ? "" : "s") +
          " updated." +
          (failures
            ? " " +
              failures +
              " failed. " +
              jobError +
              ". Try Index all notes again."
            : "") +
          (unreadable
            ? " " +
              unreadable +
              " page(s) had no readable handwriting. Open Review handwriting search text to correct it."
            : "") +
          (scans
            ? " Some PDFs are image-only; their background text was not indexed."
            : ""),
      );
    } finally {
      busy = false;
      $("#indexnotes").textContent = "Index all notes";
      render();
      scheduleIndex();
    }
  }
  /** Retain unsaved transcript edits for the active note/page/signature. */
  function keepReviewDraft() {
    if (!reviewTarget) return;
    const text = $("#inktranscript").value;
    if (text !== reviewTarget.baseText)
      reviewDrafts.set(reviewTarget.key, text);
    else reviewDrafts.delete(reviewTarget.key);
  }
  /** Refresh transcript save/discard controls and unsaved-edit status. */
  function reviewChanged() {
    if (!reviewTarget) return;
    keepReviewDraft();
    const dirty = $("#inktranscript").value !== reviewTarget.baseText;
    $("#reviewstatus").textContent = dirty
      ? "Unsaved corrections. Choose Save corrections to update search."
      : reviewTarget.baseReviewed
        ? "Saved corrections are used for search."
        : "Edit the recognized text, then save your corrections.";
    $("#discardreview").disabled = !dirty;
    $("#savetranscript").disabled = !dirty && reviewTarget.baseReviewed;
  }
  /** Open the current page’s handwriting review while retaining prior drafts. */
  function review() {
    keepReviewDraft();
    app().finish();
    window.LeafBoard?.finish();
    const p = app().page(),
      index = p.handwriting,
      signature = S.signature(p.strokes),
      language = S.language(p),
      page = app().pageIndex(),
      key = current + ":" + page + ":" + signature + ":" + language;
    reviewTarget = {
      id: current,
      page,
      signature,
      language,
      key,
      baseText:
        index?.reviewed || (index?.language || "en") === language
          ? index?.text || ""
          : "",
      baseReviewed: !!index?.reviewed,
    };
    $("#recognitionlanguage").value = language;
    $("#languagehint").textContent =
      language === "mr"
        ? "Marathi / Devanagari recognition is experimental. Install its model in Language models, then try recognition again and review the result."
        : "English handwriting recognition. Downloaded models are managed in Language models.";
    $("#inktranscript").value = reviewDrafts.has(key)
      ? reviewDrafts.get(key)
      : reviewTarget.baseText;
    $("#recognitionreview").hidden = false;
    $("#reviewhint").textContent =
      "Click between letters. Use Backspace or Delete to remove extra characters, and type missing letters. This changes search text; your ink stays unchanged.";
    $("#reviewtitle").textContent =
      "Edit recognized text — " +
      (note().title || "Untitled note") +
      (note().pdf ? " · Page " + (page + 1) : "");
    reviewChanged();
    $("#inktranscript").focus();
    $("#inktranscript").setSelectionRange(0, 0);
  }
  /** Persist reviewed transcript corrections without changing the underlying ink. */
  async function saveReview() {
    if (!reviewTarget) return;
    const target = reviewTarget,
      n = data.notes.find((n) => n.id === target.id),
      pg = n?.pdf ? n.pdf.pages[target.page] : n;
    if (!pg) return;
    if (
      target.signature !== S.signature(pg.strokes) ||
      target.language !== S.language(pg)
    ) {
      toast("The ink changed. Reopen the handwriting review.");
      return;
    }
    const text = $("#inktranscript").value.slice(0, 100000);
    pg.handwriting = {
      version: 2,
      language: target.language,
      signature: target.signature,
      text,
      reviewed: true,
      lines: [],
      updated: Date.now(),
    };
    $("#savetranscript").disabled = true;
    $("#reviewstatus").textContent = "Saving corrections…";
    const saved = await persist();
    render();
    if (reviewTarget !== target) return;
    if (saved) {
      target.baseText = text;
      target.baseReviewed = true;
      reviewDrafts.delete(target.key);
      reviewChanged();
      $("#reviewstatus").textContent =
        "Corrections saved. Search now uses this text.";
      toast("Handwriting corrections saved");
    } else {
      $("#savetranscript").disabled = false;
      $("#reviewstatus").textContent =
        "Could not save corrections. Keep this page open and retry.";
    }
  }
  /** Create a new recognition draft without overwriting the saved transcript. */
  async function retryReview() {
    if (!reviewTarget) return;
    if (busy) {
      $("#reviewstatus").textContent =
        "Wait for the current recognition job to finish, then try again.";
      return;
    }
    if ($("#inktranscript").value !== reviewTarget.baseText) {
      $("#reviewstatus").textContent =
        "Save or discard your edits before trying recognition again.";
      return;
    }
    const target = reviewTarget,
      n = data.notes.find((n) => n.id === target.id),
      pg = n?.pdf ? n.pdf.pages[target.page] : n;
    if (!pg) return;
    const rows = S.lines(pg.strokes);
    if (!rows.length) {
      $("#reviewstatus").textContent =
        "There are no pen strokes on this page to recognize.";
      return;
    }
    busy = true;
    $("#retryrecognition").disabled = true;
    $("#indexnotes").disabled = true;
    attempted.add(
      n.id +
        ":ink:" +
        target.page +
        ":" +
        target.signature +
        ":" +
        target.language,
    );
    try {
      const output = [];
      for (let i = 0; i < rows.length; i++) {
        $("#reviewstatus").textContent =
          "Trying recognition again · line " + (i + 1) + "/" + rows.length;
        output.push(
          (await recognize(await raster(rows[i]), target.language)).text.trim(),
        );
      }
      if (
        target.signature !== S.signature(pg.strokes) ||
        target.language !== S.language(pg)
      )
        throw Error("The ink changed. Reopen the handwriting review.");
      const text = output.join("\n");
      reviewDrafts.set(target.key, text);
      if (reviewTarget === target) {
        $("#inktranscript").value = text;
        reviewChanged();
        $("#reviewstatus").textContent =
          text === target.baseText
            ? "The new reading matches the saved text."
            : "New reading ready as a draft. Review it and choose Save corrections; your saved text has not been replaced.";
      }
    } catch (e) {
      if (reviewTarget === target)
        $("#reviewstatus").textContent =
          "Could not retry recognition: " +
          e.message +
          ". Your saved text is unchanged.";
    } finally {
      busy = false;
      $("#retryrecognition").disabled = false;
      $("#indexnotes").disabled = false;
      render();
      scheduleIndex();
    }
  }
  /** Remove temporary search highlights from the note surface. */
  function clearHits() {
    $("#searchoverlay")?.remove();
    currentHits = null;
  }
  /** Render result bounds and scroll the matching content into view. */
  function showHits(hit) {
    clearHits();
    if (!hit.rects.length) return;
    const svg = document.createElementNS(NS, "svg");
    svg.id = "searchoverlay";
    svg.setAttribute("viewBox", $("#canvas").getAttribute("viewBox"));
    svg.setAttribute("preserveAspectRatio", "none");
    for (const r of hit.rects) {
      const rect = document.createElementNS(NS, "rect");
      for (const [k, v] of Object.entries({
        x: r.x - 4,
        y: r.y - 4,
        width: r.width + 8,
        height: r.height + 8,
        fill: "#e8bc3f",
        "fill-opacity": 0.25,
        stroke: "#c5a024",
        "stroke-width": 1,
      }))
        rect.setAttribute(k, v);
      svg.append(rect);
    }
    $("#surface").append(svg);
    currentHits = hit;
    const r = hit.rects[0],
      scale =
        $("#surface").getBoundingClientRect().width /
        $("#canvas").viewBox.baseVal.width;
    $(".workspace").scrollTop = Math.max(0, r.y * scale - 120);
    if (note().board)
      $(".workspace").scrollLeft = Math.max(0, r.x * scale - 120);
  }
  /** Attach this module’s event handlers after the application state is ready. */
  function setup() {
    renderList = render;
    $("#search").placeholder = "Search all notes";
    $("#search").setAttribute("aria-label", "Search all notes and handwriting");
    $("#search").oninput = () => {
      clearHits();
      render();
      scheduleIndex();
    };
    $("#sort").onchange = render;
    $("#searchkind").onchange = () => {
      render();
      scheduleIndex();
    };
    $("#searchallcontent").onclick = () => {
      $("#searchkind").value = "all";
      render();
      scheduleIndex();
    };
    $("#autohandwriting").onchange = () => {
      if ($("#autohandwriting").checked) scheduleIndex();
      else clearTimeout(autoTimer);
    };
    $("#clearsearch").onclick = () => {
      clearTimeout(autoTimer);
      $("#search").value = "";
      clearHits();
      render();
      $("#search").focus();
    };
    $("#indexnotes").onclick = indexAll;
    $("#reviewhandwriting").onclick = review;
    document.addEventListener("click", async (e) => {
      const result = e.target.closest("[data-result-id]");
      if (result) {
        const hits = S.search(data, $("#search").value, $("#searchkind").value),
          hit = hits.find(
            (h) =>
              h.id === result.dataset.resultId &&
              h.page === Number(result.dataset.resultPage),
          );
        if (!hit) return;
        await app().open(hit.id, hit.page);
        showHits(hit);
        render();
      }
    });
    $("#recognitionlanguage").onchange = () => {
      keepReviewDraft();
      app().page().recognitionLanguage = $("#recognitionlanguage").value;
      persist();
      review();
      $("#reviewstatus").textContent =
        "Language saved. Choose Try recognition again to create a new reading for this page.";
    };
    document.addEventListener("leafnote-language-selected", (e) => {
      if (!["en", "mr"].includes(e.detail?.id)) return;
      $("#recognitionlanguage").value = e.detail.id;
      $("#recognitionlanguage").onchange();
    });
    document.addEventListener("leafnote-model-installed", () => {
      attempted.clear();
      scheduleIndex();
    });
    document.addEventListener("leafnote-model-removed", () => {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      for (const job of pending.values()) {
        clearTimeout(job.timer);
        job.reject(
          Error("Recognition stopped because a language model was removed."),
        );
      }
      pending.clear();
    });
    $("#reviewinksearch").onclick = review;
    $("#savetranscript").onclick = saveReview;
    $("#retryrecognition").onclick = retryReview;
    $("#inktranscript").oninput = reviewChanged;
    $("#discardreview").onclick = () => {
      if (!reviewTarget) return;
      $("#inktranscript").value = reviewTarget.baseText;
      reviewDrafts.delete(reviewTarget.key);
      reviewChanged();
      $("#inktranscript").focus();
    };
    $("#cancelreview").onclick = () => {
      keepReviewDraft();
      $("#recognitionreview").hidden = true;
      reviewTarget = null;
    };
    const load = loadNote;
    loadNote =
      /** Open a note, update its controls, and refresh its drawing surface. */
      function (id) {
        keepReviewDraft();
        reviewTarget = null;
        clearHits();
        $("#recognitionreview").hidden = true;
        load(id);
      };
    const basePersist = persist;
    persist =
      /** Queue a snapshot for device storage; report storage errors without discarding the current note. */
      function () {
        if (currentHits) clearHits();
        const result = basePersist();
        scheduleIndex();
        return result;
      };
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        $(".app").classList.add("showlist");
        $("#search").focus();
        $("#search").select();
      }
    });
    render();
  }
  if (window.LeafnoteApp?.ready) setup();
  else document.addEventListener("leafnote-ready", setup, { once: true });
})();
