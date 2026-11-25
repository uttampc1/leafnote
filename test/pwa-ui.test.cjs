const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { JSDOM } = require("jsdom"),
  fs = require("node:fs"),
  path = require("node:path");
/** Boot the install/update controls against a fake browser registration and save queue. */
async function bootPWA() {
  const dom = new JSDOM(
      '<button id="installapp"></button><small id="pwastatus"></small><button id="updateapp" hidden></button><dialog id="pwainstall"><button id="closepwainstall"></button></dialog>',
      { url: "https://192.168.1.50:8443/", runScripts: "outside-only" },
    ),
    w = dom.window;
  let activated = 0,
    finished = 0,
    errors = 0,
    prompted = 0;
  const reg = {
    active: {},
    waiting: {
      /** Implement the postMessage callback in this object. */
      postMessage: () => {
        activated++;
      },
    },
    /** Implement the addEventListener callback in this object. */
    addEventListener() {},
  };
  Object.defineProperty(w, "isSecureContext", { value: true });
  Object.defineProperty(w.navigator, "serviceWorker", {
    value: {
      /** Implement the register callback in this object. */
      register: async () => reg,
      ready: Promise.resolve(reg),
      /** Implement the addEventListener callback in this object. */
      addEventListener() {},
    },
  });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.saved = false;
  w.persist = async () => w.saved;
  w.LeafnoteApp = {
    /** Finish active note and board edits before a deliberate layout change. */
    finish: () => {
      finished++;
    },
  };
  w.toast = () => {
    errors++;
  };
  w.eval(fs.readFileSync(path.join(__dirname, "../dist/pwa.js"), "utf8"));
  await new Promise(setImmediate);
  return {
    w,
    dom,
    /** Implement the activated callback in this object. */
    get activated() {
      return activated;
    },
    /** Implement the finished callback in this object. */
    get finished() {
      return finished;
    },
    /** Implement the errors callback in this object. */
    get errors() {
      return errors;
    },
    /** Implement the prompted callback in this object. */
    get prompted() {
      return prompted;
    },
    /** Implement the prompt callback in this object. */
    prompt: async () => {
      prompted++;
    },
  };
}
test("install button uses the native prompt when exposed and provides manual instructions otherwise", async () => {
  /** Select the first DOM element matching a CSS selector. */
  const h = await bootPWA(),
    $ = (id) => h.w.document.getElementById(id);
  $("installapp").click();
  assert.equal($("pwainstall").open, true);
  $("closepwainstall").click();
  const event = new h.w.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = h.prompt;
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  h.w.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  $("installapp").click();
  await new Promise(setImmediate);
  assert.equal(h.prompted, 1);
  assert.match($("pwastatus").textContent, /Offline notebook ready/);
  h.dom.window.close();
});
test("updating cannot activate a waiting worker until edited notes have saved", async () => {
  const h = await bootPWA(),
    button = h.w.document.getElementById("updateapp");
  assert.equal(button.hidden, false);
  button.click();
  await new Promise(setImmediate);
  assert.equal(h.finished, 1);
  assert.equal(h.activated, 0);
  assert.equal(h.errors, 1);
  h.w.saved = true;
  button.click();
  await new Promise(setImmediate);
  assert.equal(h.finished, 2);
  assert.equal(h.activated, 1);
  h.dom.window.close();
});
