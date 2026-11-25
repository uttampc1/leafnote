/** @file Opt-in server pairing and online/idle synchronization. Offline note storage remains authoritative for pending edits. */
(function () {
  "use strict";
  /** Attach this module’s event handlers after the application state is ready. */
  async function setup() {
    const { createSyncSettings } = await import("./sync-settings.mjs"),
      { createSyncEngine, createSyncTransport } = await import(
        "./sync-engine.mjs"
      ),
      storage = createSyncSettings(),
      app = window.LeafnoteApp.sync,
      dialog = $("#syncdialog");
    let settings = await storage.load(),
      engine = null,
      timer = null,
      authFailed = false,
      available = false;
    if (!settings.deviceId) {
      await storage.save({ deviceId: crypto.randomUUID() });
      settings = await storage.load();
    }
    /** Update the quiet More-menu sync status and the pairing dialog together. */
    function status(state) {
      $("#syncstatus").textContent = state.message;
      $("#syncdialogstatus").textContent = state.message;
    }
    /** Keep pairing controls aligned with the durable opt-in choice. */
    function render() {
      const enabled = settings.enabled === true;
      $("#enablesync").textContent = enabled ? "Reconnect" : "Enable sync";
      $("#disablesync").hidden = !enabled;
      $("#syncnow").hidden = !enabled;
      $("#synccode").required = !enabled;
    }
    /** Initialize a transport only after the user has supplied a valid connection code. */
    function prepareEngine() {
      engine?.stop?.();
      engine = createSyncEngine({
        app,
        storage,
        deviceId: settings.deviceId,
        transport: createSyncTransport({ token: settings.token }),
        onStatus: status,
      });
    }
    /** Retry on reconnect or while the app is open; never require network access to edit locally. */
    async function run() {
      if (!settings.enabled || authFailed) return;
      if (!navigator.onLine) {
        status({
          message:
            "Offline — changes are saved here and will sync when connected.",
        });
        return;
      }
      if (!engine) prepareEngine();
      try {
        if (!(await engine.run())) schedule(1500);
      } catch (e) {
        if (e.status === 401) authFailed = true;
        else if (e instanceof TypeError || e.name === "AbortError")
          status({
            message:
              "Server unavailable — changes remain saved on this device.",
          });
      }
    }
    /** Debounce local saves while allowing a reconnect to trigger an immediate attempt. */
    function schedule(delay = 1200) {
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    }
    /** Show first-use consent or allow a paired device to change its connection code. */
    function open() {
      render();
      $("#synccode").value = "";
      if (!dialog.open) dialog.showModal();
    }
    /** Detect a configured same-origin server without sending notebook content or credentials. */
    async function probe() {
      try {
        const controller = new AbortController(),
          timeout = setTimeout(() => controller.abort(), 5000);
        let response;
        try {
          response = await fetch("./api/sync/config", {
            cache: "no-store",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) return;
        const config = await response.json();
        available = config.enabled === true && config.protocol === 2;
        if (
          available &&
          settings.choice === undefined &&
          app.supported() &&
          !document.querySelector("dialog[open]") &&
          !app.busy()
        )
          open();
      } catch {
        /* The notebook remains usable when no server can be reached. */
      }
    }
    $("#serversync").onclick = () => {
      open();
      if (!app.supported())
        status({
          message:
            "Use a current HTTPS browser with Web Locks to enable sync. Local notes still work.",
        });
      else if (!available)
        status({
          message:
            "Configure the Linux server storage folder first, then connect with its connection code.",
        });
    };
    $("#enablesync").onclick = async () => {
      if (!app.supported()) {
        status({
          message:
            "Server sync requires a current HTTPS browser with Web Locks.",
        });
        return;
      }
      const token = $("#synccode").value.trim() || settings.token;
      if (!/^[a-f0-9]{64}$/.test(token || "")) {
        status({
          message:
            "Paste the 64-character connection code from your Linux server.",
        });
        return;
      }
      $("#enablesync").disabled = true;
      try {
        await createSyncTransport({ token }).getState(null);
        await storage.save({ choice: true, enabled: true, token });
        settings = await storage.load();
        authFailed = false;
        prepareEngine();
        dialog.close();
        $("#serversync").focus();
        schedule(0);
      } catch (e) {
        status({
          message:
            e.status === 401
              ? "That connection code was not accepted."
              : "Could not reach the server. Your local notes are unchanged.",
        });
      } finally {
        $("#enablesync").disabled = false;
        render();
      }
    };
    $("#disablesync").onclick = async () => {
      engine?.stop?.();
      await storage.save({ choice: false, enabled: false, token: null });
      settings = await storage.load();
      engine = null;
      dialog.close();
      $("#serversync").focus();
      status({
        message:
          "Server sync is off on this device. Local and server notes are kept.",
      });
    };
    $("#closesync").onclick = async () => {
      if (settings.choice === undefined) {
        await storage.save({ choice: false, enabled: false });
        settings = await storage.load();
      }
      dialog.close();
      $("#serversync").focus();
    };
    dialog.addEventListener("cancel", () => {
      if (settings.choice === undefined) {
        storage.save({ choice: false, enabled: false }).then(async () => {
          settings = await storage.load();
        });
      }
    });
    $("#syncnow").onclick = () => {
      dialog.close();
      $("#serversync").focus();
      schedule(0);
    };
    document.addEventListener("leafnote-local-saved", (event) => {
      engine?.invalidateFiles(event.detail?.files);
      if (!event.detail?.remote && settings.enabled) schedule();
    });
    window.addEventListener("online", () => {
      probe();
      schedule(0);
    });
    window.addEventListener("offline", () =>
      status({
        message:
          "Offline — changes are saved here and will sync when connected.",
      }),
    );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        probe();
        schedule(0);
      }
    });
    setInterval(() => {
      if (settings.enabled) schedule(0);
      else if (settings.choice === undefined) probe();
    }, 15000);
    render();
    status({
      message: settings.enabled
        ? "Connecting to your Linux notebook…"
        : "Saved on this device · Server sync is optional",
    });
    await probe();
    if (settings.enabled) schedule(0);
  }
  if (window.LeafnoteApp?.ready) setup().catch(() => {});
  else
    document.addEventListener("leafnote-ready", () => setup().catch(() => {}), {
      once: true,
    });
})();
