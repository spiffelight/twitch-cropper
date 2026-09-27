"use strict";
/*
 * Structure test for the panel and launcher button.
 *
 * panel.js builds its UI with createElement (no innerHTML), so this walks the
 * resulting tree with a tiny mock DOM and checks that every control the rest of
 * the code looks up by id still exists, with the right attributes. It is the
 * guard for that refactor: if an id, a data attribute or an input's min/max/step
 * goes missing, this fails rather than the UI quietly breaking.
 */

const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : ""));
  }
}

// ---- mock DOM, just rich enough for the tree builder ------------------------
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    attributes: {},
    className: "",
    style: { cssText: "" },
    children: [],
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; }
  };
  // Real DOM turns textContent into a text node; the mock must too, or a walk
  // that collects text nodes would miss everything set that way.
  Object.defineProperty(el, "textContent", {
    get() {
      return el.children.filter((c) => c.nodeType === 3).map((c) => c.textContent).join("");
    },
    set(value) {
      el.children = el.children.filter((c) => c.nodeType !== 3);
      el.children.push({ nodeType: 3, textContent: String(value) });
    }
  });
  return el;
}

global.window = global;
global.document = {
  createElement: makeEl,
  createTextNode: (t) => ({ nodeType: 3, textContent: t })
};
global.window.__TC = {};

eval(fs.readFileSync(path.join(__dirname, "..", "src", "panel.js"), "utf8"));
const TC = global.window.__TC;

const panel = TC.ui.__panelTree();
const fab = TC.ui.__fabTree();

function walk(node, fn) {
  fn(node);
  (node.children || []).forEach((c) => walk(c, fn));
}
function byId(root, id) {
  let found = null;
  walk(root, (n) => {
    if (n.nodeType === 1 && n.attributes && n.attributes.id === id) found = n;
  });
  return found;
}
function text(node) {
  let s = "";
  walk(node, (n) => { if (n.nodeType === 3) s += n.textContent; });
  return s.replace(/\s+/g, " ").trim();
}

console.log("\npanel root");
ok("is a .panel div", panel.tagName === "DIV" && panel.className === "panel");
ok("has id=panel", panel.attributes.id === "panel");
ok("has head / body / foot", panel.children.map((c) => c.className).join(",") === "head,body,foot", panel.children.map((c) => c.className));

console.log("\nheader");
const min = byId(panel, "min");
const close = byId(panel, "close");
ok("collapse button", min && min.tagName === "BUTTON" && min.className === "ico" && !!min.attributes.title);
ok("hide button", close && close.className === "ico" && /\u2702/.test(close.attributes.title || ""));
ok("title text present", text(panel).indexOf("Twitch Cropper") !== -1);

console.log("\nevery control the code looks up by id");
const IDS = [
  "enabled", "select", "x", "y", "w", "h", "reset", "popout", "cropHint",
  "loopWrap", "loopEnabled", "loopStart", "loopStop", "startNow", "stopNow",
  "jumpStart", "maxLoops", "loopCount", "continueAfter", "loopHint", "liveNote",
  "chatToggle", "chatHint", "scope", "off", "resetAll"
];
const missing = IDS.filter((id) => !byId(panel, id));
ok("all present", missing.length === 0, missing);

console.log("\ncrop controls");
const modeChips = [];
walk(panel, (n) => { if (n.attributes && n.attributes["data-mode"]) modeChips.push(n.attributes["data-mode"]); });
ok("fit/fill chips", modeChips.join(",") === "fit,fill", modeChips);
const presets = [];
walk(panel, (n) => { if (n.attributes && n.attributes["data-preset"]) presets.push(n.attributes["data-preset"]); });
ok("five presets", presets.join(",") === "left,right,top,bottom,center", presets);

const x = byId(panel, "x");
ok("x is a bounded number input", x.tagName === "INPUT" && x.attributes.type === "number" && x.attributes.min === "0" && x.attributes.max === "100" && x.attributes.step === "0.5", x.attributes);
ok("x has its visible label", /X %/.test(text(x.parentNode)), text(x.parentNode));

console.log("\nloop controls");
const start = byId(panel, "loopStart");
ok("start is a text input with a placeholder", start.attributes.type === "text" && start.attributes.placeholder === "hh:mm:ss", start.attributes);
const maxLoops = byId(panel, "maxLoops");
ok("maxLoops defaults to 0", maxLoops.attributes.type === "number" && maxLoops.attributes.value === "0" && maxLoops.attributes.step === "1", maxLoops.attributes);
const completed = byId(panel, "loopCount");
ok("completed is read-only", completed.attributes.readonly === "" && completed.attributes.value === "0", completed.attributes);
ok("live note starts hidden", byId(panel, "liveNote").style.cssText === "display:none");
const gridStyle = (id) => byId(panel, id).parentNode.parentNode.style.cssText;
const rowStyle = (id) => byId(panel, id).parentNode.style.cssText;
ok("start/stop grid keeps its top margin", gridStyle("loopStart") === "margin-top:7px", gridStyle("loopStart"));
ok("start/stop-now row keeps its top margin", rowStyle("startNow") === "margin-top:6px", rowStyle("startNow"));
ok("max-loops grid keeps its top margin", gridStyle("maxLoops") === "margin-top:6px", gridStyle("maxLoops"));

console.log("\nswitches and chat");
["enabled", "loopEnabled"].forEach((id) => {
  const input = byId(panel, id);
  const kids = input.parentNode.children;
  ok(
    id + " is checkbox + track + label",
    input.attributes.type === "checkbox" && kids[1].className === "track" && kids.length === 3,
    kids.map((k) => k.className || k.tagName)
  );
});
ok("chat button starts as Unload chat", text(byId(panel, "chatToggle")) === "Unload chat");
ok("chat hint", text(byId(panel, "chatHint")) === "");

console.log("\nfooter");
ok("scope text", text(byId(panel, "scope")) === "Not saved yet");
ok("turn off", text(byId(panel, "off")) === "Turn off");
ok("reset", text(byId(panel, "resetAll")) === "Reset");

console.log("\nlauncher button");
ok("is a .fab with an id", fab.tagName === "DIV" && fab.className === "fab" && fab.attributes.id === "fab");
ok("has a tooltip", /\u2702/.test(fab.textContent) && !!fab.attributes.title);

console.log("\nno innerHTML anywhere in the panel source");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "panel.js"), "utf8");
ok("panel.js does not assign innerHTML", !/\.innerHTML\s*=/.test(src));
ok("panel.js does not use insertAdjacentHTML or outerHTML", !/insertAdjacentHTML|outerHTML/.test(src));

console.log("\n" + (fail === 0 ? "ALL " + pass + " CHECKS PASSED" : pass + " passed, " + fail + " FAILED"));
process.exit(fail === 0 ? 0 : 1);
