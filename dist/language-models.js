/** @file Reviewed install/use/remove controls for local recognition models. */
(function () {
  "use strict";
  let loaded = null,
    operation = null;
  /** Format a byte count for the model-download UI. */
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  /** Lazily load the language-model storage module. */
  const storage = () => loaded || (loaded = import("./model-storage.mjs"));
  /** Update the language-model manager’s status text. */
  function message(text) {
    $("#modelstatus").textContent = text;
  }
  /** Render this module’s controls from the current note and UI state. */
  async function render() {
    const { languageModels, modelStore } = await storage(),
      cards = [];
    for (const model of languageModels) {
      const state = await modelStore.getInstalled(model.id),
        bytes = await modelStore.storedBytes(model.id);
      cards.push(
        `<article class="modelcard"><h3>${escapeText(model.name)}${model.experimental ? " <span>Experimental</span>" : ""}</h3><p>${escapeText(model.language)} · ${mb(model.files.reduce((sum, f) => sum + f.size, 0))} download · ${escapeText(model.license)}</p><p class="modelstate">${state ? "Installed on this device" : bytes ? "Partly downloaded (" + mb(bytes) + ")" : "Not installed"}</p><details><summary>Review model details</summary><p>${escapeText(model.validation)}</p><p>${escapeText(model.limitations)}</p><p>Recognition runs on this device. Notes and ink are not uploaded. Model files are pinned to a specific version; available weight checksums are verified.</p><a href="${escapeText(model.source)}" target="_blank" rel="noopener noreferrer">Model source and licence</a>${model.dictionarySource ? `<p><a href="${escapeText(model.dictionarySource)}" target="_blank" rel="noopener noreferrer">Marathi dictionary source and GPL-2.0 licence</a></p>` : ""}</details><div><button data-install-model="${model.id}" ${state || operation ? "disabled" : ""}>${bytes && !state ? "Resume install" : "Install"}</button><button data-use-model="${model.id}" ${!state || operation ? "disabled" : ""}>Use for this page</button><button data-remove-model="${model.id}" ${!bytes || operation ? "disabled" : ""}>Remove</button></div></article>`,
      );
    }
    $("#modelcards").innerHTML = cards.join("");
    $("#cancelmodeldownload").hidden = !operation;
  }
  /** Open a model dialog or note/page through the module’s public entry point. */
  async function open() {
    try {
      const { modelStore } = await storage();
      await modelStore.adoptLegacyEnglish().catch(() => false);
      await render();
      if (!$("#modelsdialog").open) $("#modelsdialog").showModal();
      message(
        "Review a model before installing. Remove clears its local model files and keeps your notes, ink, and saved recognition text.",
      );
    } catch (e) {
      message(e.message);
      if (!$("#modelsdialog").open) $("#modelsdialog").showModal();
    }
  }
  /** Download and verify approved model assets before marking a model installed. */
  async function install(id) {
    if (operation) return;
    operation = new AbortController();
    await render();
    try {
      const { modelStore } = await storage();
      await modelStore.install(id, {
        signal: operation.signal,
        /** Report verified model installation progress in the manager. */
        onProgress: (p) =>
          message(
            "Installing " +
              id.toUpperCase() +
              " · " +
              p.file +
              " · " +
              mb(p.loaded) +
              " of " +
              mb(p.total),
          ),
      });
      message(
        "Model installed. Choose Use for this page to recognize its handwriting.",
      );
      document.dispatchEvent(
        new CustomEvent("leafnote-model-installed", { detail: { id } }),
      );
    } catch (e) {
      message(
        e.name === "AbortError"
          ? "Download cancelled. Install can resume, or Remove can clear downloaded parts."
          : "Installation failed: " + e.message,
      );
    } finally {
      operation = null;
      await render();
    }
  }
  /** Remove only the chosen model’s assets while preserving notes and transcripts. */
  async function remove(id) {
    if (operation) return;
    try {
      document.dispatchEvent(
        new CustomEvent("leafnote-model-removed", { detail: { id } }),
      );
      const { modelStore } = await storage();
      await modelStore.remove(id);
      message(
        "Model removed from Leafnote’s local model storage. Notes, ink, and saved search text are kept.",
      );
      await render();
    } catch (e) {
      message("Could not remove the model: " + e.message);
    }
  }
  $("#languagemodels").onclick = open;
  $("#closemodels").onclick = () => $("#modelsdialog").close();
  $("#cancelmodeldownload").onclick = () => operation?.abort();
  $("#modelcards").onclick = async (e) => {
    const installButton = e.target.closest("[data-install-model]"),
      removeButton = e.target.closest("[data-remove-model]"),
      use = e.target.closest("[data-use-model]");
    if (installButton) await install(installButton.dataset.installModel);
    if (removeButton) await remove(removeButton.dataset.removeModel);
    if (use) {
      $("#modelsdialog").close();
      document.dispatchEvent(
        new CustomEvent("leafnote-language-selected", {
          detail: { id: use.dataset.useModel },
        }),
      );
    }
  };
  window.LeafLanguageModels = { open };
})();
