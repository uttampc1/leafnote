/** @file Numbered page controls and continuous reading around the one active editor. */
(function () {
  "use strict";
  /** Keep Add/Move/Delete tied to the displayed page rather than an implicit first-page selection. */
  function setup() {
    const app = window.LeafnoteApp,
      workspace = $(".workspace"),
      sheet = $("#sheet"),
      foot = $(".workspace-foot");
    let activating = false,
      observer;
    /** Observe PDF neighbors without loading every page at once. */
    function pdfFrame(frame, n, index) {
      frame._pageNote = n;
      frame._pageNumber = index;
      if (observer) observer.observe(frame);
      else window.LeafLibrary.previewPDF(n, index, frame);
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
    /** Create an actual button with an accessible label and an explicit operation. */
    function button(text, action, disabled = false) {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.onclick = action;
      element.disabled = disabled;
      return element;
    }
    /** Return a labeled action menu for a specific page position. */
    function controls(n, index, count, selected, activate) {
      const header = document.createElement("div");
      header.className =
        "page-controls" + (selected ? " current-page-controls" : "");
      header.dataset.pageControls = String(index);
      const label = selected
        ? document.createElement("span")
        : button("Page " + (index + 1) + " · click to edit", activate);
      label.className = "edit-page-label";
      if (selected) {
        label.textContent = "Page " + (index + 1) + " · editing";
        label.setAttribute("aria-current", "page");
      }
      header.append(label);
      const menu = document.createElement("details"),
        summary = document.createElement("summary"),
        panel = document.createElement("div");
      menu.className = "page-actions";
      summary.textContent = "Page actions";
      summary.setAttribute("aria-label", "Actions for page " + (index + 1));
      panel.className = "page-actions-panel";
      /** Ignore stale controls whose note was replaced while an operation was in flight. */
      function run(action) {
        if (note() === n) return action();
      }
      panel.append(
        button("Add after page " + (index + 1), () =>
          run(() => app.addPageAfter(index)),
        ),
        button(
          "Move up",
          () => run(() => app.movePage(index, index - 1)),
          index === 0,
        ),
        button(
          "Move down",
          () => run(() => app.movePage(index, index + 1)),
          index === count - 1,
        ),
      );
      const move = document.createElement("label"),
        position = document.createElement("input");
      move.textContent = "Move to position ";
      position.type = "number";
      position.min = "1";
      position.max = String(count);
      position.value = String(index + 1);
      position.disabled = count === 1;
      position.setAttribute(
        "aria-label",
        "Move page " + (index + 1) + " to position",
      );
      move.append(position);
      panel.append(
        move,
        button(
          "Move to position",
          () => run(() => app.movePage(index, Number(position.value) - 1)),
          count === 1,
        ),
      );
      const remove = button(
        "Delete page " + (index + 1),
        () => run(() => app.deletePage(index)),
        count === 1,
      );
      remove.className = "danger";
      if (count === 1)
        remove.title = "Keep one page, or move the whole note to Trash";
      panel.append(remove);
      menu.append(summary, panel);
      menu.ontoggle = () => {
        if (menu.open) {
          menu.classList.remove("open-up");
          if (
            panel.getBoundingClientRect().bottom >
            workspace.getBoundingClientRect().bottom
          )
            menu.classList.add("open-up");
        }
      };
      header.append(menu);
      return header;
    }
    /** Rebuild neighbor previews while retaining the actual canvas, title and text editor nodes. */
    function render(scroll = false) {
      observer?.disconnect();
      const n = note();
      if (!n) return;
      const pages = LeafSearch.pages(n),
        active = app.pageIndex(),
        nodes = [],
        width = sheet.getBoundingClientRect().width || 800;
      for (let i = 0; i < pages.length; i++) {
        if (i === active) {
          if (!n.board) {
            const header = controls(n, i, pages.length, true);
            header.style.width = width + "px";
            nodes.push(header);
          }
          nodes.push(sheet);
        } else {
          const article = document.createElement("article"),
            frame = document.createElement("div"),
            pg = pages[i];
          article.className = "document-page-preview";
          article.dataset.page = String(i);
          article.style.width = width + "px";
          article.style.maxWidth = "100%";
          frame.className = "document-page-surface";
          frame.style.aspectRatio =
            (pg.width || 800) + " / " + (pg.height || 1050);
          frame.append(LeafPreview.render(n, i));
          /** Activate this preview and keep its document coordinates aligned with a starting mouse/pen stroke. */
          async function activate(event) {
            if (activating || note() !== n) return;
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
          article.append(controls(n, i, pages.length, false, activate), frame);
          frame.onpointerdown = (event) => {
            if (event.pointerType === "touch") return;
            event.preventDefault();
            event.stopPropagation();
            activate(event);
          };
          nodes.push(article);
          if (n.pdf) pdfFrame(frame, n, i);
        }
        if (!n.board) {
          const add = button("Add page after page " + (i + 1), () => {
            if (note() === n) return app.addPageAfter(i);
          });
          add.className = "insert-page-inline";
          add.dataset.afterPage = String(i);
          nodes.push(add);
        }
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
