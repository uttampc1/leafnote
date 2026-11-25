/** @file Continuous page reading with the existing active-page editor reused in place. */
(function () {
  "use strict";
  /** Show all pages vertically and activate a clicked page without losing document scroll position. */
  function setup() {
    const app = window.LeafnoteApp,
      workspace = $(".workspace"),
      sheet = $("#sheet"),
      foot = $(".workspace-foot");
    let activating = false,
      observer;
    /** Lazy paint a PDF preview only when it approaches the scroll viewport. */
    function pdfFrame(frame, n, index) {
      if (window.IntersectionObserver) {
        observer.observe(frame);
        frame._pageNote = n;
        frame._pageNumber = index;
      } else window.LeafLibrary.previewPDF(n, index, frame);
    }
    if (window.IntersectionObserver)
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              observer.unobserve(entry.target);
              window.LeafLibrary.previewPDF(
                entry.target._pageNote,
                entry.target._pageNumber,
                entry.target,
              );
            }
        },
        { root: workspace, rootMargin: "300px" },
      );
    /** Rebuild read-only neighbors while retaining the actual canvas and editor nodes. */
    function render(scroll = false) {
      observer?.disconnect();
      const n = note();
      if (!n) return;
      const pages = LeafSearch.pages(n),
        active = app.pageIndex(),
        nodes = [];
      for (let i = 0; i < pages.length; i++) {
        if (i === active) {
          nodes.push(sheet);
          if (!n.board) {
            const add = document.createElement("button");
            add.className = "insert-page-inline";
            add.textContent = "Add page after page " + (i + 1);
            add.onclick = () => $("#addpaperpage").click();
            nodes.push(add);
          }
          continue;
        }
        const article = document.createElement("article"),
          label = document.createElement("button"),
          frame = document.createElement("div"),
          pg = pages[i];
        article.className = "document-page-preview";
        article.dataset.page = String(i);
        label.className = "edit-page-label";
        label.textContent = "Page " + (i + 1) + " · click to edit";
        frame.className = "document-page-surface";
        frame.style.aspectRatio =
          (pg.width || 800) + " / " + (pg.height || 1050);
        frame.append(LeafPreview.render(n, i));
        article.append(label, frame);
        nodes.push(article);
        /** Preserve the clicked page's on-screen position as it becomes the editable page. */
        async function activate(event) {
          if (activating) return;
          activating = true;
          const top = frame.getBoundingClientRect().top,
            ink =
              event?.type === "pointerdown" &&
              event.target.closest(".document-page-surface") &&
              !n.pdf;
          try {
            await app.goToPage(i);
            render(false);
            workspace.scrollTop +=
              $("#surface").getBoundingClientRect().top - top;
            if (ink) await $("#canvas").onpointerdown(event);
          } finally {
            activating = false;
          }
        }
        label.onclick = activate;
        frame.onpointerdown = (event) => {
          if (event.pointerType === "touch") return;
          event.preventDefault();
          event.stopPropagation();
          activate(event);
        };
        if (n.pdf) pdfFrame(frame, n, i);
      }
      workspace.replaceChildren(...nodes, ...(foot ? [foot] : []));
      if (scroll)
        workspace.scrollTop = Math.max(
          0,
          sheet.offsetTop - workspace.offsetTop - 20,
        );
    }
    document.addEventListener("leafnote-page-changed", () => {
      if (!activating) render(true);
    });
    window.LeafDocument = {
      /** Implement the busy callback in this object. */ busy: () => activating,
    };
    render(false);
  }
  if (window.LeafnoteApp?.ready) setup();
  else document.addEventListener("leafnote-ready", setup, { once: true });
})();
