"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }

// ---- minimal fake browser environment for core.js -------------------------
const root = {
  attrs: {},
  props: {},
  setAttribute(k, v) { this.attrs[k] = v; },
  removeAttribute(k) { delete this.attrs[k]; },
  style: { setProperty(k, v) { root.props[k] = v; } }
};

global.window = global;
global.location = { pathname: "/", hostname: "www.twitch.tv" };
global.document = {
  documentElement: root,
  querySelectorAll: () => [],
  querySelector: () => null
};
global.getComputedStyle = () => ({ objectFit: "contain", display: "block", visibility: "visible" });

eval(fs.readFileSync(path.join(__dirname, "..", "src", "core.js"), "utf8"));
const TC = global.window.__TC;

console.log("\ntime parsing/formatting");
ok("parse 01:02:03", TC.parseTime("01:02:03") === 3723, TC.parseTime("01:02:03"));
ok("parse 02:03", TC.parseTime("02:03") === 123, TC.parseTime("02:03"));
ok("parse 59", TC.parseTime("59") === 59);
ok("parse 1:2:3", TC.parseTime("1:2:3") === 3723);
ok("parse 0.5", TC.parseTime("0.5") === 0.5);
ok("parse empty -> null", TC.parseTime("") === null);
ok("parse garbage -> null", TC.parseTime("ab:cd") === null);
ok("parse 4 parts -> null", TC.parseTime("1:2:3:4") === null);
ok("format 3723", TC.formatTime(3723) === "1:02:03", TC.formatTime(3723));
ok("format 123", TC.formatTime(123) === "02:03", TC.formatTime(123));
ok("format 0", TC.formatTime(0) === "00:00");
ok("format negative", TC.formatTime(-5) === "00:00");
ok("format round trip 3661", TC.formatTime(TC.parseTime("1:01:01")) === "1:01:01");

console.log("\ncrop normalisation / validity");
ok("valid full crop", TC.isCropValid({ x: 0, y: 0, w: 1, h: 1 }));
ok("reject zero size", !TC.isCropValid({ x: 0, y: 0, w: 0, h: 1 }));
ok("reject overflow", !TC.isCropValid({ x: 0.8, y: 0, w: 0.4, h: 1 }));
const nc = TC.normalizeCrop({ x: 0.9, y: -1, w: 2, h: 0.5, enabled: 1 });
ok("normalize clamps x so x+w<=1", near(nc.x, 0) && near(nc.w, 1), nc);
ok("normalize clamps y>=0", nc.y === 0, nc);
ok("normalize keeps enabled", nc.enabled === true);
ok("default mode is fit", TC.defaultCrop().mode === "fit");
ok("normalize keeps fill mode", TC.normalizeCrop({ mode: "fill" }).mode === "fill");
ok("normalize defaults unknown mode to fit", TC.normalizeCrop({ mode: "wat" }).mode === "fit");

console.log("\ncontentBox (object-fit)");
const cb1 = TC.contentBox({ videoWidth: 1920, videoHeight: 1080 }, 1000, 1000);
ok("contain letterboxes 16:9 into 1:1", near(cb1.x, 0) && near(cb1.y, 218.75) && near(cb1.w, 1000) && near(cb1.h, 562.5), cb1);
const cb2 = TC.contentBox({ videoWidth: 1000, videoHeight: 1000 }, 1000, 1000);
ok("square in square fills box", near(cb2.x, 0) && near(cb2.y, 0) && near(cb2.w, 1000) && near(cb2.h, 1000), cb2);
const cb3 = TC.contentBox({ videoWidth: 0, videoHeight: 0 }, 640, 360);
ok("no metadata -> full box", near(cb3.x, 0) && near(cb3.w, 640) && near(cb3.h, 360), cb3);

console.log("\ncomputeTransform: fit / fill mapping + clip");
function mapPoint(t, x, y) {
  return { x: t.s * (x - t.ox) + t.ox + t.tx, y: t.s * (y - t.oy) + t.oy + t.ty };
}
function regionRect(crop, cb) {
  return { x: cb.x + crop.x * cb.w, y: cb.y + crop.y * cb.h, w: crop.w * cb.w, h: crop.h * cb.h };
}
function mappedBox(t, r) {
  const a = mapPoint(t, r.x, r.y);
  const b = mapPoint(t, r.x + r.w, r.y + r.h);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

function checkFill(name, crop, W, H, cb) {
  const t = TC.computeTransform(crop, W, H, cb, "fill");
  const r = regionRect(crop, cb);
  const m = mappedBox(t, r);
  const coversX = m.x0 <= 1e-6 && m.x1 >= W - 1e-6;
  const coversY = m.y0 <= 1e-6 && m.y1 >= H - 1e-6;
  const centred = near(m.x0, -(m.x1 - W), 1e-6) && near(m.y0, -(m.y1 - H), 1e-6);
  ok(name, coversX && coversY && centred, { m, W, H });
}

function checkFit(name, crop, W, H, cb) {
  const t = TC.computeTransform(crop, W, H, cb, "fit");
  const r = regionRect(crop, cb);
  const m = mappedBox(t, r);
  const w = m.x1 - m.x0, h = m.y1 - m.y0;
  const fitsX = w <= W + 1e-6, fitsY = h <= H + 1e-6;
  const touches = near(Math.max(w / W, h / H), 1, 1e-6);
  const centred = near(m.x0, (W - w) / 2, 1e-6) && near(m.y0, (H - h) / 2, 1e-6);
  const noTrim = near(t.s, Math.min(W / r.w, H / r.h), 1e-9);
  ok(name, fitsX && fitsY && touches && centred && noTrim, { m, w, h, W, H, s: t.s });
}

function checkClip(name, crop, W, H, cb) {
  const t = TC.computeTransform(crop, W, H, cb, "fit");
  const r = regionRect(crop, cb);
  const good =
    near(t.clip.left, r.x, 1e-6) &&
    near(t.clip.top, r.y, 1e-6) &&
    near(t.clip.right, W - (r.x + r.w), 1e-6) &&
    near(t.clip.bottom, H - (r.y + r.h), 1e-6);
  ok(name, good, { clip: t.clip, r });
}

const full = { x: 0, y: 0, w: 1, h: 1 };
const half = { x: 0.25, y: 0, w: 0.5, h: 1 };
const small = { x: 0, y: 0, w: 0.2, h: 0.1 };
const offc = { x: 0.6, y: 0.7, w: 0.15, h: 0.12 };
const webcam = { x: 0, y: 0.154, w: 0.217, h: 0.565 }; // the reported case
const cb169 = { x: 0, y: 0, w: 1920, h: 1080 };

checkFill("fill: full crop = identity", full, 1000, 1000, cb2);
checkFill("fill: centre half of square", half, 1000, 1000, cb2);
checkFill("fill: wide region into square", small, 1000, 1000, cb2);
checkFill("fill: letterboxed source", half, 1000, 1000, cb1);
checkFill("fill: 16:9 element", offc, 1920, 1080, cb169);

checkFit("fit: full crop = identity", full, 1000, 1000, cb2);
checkFit("fit: centre half of square", half, 1000, 1000, cb2);
checkFit("fit: wide region into square", small, 1000, 1000, cb2);
checkFit("fit: letterboxed source", half, 1000, 1000, cb1);
checkFit("fit: 16:9 element", offc, 1920, 1080, cb169);
checkFit("fit: the reported webcam crop", webcam, 1920, 1080, cb169);

checkClip("clip = region rect (non-letterboxed)", half, 1000, 1000, cb2);
checkClip("clip = region rect (letterboxed)", half, 1000, 1000, cb1);
checkClip("clip = region rect (webcam)", webcam, 1920, 1080, cb169);

const tFullFit = TC.computeTransform(full, 1000, 1000, cb2, "fit");
ok("fit: full crop scale == 1", near(tFullFit.s, 1) && near(tFullFit.tx, 0) && near(tFullFit.ty, 0), tFullFit);

// The webcam crop on a 16:9 player is portrait: fit must scale by the *width*
// rule wait -- by whichever is SMALLER, i.e. min(1920/(0.217*1920), 1080/(0.565*1080)).
const wc = TC.computeTransform(webcam, 1920, 1080, cb169, "fit");
const wcFill = TC.computeTransform(webcam, 1920, 1080, cb169, "fill");
ok("fit webcam zoom <= fill webcam zoom", wc.s <= wcFill.s, { fit: wc.s, fill: wcFill.s });
ok("fit webcam scale = min(width,height) rule", near(wc.s, Math.min(1 / 0.217, 1 / 0.565), 1e-9), wc.s);
ok("fill webcam scale = max(width,height) rule", near(wcFill.s, Math.max(1 / 0.217, 1 / 0.565), 1e-9), wcFill.s);

console.log("\napplyCrop writes the DOM contract");
function makeVideo(w, h, vw, vh) {
  return {
    clientWidth: w, clientHeight: h, videoWidth: vw, videoHeight: vh,
    isConnected: true,
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; }
  };
}

const video = makeVideo(1000, 1000, 1920, 1080);
TC.state.video = video;
TC.state.crop = { enabled: true, x: 0.25, y: 0, w: 0.5, h: 1, mode: "fill" };
ok("applyCrop returns true", TC.applyCrop() === true);
ok("crop flag set on <html>", root.attrs["data-tc-crop"] === "on");
ok("target marker set on <video>", video.attributes["data-tc-target"] === "1");
ok("fill: --tc-s == 2", root.props["--tc-s"] === "2", root.props);
ok("fill: --tc-ox == 500px", root.props["--tc-ox"] === "500px", root.props);
ok("fill: clip top uses letterbox offset", root.props["--tc-ct"] === "218.75px", root.props);
ok("fill: clip left == region x", root.props["--tc-cl"] === "250px", root.props);

TC.state.crop.mode = "fit";
TC.applyCrop();
ok("fit: --tc-s == 1000/562.5", root.props["--tc-s"] === String(1000 / 562.5), root.props);
ok("fit: clip right == 250px", root.props["--tc-cr"] === "250px", root.props);
ok("fit: clip bottom uses letterbox offset", root.props["--tc-cb"] === "218.75px", root.props);

TC.state.crop.enabled = false;
TC.applyCrop();
ok("disabling removes crop flag", root.attrs["data-tc-crop"] === undefined);
ok("disabling removes video marker", video.attributes["data-tc-target"] === undefined);

console.log("\nregressions found by the fuzzer");
ok("NaN width is rejected, not propagated", Number.isFinite(TC.normalizeCrop({ w: NaN }).w));
ok("Infinity is rejected", Number.isFinite(TC.normalizeCrop({ x: Infinity, y: -Infinity }).x));
ok("string numbers are not coerced", TC.normalizeCrop({ x: "0.5" }).x === 0);
ok("minimum size 0.005 is valid", TC.isCropValid(TC.normalizeCrop({ x: 0, y: 0, w: 0.005, h: 0.005 })));
ok("any normalised crop is valid", (function () {
  var cases = [{}, null, { w: 0.005 }, { w: 1, h: 1 }, { x: 1, y: 1, w: 1, h: 1 }, { w: 0.5, h: 0.5, enabled: true }];
  return cases.every(function (c) { return TC.isCropValid(TC.normalizeCrop(c)); });
})());

console.log("\n" + (fail === 0 ? "ALL " + pass + " CHECKS PASSED" : pass + " passed, " + fail + " FAILED"));
process.exit(fail === 0 ? 0 : 1);
