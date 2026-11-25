/** @file Installation controls and user-approved offline updates that wait for note persistence. */
(function () {
  "use strict";
  let promptEvent = null,
    registration = null,
    reloading = false;
  const button = document.querySelector("#installapp"),
    status = document.querySelector("#pwastatus"),
    update = document.querySelector("#updateapp"),
    dialog = document.querySelector("#pwainstall");
  /** Keep the optional More-menu installation status in sync with connectivity. */
  function showStatus() {
    status.textContent = !window.isSecureContext
      ? "HTTPS is needed to install this app."
      : !("serviceWorker" in navigator)
        ? "This browser does not support offline installation."
        : registration?.active
          ? navigator.onLine
            ? "Offline notebook ready"
            : "Offline — your notes still save on this device"
          : "Preparing offline notebook…";
  }
  /** Reveal a waiting version without interrupting a note currently being edited. */
  function showUpdate() {
    update.hidden = !registration?.waiting;
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event;
    button.textContent = "Install Leafnote";
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    button.textContent = "App installed";
    navigator.storage?.persist?.().catch(() => {});
  });
  button.addEventListener("click", async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      promptEvent = null;
    } else dialog.showModal();
  });
  document.querySelector("#closepwainstall").onclick = () => dialog.close();
  update.addEventListener("click", async () => {
    window.LeafnoteApp?.finish();
    if (!(await persist())) {
      toast("Your changes could not be saved. Keep this page open and retry.");
      return;
    }
    if (registration?.waiting) {
      reloading = true;
      registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    }
  });
  window.addEventListener("online", showStatus);
  window.addEventListener("offline", showStatus);
  showStatus();
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) location.reload();
  });
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then(async (reg) => {
      registration = reg;
      showUpdate();
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") showUpdate();
        });
      });
      await navigator.serviceWorker.ready;
      showStatus();
    })
    .catch(() => {
      status.textContent =
        "Offline setup did not finish. Keep the server connected and reload to retry.";
    });
})();
