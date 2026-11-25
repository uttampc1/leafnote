/** @file Quiet maintenance dashboard for retained notes and private server Git revisions. */
(function () {
  "use strict";
  /** Bind maintenance controls after the notebook has opened. */
  function setup() {
    const app = window.LeafnoteApp,
      dialog = $("#maintenancedialog");
    let mode = "overview",
      offset = 0,
      generation = 0,
      transport = null,
      selected = null,
      working = false;
    /** Show a readable operation result without replacing notebook content. */
    function maintenanceStatus(message) {
      $("#maintenancestatus").textContent = message;
    }
    /** Fence controls while a restore is committing. */
    function lock(value) {
      working = value;
      dialog
        .querySelectorAll("button,select")
        .forEach((el) => (el.disabled = value));
      $("#closemaintenance").disabled = false;
    }
    /** Create a text-only element; note titles and transcripts never become HTML. */
    function element(tag, text) {
      const el = document.createElement(tag);
      el.textContent = text;
      return el;
    }
    /** Render a retained local note and its offline restore action. */
    function trashRow(note) {
      const row = element("article", "");
      row.className = "maintenance-row";
      row.append(
        element("strong", note.title || "Untitled note"),
        element(
          "small",
          "Moved to Trash " +
            new Date(note.deletedAt).toLocaleString() +
            (note.pdf ? " · PDF original retained" : ""),
        ),
      );
      const button = element("button", "Restore note");
      button.type = "button";
      button.onclick = async () => {
        lock(true);
        try {
          await app.maintenance.restoreDeleted(note.id);
          maintenanceStatus(
            "Note restored on this device. It will sync when connected.",
          );
          renderTrash();
        } catch (error) {
          maintenanceStatus(error.message);
        } finally {
          lock(false);
        }
      };
      const purge = element("button", "Delete permanently");
      purge.className = "danger";
      purge.onclick = async () => {
        if (
          !window.confirm(
            "Delete this note permanently from the current notebook and Trash on paired devices? Unsynced edits to this note on other devices will be discarded on reconnection. Older Git revisions and exported backups may still retain it.",
          )
        )
          return;
        lock(true);
        try {
          await app.maintenance.purgeDeleted(note.id);
          maintenanceStatus(
            "Removed from the current notebook. Older Git revisions and backups are unchanged.",
          );
          renderTrash();
        } catch (error) {
          maintenanceStatus(error.message);
        } finally {
          lock(false);
        }
      };
      row.append(button, purge);
      return row;
    }
    /** Show local Trash without needing a server or connection code. */
    function renderTrash() {
      const notes = app.maintenance.trash();
      $("#maintenancelist").replaceChildren(...notes.map(trashRow));
      if (!notes.length)
        $("#maintenancelist").append(element("p", "Trash is empty."));
      $("#maintenancesummary").textContent =
        notes.length +
        " retained note" +
        (notes.length === 1 ? "" : "s") +
        " in Trash";
    }
    /** Obtain authenticated history access only for an already-paired device. */
    async function connection() {
      const { createSyncSettings } = await import("./sync-settings.mjs"),
        settings = await createSyncSettings().load();
      if (!settings.enabled || !settings.token)
        throw Error(
          "Enable Server sync to browse Git revisions. Local Trash works offline.",
        );
      const { createSyncTransport } = await import("./sync-engine.mjs");
      return createSyncTransport({ token: settings.token });
    }
    /** Preview the first historical page as ink and safe plain text, without adopting it. */
    function preview(note) {
      const container = $("#revisionpreview");
      container.replaceChildren();
      const page = note.pdf ? note.pdf.pages[0] : note,
        ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      const width = page.width || page.board?.width || 800,
        height = page.height || page.board?.height || 1050;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      svg.setAttribute("aria-label", "Read-only first-page revision preview");
      svg.setAttribute("role", "img");
      for (const stroke of page.strokes || []) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", LeafInk.outline(stroke));
        path.setAttribute(
          "fill",
          /^#[a-f0-9]{6}$/i.test(stroke.color) ? stroke.color : "#264c3d",
        );
        path.setAttribute("opacity", String(stroke.opacity || 1));
        svg.append(path);
      }
      for (const box of [...(page.texts || []), ...(page.board?.nodes || [])]) {
        String(box.text || "")
          .split("\n")
          .forEach((line, i) => {
            const text = document.createElementNS(ns, "text");
            text.setAttribute("x", String(box.x));
            text.setAttribute(
              "y",
              String(box.y + i * (box.size || 18) * (box.lineHeight || 1.5)),
            );
            text.setAttribute("font-size", String(box.size || 18));
            text.setAttribute(
              "fill",
              /^#[a-f0-9]{6}$/i.test(box.color) ? box.color : "#264c3d",
            );
            text.textContent = line;
            svg.append(text);
          });
      }
      container.append(svg);
      if (note.pdf)
        container.prepend(
          element(
            "p",
            note.pdf.pages.length +
              " PDF pages. This preview shows first-page annotations; restore a copy to view the original document.",
          ),
        );
      if (page.handwriting?.text)
        container.append(element("p", page.handwriting.text));
    }
    /** Load a selected immutable revision; closing or changing views invalidates late responses. */
    async function inspect(hash, button) {
      const ticket = ++generation;
      selected = null;
      $("#restorerevision").hidden = true;
      lock(true);
      try {
        const snapshot = await transport.revision(hash);
        if (ticket !== generation || !dialog.open) return;
        selected = { hash, snapshot };
        const select = $("#revisionnote");
        select.replaceChildren(
          ...snapshot.data.notes.map((note) => {
            const option = element(
              "option",
              (note.title || "Untitled note") +
                (note.deleted ? " · in Trash" : ""),
            );
            option.value = note.id;
            return option;
          }),
        );
        $("#revisiondetails").hidden = false;
        $("#restorerevision").hidden = !snapshot.data.notes.length;
        select.onchange = () => {
          const note = snapshot.data.notes.find((n) => n.id === select.value);
          if (note) preview(note);
        };
        select.onchange();
        maintenanceStatus(
          "Revision " +
            hash.slice(0, 10) +
            " · read only. Restore creates a new note.",
        );
      } catch (error) {
        maintenanceStatus(error.message);
      } finally {
        lock(false);
      }
    }
    /** Page through server Git metadata; no notes are changed by browsing history. */
    async function historyPage(append = false) {
      const ticket = ++generation;
      lock(true);
      try {
        transport ||= await connection();
        const result = await transport.history(append ? offset : 0);
        if (ticket !== generation || !dialog.open) return;
        const list = $("#maintenancelist");
        if (!append) {
          list.replaceChildren();
          offset = 0;
        }
        for (const commit of result.commits) {
          const row = element("article", "");
          row.className = "maintenance-row";
          const button = element(
            "button",
            commit.message + " · " + commit.hash.slice(0, 10),
          );
          button.onclick = () => inspect(commit.hash, button);
          row.append(
            button,
            element("small", new Date(commit.at).toLocaleString()),
          );
          list.append(row);
        }
        offset += result.commits.length;
        $("#olderrevisions").hidden = result.commits.length < 30;
        $("#maintenancesummary").textContent =
          "Private server Git history · " + offset + " revisions shown";
        maintenanceStatus(
          offset
            ? "Select a revision to preview and restore a note."
            : "No server revisions yet. Changes appear after an autosave syncs.",
        );
      } catch (error) {
        maintenanceStatus(error.message);
      } finally {
        lock(false);
      }
    }
    /** Switch between offline Trash and authenticated server history. */
    function show(next) {
      mode = next;
      ++generation;
      selected = null;
      $("#dashboardoverview").hidden = mode !== "overview";
      $("#maintenancelist").hidden = mode === "overview";
      $("#showoverview").setAttribute(
        "aria-pressed",
        String(mode === "overview"),
      );
      $("#revisiondetails").hidden = true;
      $("#restorerevision").hidden = true;
      $("#olderrevisions").hidden = true;
      $("#showtrash").setAttribute("aria-pressed", String(mode === "trash"));
      $("#showhistory").setAttribute(
        "aria-pressed",
        String(mode === "history"),
      );
      if (mode === "overview") {
        $("#maintenancesummary").textContent = "Storage and save locations";
        maintenanceStatus(
          "Notes save on this device first. Sync keeps an additional copy on your server.",
        );
        document.dispatchEvent(new Event("leafnote-dashboard-opened"));
      } else if (mode === "trash") {
        renderTrash();
        maintenanceStatus(
          "Restore a retained note or permanently remove it from the current notebook. Older Git revisions and backups can retain copies.",
        );
      } else {
        $("#maintenancelist").replaceChildren();
        historyPage();
      }
    }
    $("#maintenance").onclick = () => {
      app.finish();
      $("#notemenu").open = false;
      dialog.showModal();
      show("overview");
    };
    $("#showoverview").onclick = () => show("overview");
    $("#showtrash").onclick = () => show("trash");
    $("#showhistory").onclick = () => show("history");
    $("#refreshmaintenance").onclick = () => show(mode);
    $("#olderrevisions").onclick = () => historyPage(true);
    $("#closemaintenance").onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
      ++generation;
      transport?.abort();
      transport = null;
    });
    $("#restorerevision").onclick = async () => {
      if (!selected || working) return;
      const note = selected.snapshot.data.notes.find(
        (n) => n.id === $("#revisionnote").value,
      );
      if (!note) return;
      lock(true);
      try {
        let blob;
        if (note.pdf) {
          const hash = selected.snapshot.files[note.id];
          blob = await transport.getBlob(hash);
          const { blobHash } = await import("./sync-engine.mjs");
          if ((await blobHash(blob)) !== hash)
            throw Error("Historical PDF failed its integrity check");
        }
        await app.maintenance.restoreRevision(note, blob);
        maintenanceStatus(
          "Historical content restored as a new note. The current version was kept.",
        );
      } catch (error) {
        maintenanceStatus(error.message);
      } finally {
        lock(false);
      }
    };
  }
  if (window.LeafnoteApp?.ready) setup();
  else document.addEventListener("leafnote-ready", setup, { once: true });
})();
