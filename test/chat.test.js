"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

let fakeNow = 1000000;
Date.now = () => fakeNow;

const store = {}; // if chat every writes here, the test fails on purpose

function makeBody() {
  return {
    isConnected: true,
    children: [],
    removeChild(node) {
      const i = this.children.indexOf(node);
      if (i >= 0) this.children.splice(i, 1);
      node.parentNode = null;
      node._connected = false;
    },
    insertBefore(node, ref) {
      node.parentNode = this;
      node._connected = true;
      node.nextSibling = ref || null;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, node);
      else this.children.push(node);
    }
  };
}
function makeChat() {
  return {
    _connected: true,
    parentNode: null,
    nextSibling: null,
    get isConnected() { return this._connected; },
    contains(other) { return other === this; },
    querySelectorAll() { return []; }
  };
}

const body = makeBody();
const doc = {
  registry: {},
  querySelector(sel) {
    const el = this.registry[sel];
    return el && el.isConnected ? el : null;
  },
  querySelectorAll() { return []; }
};

function attachChat() {
  const c = makeChat();
  body.children.push(c);
  c.parentNode = body;
  doc.registry[".stream-chat"] = c;
  return c;
}

global.window = global;
global.document = doc;
global.Event = function (t) { this.type = t; };
global.window.dispatchEvent = function () {};
global.window.__TC = {
  log() {},
  getStored: (k, f) => Promise.resolve(Object.prototype.hasOwnProperty.call(store, k) ? store[k] : f),
  setStored: (k, v) => { store[k] = v; return Promise.resolve(); }
};

eval(fs.readFileSync(path.join(ROOT, "src", "chat.js"), "utf8"));
const TC = global.window.__TC;
let activeFlag = true;
TC.isActive = () => activeFlag;

const chat1 = attachChat();

(async function run() {
  console.log("\ninit / defaults");
  await TC.chat.init();
  ok("starts with chat loaded", TC.chat.isUnloaded() === false);
  ok("chat available", TC.chat.available() === true);

  console.log("\nunload (manual)");
  ok("unload returns true", TC.chat.unload() === true);
  ok("chat removed from the document", body.children.indexOf(chat1) === -1);
  ok("reports unloaded", TC.chat.isUnloaded() === true);
  ok("still available so it can be put back", TC.chat.available() === true);
  ok("nothing is written to storage", store["tc.chat"] === undefined, store);
  ok("second unload is a no-op", TC.chat.unload() === false);

  console.log("\nload (manual)");
  TC.chat.load();
  ok("chat restored", body.children.indexOf(chat1) !== -1);
  ok("reports loaded", TC.chat.isUnloaded() === false);
  ok("still nothing written to storage", store["tc.chat"] === undefined, store);

  console.log("\nunload with no chat on the page");
  body.removeChild(chat1);
  ok("returns false when there is nothing to unload", TC.chat.unload() === false);

  console.log("\nreconcile re-detaches a chat Twitch re-renders");
  const chat2 = attachChat();
  TC.chat.unload(); // the user chose to unload during this session
  fakeNow += 5000;
  const chat3 = attachChat(); // Twitch renders a fresh one (SPA navigation)
  TC.chat.reconcile();
  ok("reconcile detaches the freshly rendered chat", body.children.indexOf(chat3) === -1);

  console.log("\nreconcile does nothing when the user has not unloaded chat");
  const chat4 = attachChat();
  TC.chat.load();
  fakeNow += 5000;
  TC.chat.reconcile();
  ok("chat left alone", body.children.indexOf(chat4) !== -1);

  console.log("\nsuspend (extension switched off)");
  TC.chat.unload();
  ok("unloaded again", TC.chat.isUnloaded() === true);
  TC.chat.suspend();
  ok("suspend puts the chat back", body.children.indexOf(chat4) !== -1);
  ok("suspend keeps this session's choice", TC.chat.isUnloaded() === true);
  fakeNow += 5000;
  activeFlag = true;
  TC.chat.reconcile();
  ok("reconcile hides it again when switched back on", body.children.indexOf(chat4) === -1);

  console.log("\nreconcile is skipped while the extension is off");
  TC.chat.suspend();
  ok("chat visible while off", body.children.indexOf(chat4) !== -1);
  TC.chat.unload();          // user unloads while it is on
  TC.chat.suspend();         // then switches the extension off
  activeFlag = false;
  fakeNow += 5000;
  TC.chat.reconcile();
  ok("chat left alone while switched off", body.children.indexOf(chat4) !== -1);
  activeFlag = true;

  console.log("\nload with nothing saved is harmless");
  TC.chat.load();
  ok("does not throw", TC.chat.load() === true);

  console.log("\n" + (fail === 0 ? "ALL " + pass + " CHECKS PASSED" : pass + " passed, " + fail + " FAILED"));
  process.exit(fail === 0 ? 0 : 1);
})();
