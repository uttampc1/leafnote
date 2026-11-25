/** @file Default thumbnail library with a remembered list alternative and lazy local PDF previews. */
(function () {
  "use strict";
  /** Attach the library overview after editing, search, and minimalist controls are ready. */
  function setup() {
    const app = $(".app"),
      list = $("#notes"),
      originalToggle = $("#mobile").onclick,
      cache = new Map(),
      jobs = [];
    let mode = "grid",
      active = 0,
      observer;
    try {
      mode =
        localStorage.getItem("leafnote-library-view-v1") === "list"
          ? "list"
          : "grid";
    } catch {}
    /** Release old preview canvases; only a small number of PDF pages remain cached. */
    function trim() {
      for (const [key, value] of cache) {
        if (cache.size <= 12) break;
        if (!value.pending) cache.delete(key);
      }
    }
    /** Run at most two independent thumbnail PDF renders at once. */
    function pump() {
      while (active < 2 && jobs.length) {
        const job = jobs.shift();
        active++;
        job().finally(() => {
          active--;
          trim();
          pump();
        });
      }
    }
    /** Load a local PDF page independently of the editor and verify that its card is still current. */
    async function pdf(note, index, frame) {
      const key =
        note.id +
        ":" +
        index +
        ":" +
        window.LeafnoteApp.sync.fileVersion(note.id);
      let entry = cache.get(key);
      if (!entry) {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        entry = { canvas, pending: true };
        cache.set(key, entry);
        entry.ready = new Promise((resolve) =>
          jobs.push(async () => {
            let task;
            try {
              const blob = await window.LeafnoteApp.file(note.id);
              if (!blob) throw Error("PDF unavailable");
              const lib = await window.LeafnoteApp.pdfLibrary();
              task = lib.getDocument(
                window.LeafnoteApp.pdfOptions(await blob.arrayBuffer()),
              );
              const documentPDF = await task.promise,
                page = await documentPDF.getPage(index + 1),
                size = page.getViewport({ scale: 1 }),
                viewport = page.getViewport({
                  scale: Math.min(400 / size.width, 500 / size.height),
                });
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              await page.render({
                canvasContext: canvas.getContext("2d"),
                viewport,
              }).promise;
              entry.ok = true;
            } catch {
              entry.ok = false;
              cache.delete(key);
            } finally {
              try {
                await task?.destroy();
              } catch {}
              entry.pending = false;
              resolve();
            }
          }),
        );
        pump();
      }
      await entry.ready;
      if (!frame.isConnected) return;
      if (entry.ok) {
        frame.prepend(entry.canvas);
        frame.dataset.pdfPreview = "ready";
      } else {
        const hint = document.createElement("small");
        hint.className = "preview-unavailable";
        hint.textContent = "PDF preview unavailable";
        frame.append(hint);
        frame.dataset.pdfPreview = "unavailable";
      }
    }
    /** Decorate a visible result with a read-only preview of its note or matched PDF page. */
    function fill(button) {
      if (button.dataset.previewReady) return;
      button.dataset.previewReady = "true";
      const id = button.dataset.id || button.dataset.resultId,
        n = data.notes.find((n) => n.id === id && !n.deleted);
      if (!n) return;
      const index = Number(button.dataset.resultPage) || 0,
        frame = document.createElement("span");
      frame.className = "note-thumbnail";
      frame.setAttribute("aria-hidden", "true");
      frame.append(LeafPreview.render(n, index));
      button.prepend(frame);
      if (n.pdf) pdf(n, index, frame);
    }
    /** Observe newly rendered cards, including search results rendered by search.js closures. */
    function decorate() {
      observer?.disconnect();
      if (!app.classList.contains("library-home") || mode !== "grid") return;
      for (const button of list.querySelectorAll(".note")) {
        if (observer) observer.observe(button);
        else fill(button);
      }
    }
    /** Remember Grid/List as a device preference, independent of notebook content and sync. */
    function selectMode(next) {
      mode = next === "list" ? "list" : "grid";
      app.classList.toggle("notes-grid", mode === "grid");
      app.classList.toggle("notes-list", mode === "list");
      $("#viewgrid").setAttribute("aria-pressed", String(mode === "grid"));
      $("#viewlist").setAttribute("aria-pressed", String(mode === "list"));
      try {
        localStorage.setItem("leafnote-library-view-v1", mode);
      } catch {}
      decorate();
    }
    /** Open the roomy note overview without changing the selected note. */
    function open(initial = false) {
      window.LeafnoteApp.finish();
      window.LeafBoard?.finish();
      if (
        !initial &&
        (app.classList.contains("focus-mode") ||
          app.classList.contains("library-hidden") ||
          (innerWidth <= 760 && !app.classList.contains("showlist")))
      )
        originalToggle();
      app.classList.add("library-home");
      $("#mobile").setAttribute("aria-expanded", "true");
      decorate();
    }
    /** Return to the current writing surface with the compact library tucked away. */
    function close() {
      app.classList.remove("library-home");
      if (
        (innerWidth > 760 &&
          !app.classList.contains("library-hidden") &&
          !app.classList.contains("focus-mode")) ||
        (innerWidth <= 760 && app.classList.contains("showlist"))
      )
        originalToggle();
      $("#mobile").setAttribute("aria-expanded", "false");
      window.LeafnoteApp.resize();
      $("#mobile").focus();
    }
    if (window.IntersectionObserver)
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              observer.unobserve(entry.target);
              fill(entry.target);
            }
        },
        { root: list, rootMargin: "250px" },
      );
    new MutationObserver(decorate).observe(list, { childList: true });
    $("#viewgrid").onclick = () => selectMode("grid");
    $("#viewlist").onclick = () => selectMode("list");
    $("#continuewriting").onclick = close;
    $("#mobile").onclick = () =>
      app.classList.contains("library-home") ? close() : open();
    document.addEventListener(
      "click",
      (event) => {
        if (
          app.classList.contains("library-home") &&
          event.target.closest(
            "#notes [data-id],#notes [data-result-id],#new,.listbar button:not(#viewgrid):not(#viewlist)",
          )
        )
          close();
      },
      true,
    );
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")
        open();
    });
    document.addEventListener("leafnote-local-saved", () => {
      if (!app.classList.contains("library-home")) return;
      requestAnimationFrame(() => {
        if (app.classList.contains("library-home")) {
          renderList();
        }
      });
    });
    $("#librarymaintenance").onclick = () => $("#maintenance").click();
    $("#libraryboard").onclick = () => {
      close();
      $("#newboard").click();
    };
    $("#librarypdf").onclick = () => $("#importpdf").click();
    document
      .querySelector('input[type="file"][accept*="pdf"]')
      ?.addEventListener("change", (event) => {
        if (event.target.files.length) close();
      });
    selectMode(mode);
    open(true);
    window.LeafLibrary = { open, close };
  }
  if (window.LeafnoteApp?.ready) setup();
  else document.addEventListener("leafnote-ready", setup, { once: true });
})();
