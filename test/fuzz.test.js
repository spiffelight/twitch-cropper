"use strict";
/*
 * Stress test: hammer every pure function with hostile input.
 *
 * A seeded PRNG is used so a failure is reproducible: the same iteration index
 * fails every run. Nothing here asserts exact values, only invariants that must
 * hold for *any* input — no exceptions, finite numbers, and the crop geometry
 * staying inside the picture.
 */

const fs = require("fs");
const path = require("path");

let checks = 0;
let failures = 0;
const seen = new Set();

function fail(what, detail) {
  failures++;
  if (!seen.has(what)) {
    seen.add(what);
    console.log("  FAIL " + what + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
  }
}
function ok(cond, what, detail) {
  checks++;
  if (!cond) fail(what, detail);
}

// ---- deterministic PRNG ----------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xc0ffee);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

function weirdNumber() {
  const r = rnd();
  if (r < 0.08) return NaN;
  if (r < 0.14) return Infinity;
  if (r < 0.2) return -Infinity;
  if (r < 0.45) return (rnd() - 0.5) * 4;
  if (r < 0.75) return rnd();
  return rnd() * 2000 - 500;
}
function weirdValue() {
  const r = rnd();
  if (r < 0.05) return null;
  if (r < 0.1) return undefined;
  if (r < 0.15) return "abc";
  if (r < 0.2) return [];
  if (r < 0.25) return {};
  if (r < 0.3) return true;
  return weirdNumber();
}
function garbage() {
  return pick([null, undefined, 0, 1, "", "x", ":", "::", [], [1, 2], {}, true, false, NaN, Infinity, () => {}, Symbol ? "sym" : "s"]);
}

// ---- environment -----------------------------------------------------------
const root = {
  attrs: {},
  props: {},
  setAttribute(k, v) { this.attrs[k] = v; },
  removeAttribute(k) { delete this.attrs[k]; },
  style: { setProperty(k, v) { root.props[k] = v; } }
};

global.__fit = "contain";
global.window = global;
global.location = { pathname: "/", hostname: "www.twitch.tv", search: "" };
global.document = {
  documentElement: root,
  querySelectorAll: () => [],
  querySelector: () => null
};
global.getComputedStyle = () => ({
  objectFit: global.__fit,
  display: "block",
  visibility: "visible"
});

eval(fs.readFileSync(path.join(__dirname, "..", "src", "core.js"), "utf8"));
const TC = global.window.__TC;

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
const num = (s) => (typeof s === "string" ? parseFloat(s) : NaN);

const N = 20000;

console.log("\nparseTime / formatTime (" + N + " iterations each)");
for (let i = 0; i < N; i++) {
  let s;
  const r = rnd();
  if (r < 0.3) s = garbage();
  else if (r < 0.6) s = pick(["", ":", "::", "1", "1:", "1:2", "1:2:3", "1:2:3:4", "a:b:c", " 5 ", "-3", "1.5.5"]);
  else s = String(rnd() * 10).slice(0, 6) + (rnd() < 0.5 ? ":" + String(rnd() * 10).slice(0, 6) : "");
  let out;
  try {
    out = TC.parseTime(s);
  } catch (e) {
    fail("parseTime threw", { input: s, error: String(e) });
    continue;
  }
  ok(out === null || (typeof out === "number" && isFinite(out) && out >= 0), "parseTime result shape", { s, out });
}
for (let i = 0; i < N; i++) {
  const n = weirdNumber();
  let out;
  try {
    out = TC.formatTime(n);
  } catch (e) {
    fail("formatTime threw", { input: String(n) });
    continue;
  }
  ok(typeof out === "string" && out.length > 0, "formatTime returns a string", { n: String(n), out });
}

console.log("\nnormalizeCrop / isCropValid (" + N + " iterations)");
for (let i = 0; i < N; i++) {
  const raw = {
    x: weirdValue(), y: weirdValue(), w: weirdValue(), h: weirdValue(),
    enabled: weirdValue(), mode: weirdValue()
  };
  let c;
  try {
    c = TC.normalizeCrop(raw);
  } catch (e) {
    fail("normalizeCrop threw", { raw: Object.keys(raw) });
    continue;
  }
  ok(isFinite(c.x) && isFinite(c.y) && isFinite(c.w) && isFinite(c.h), "normalizeCrop finite", c);
  ok(c.x >= 0 && c.y >= 0 && c.w > 0 && c.h > 0, "normalizeCrop positive", c);
  ok(c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9, "normalizeCrop inside the frame", c);
  ok(c.mode === "fit" || c.mode === "fill", "normalizeCrop mode", c.mode);
  ok(TC.isCropValid(c) === true, "normalized crop is always valid", c);
}
for (const g of [null, undefined, 0, "", "x", [], [1, 2], {}, true, NaN, Infinity, { x: {} }, { w: "9" }]) {
  let c;
  try {
    c = TC.normalizeCrop(g);
  } catch (e) {
    fail("normalizeCrop threw on garbage", { g: String(g) });
    continue;
  }
  ok(TC.isCropValid(c), "garbage normalizes to a valid crop", { g: String(g), c });
}
for (let i = 0; i < N; i++) {
  const v = weirdValue();
  let out;
  try {
    out = TC.isCropValid(v);
  } catch (e) {
    fail("isCropValid threw", { v: String(v) });
    continue;
  }
  ok(typeof out === "boolean", "isCropValid returns boolean");
}

console.log("\ncontentBox / computeTransform (" + N + " iterations)");
for (let i = 0; i < N; i++) {
  const W = 1 + rnd() * 3000;
  const H = 1 + rnd() * 3000;
  const vw = pick([0, 640, 1280, 1920, 3440]);
  const vh = pick([0, 360, 720, 1080, 1440]);
  global.__fit = pick(["contain", "cover", "fill", "none"]);

  let cb;
  try {
    cb = TC.contentBox({ videoWidth: vw, videoHeight: vh }, W, H);
  } catch (e) {
    fail("contentBox threw", { W, H, vw, vh });
    continue;
  }
  ok(cb.w > 0 && cb.h > 0, "contentBox has size", cb);
  if (global.__fit === "cover") {
    // object-fit:cover deliberately overflows the element — the element crops it.
    ok(
      cb.x <= 1e-6 && cb.y <= 1e-6 && cb.x + cb.w >= W - 1e-6 && cb.y + cb.h >= H - 1e-6,
      "cover content box covers the element",
      { cb, W, H }
    );
  } else {
    ok(cb.x >= -1e-6 && cb.y >= -1e-6, "contentBox origin >= 0", cb);
    ok(cb.x + cb.w <= W + 1e-6 && cb.y + cb.h <= H + 1e-6, "contentBox inside the element", { cb, W, H });
  }

  const crop = TC.normalizeCrop({ x: rnd(), y: rnd(), w: 0.01 + rnd(), h: 0.01 + rnd() });
  const rx = cb.x + crop.x * cb.w;
  const ry = cb.y + crop.y * cb.h;
  const rw = crop.w * cb.w;
  const rh = crop.h * cb.h;

  for (const mode of ["fit", "fill"]) {
    const t = TC.computeTransform(crop, W, H, cb, mode);
    if (!t) { fail("computeTransform returned null for a valid crop", { crop, W, H, cb, mode }); continue; }
    ok(isFinite(t.s) && t.s > 0, "scale is finite and positive", t);
    ok([t.ox, t.oy, t.tx, t.ty].every(isFinite), "transform is finite", t);
    ok([t.clip.top, t.clip.right, t.clip.bottom, t.clip.left].every(isFinite), "clip is finite", t.clip);

    const mapX = (x) => t.s * (x - t.ox) + t.ox + t.tx;
    const mapY = (y) => t.s * (y - t.oy) + t.oy + t.ty;
    const aX = mapX(rx), bX = mapX(rx + rw);
    const aY = mapY(ry), bY = mapY(ry + rh);
    const mw = bX - aX;
    const mh = bY - aY;

    if (mode === "fill") {
      ok(aX <= 1e-6 && bX >= W - 1e-6, "fill covers width", { aX, bX, W });
      ok(aY <= 1e-6 && bY >= H - 1e-6, "fill covers height", { aY, bY, H });
    } else {
      ok(mw <= W + 1e-6 && mh <= H + 1e-6, "fit stays inside", { mw, mh, W, H });
      ok(Math.abs(Math.max(mw / W, mh / H) - 1) < 1e-6, "fit touches one axis", { mw, mh, W, H });
      ok(Math.abs(aX - (W - mw) / 2) < 1e-6 && Math.abs(aY - (H - mh) / 2) < 1e-6, "fit is centred", { aX, aY, mw, mh, W, H });
    }
  }
}

console.log("\napplyCrop (5000 iterations)");
const VARS = ["--tc-s", "--tc-ox", "--tc-oy", "--tc-tx", "--tc-ty", "--tc-ct", "--tc-cr", "--tc-cb", "--tc-cl"];
for (let i = 0; i < 5000; i++) {
  const v = makeVideo(
    10 + rnd() * 2000,
    10 + rnd() * 2000,
    pick([0, 640, 1280, 1920]),
    pick([0, 360, 720, 1080])
  );
  TC.state.video = v;
  TC.state.crop = TC.normalizeCrop({
    x: rnd(), y: rnd(), w: 0.01 + rnd(), h: 0.01 + rnd(),
    enabled: rnd() < 0.8, mode: pick(["fit", "fill"])
  });
  global.__fit = pick(["contain", "cover", "fill", "none"]);

  let threw = null;
  try {
    TC.applyCrop();
  } catch (e) {
    threw = String(e);
  }
  if (threw) { fail("applyCrop threw", { i, error: threw }); continue; }

  if (root.attrs["data-tc-crop"] === "on") {
    // The flag may still be on from an earlier video: a video with no intrinsic
    // size is deliberately left alone rather than un-cropped, so it must not be
    // marked either.
    if (v.videoWidth && v.videoHeight) {
      ok(v.attributes["data-tc-target"] === "1", "target marked when cropping", v.attributes);
    } else {
      ok(v.attributes["data-tc-target"] === undefined, "no-size video left unmarked", v.attributes);
    }
    for (const k of VARS) ok(isFinite(num(root.props[k])), "css var is a finite number: " + k, root.props[k]);
  } else {
    ok(v.attributes["data-tc-target"] === undefined, "target unmarked when not cropping");
  }
}
// turning it off must always clean up
TC.state.crop = TC.defaultCrop();
TC.state.crop.enabled = false;
TC.applyCrop();
ok(root.attrs["data-tc-crop"] === undefined, "disabling removes the crop flag");

console.log(
  "\n" +
    (failures ? failures + " FAILED of " + checks + " checks" : "ALL " + checks + " CHECKS PASSED")
);
process.exit(failures ? 1 : 0);
