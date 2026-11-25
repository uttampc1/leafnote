/** @file Dashboard usage and location controls. Never sends note content before pairing consent. */
(function () {
  "use strict";
  /** Wire local usage, authenticated server metadata, and explicit location-change workflows. */
  function setup() {
    const app = window.LeafnoteApp,
      dialog = $("#maintenancedialog");
    let generation = 0,
      folder = null,
      server = null;
    /** Format logical byte counts without implying filesystem allocation precision. */
    function bytes(value) {
      if (!Number.isFinite(value)) return "Unavailable";
      const units = ["B", "KiB", "MiB", "GiB", "TiB"];
      let i = 0;
      while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
      }
      return (
        value.toLocaleString(undefined, { maximumFractionDigits: i ? 1 : 0 }) +
        " " +
        units[i]
      );
    }
    /** Calculate this device first; only paired clients request private server metadata. */
    async function refresh() {
      const ticket = ++generation;
      folder = null;
      $("#dashboardchangefolder").disabled = true;
      $("#dashboarddeviceorigin").textContent = location.origin;
      $("#dashboardserverlocation").textContent =
        "Not configured · this device only";
      $("#dashboardserverfolder").textContent = "Not configured";
      $("#dashboardserverbytes").textContent = "Not connected";
      $("#dashboardconnect").textContent = "Configure sync";
      try {
        const usage = await app.maintenance.usage();
        if (ticket !== generation || !dialog.open) return;
        $("#dashboardcontent").textContent = bytes(usage.contentBytes);
        $("#dashboardcounts").textContent =
          usage.activeNotes +
          " active notes · " +
          usage.trashNotes +
          " in Trash · " +
          bytes(usage.pdfBytes) +
          " of PDF originals";
        $("#dashboardtrashbytes").textContent =
          "Trash accounts for " + bytes(usage.trashBytes) + " of this content.";
        $("#dashboardappbytes").textContent = bytes(usage.originBytes);
        if (usage.originBytes === null)
          $("#dashboardquota").textContent =
            "This browser does not report total app storage. The note/document total is measured separately.";
        else if (usage.quotaBytes)
          $("#dashboardquota").textContent =
            "Browser estimate; storage allowance " +
            bytes(usage.quotaBytes) +
            ". Includes offline app files and installed models.";
      } catch (error) {
        $("#dashboardcontent").textContent = "Could not measure";
        $("#dashboardcounts").textContent = error.message;
      }
      try {
        const { createSyncSettings } = await import("./sync-settings.mjs"),
          settings = await createSyncSettings().load();
        if (ticket !== generation || !dialog.open) return;
        if (!settings.enabled || !settings.token) return;
        $("#dashboardserverlocation").textContent = location.origin;
        $("#dashboardconnect").textContent = "Manage sync connection";
        const { createSyncTransport } = await import("./sync-engine.mjs");
        server?.abort();
        server = createSyncTransport({ token: settings.token });
        const info = await server.storageInfo();
        if (ticket !== generation || !dialog.open) return;
        folder = info.folder;
        $("#dashboardserverfolder").textContent = folder;
        $("#dashboardserverbytes").textContent = bytes(info.bytes);
        $("#dashboardserverdetail").textContent =
          "Git history " +
          bytes(info.categories.history) +
          " · PDFs " +
          bytes(info.categories.blobs) +
          " · snapshots " +
          bytes(info.categories.snapshots) +
          ". Measured file sizes; copies are not added to the device total.";
        $("#dashboardchangefolder").disabled = false;
      } catch (error) {
        if (ticket !== generation || !dialog.open) return;
        $("#dashboardserverfolder").textContent =
          "Unavailable while offline or until the Linux server is updated";
        $("#dashboardserverbytes").textContent = "Unavailable";
      }
    }
    /** Accept a clean HTTPS server origin, with localhost HTTP allowed for development. */
    function target() {
      try {
        const value = new URL($("#dashboardserveraddress").value.trim());
        if (
          value.username ||
          value.password ||
          value.search ||
          value.hash ||
          value.pathname !== "/" ||
          !(
            value.protocol === "https:" ||
            (value.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname))
          )
        )
          return null;
        return value.origin + "/";
      } catch {
        return null;
      }
    }
    $("#dashboardserveraddress").oninput = () => {
      const value = target(),
        link = $("#dashboardopenserver");
      if (value) {
        link.href = value;
        link.setAttribute("aria-disabled", "false");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
      $("#dashboardserveraddressstatus").textContent = value
        ? "Export first if you want to bring the current notebook."
        : "Enter an HTTPS server address without a path, password, or query.";
    };
    $("#dashboardopenserver").onclick = (event) => {
      if (!target()) event.preventDefault();
    };
    $("#dashboardchangeserver").onclick = () => {
      $("#dashboardserverform").hidden = !$("#dashboardserverform").hidden;
      $("#dashboardserveraddress").focus();
    };
    $("#dashboardchangefolder").onclick = () => {
      $("#dashboardfolderform").hidden = !$("#dashboardfolderform").hidden;
      $("#dashboardfolderpath").focus();
    };
    /** Generate a shell-safe command only for the dedicated Linux migration helper. */
    function command() {
      const value = $("#dashboardfolderpath").value.trim();
      if (
        !/^(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(value) ||
        value.includes("..") ||
        value === folder
      )
        return null;
      return "sh scripts/change-sync-folder.sh " + value;
    }
    $("#dashboardfolderpath").oninput = () => {
      $("#dashboardfoldercommand").textContent =
        command() ||
        "Enter a different absolute folder path without spaces or shell characters.";
    };
    $("#dashboardcopycommand").onclick = async () => {
      const value = command();
      if (!value) {
        $("#dashboardfolderstatus").textContent =
          "Enter a valid new folder first.";
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
        $("#dashboardfolderstatus").textContent =
          "Copied. Run this on the Linux server; it has not been executed by the browser.";
      } catch {
        $("#dashboardfolderstatus").textContent =
          "Copy the displayed command manually.";
      }
    };
    $("#dashboardconnect").onclick = () => {
      dialog.close();
      $("#serversync").click();
    };
    $("#dashboardexport").onclick = () => $("#backup").click();
    for (const form of ["#dashboardserverform", "#dashboardfolderform"])
      $(form).onsubmit = (event) => event.preventDefault();
    document.addEventListener("leafnote-dashboard-opened", refresh);
    dialog.addEventListener("close", () => {
      generation++;
      server?.abort();
    });
  }
  if (window.LeafnoteApp?.ready) setup();
  else document.addEventListener("leafnote-ready", setup, { once: true });
})();
