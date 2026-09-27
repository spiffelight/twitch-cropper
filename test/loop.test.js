"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

// ---- fake environment -----------------------------------------------------
const listeners = {};
global.window = global;
global.location = { pathname: "/videos/123", hostname: "www.twitch.tv" };
global.document = {
  hidden: false,
  documentElement: { removeAttribute() {}, setAttribute() {}, style: { setProperty() {} } },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener: () => {}
};
global.getComputedStyle = () => ({ objectFit: "contain", display: "block", visibility: "visible" });

let rafCb = null;
global.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };
global.cancelAnimationFrame = () => { rafCb = null; };

eval(fs.readFileSync(path.join(__dirname, "..", "src", "core.js"), "utf8"));
eval(fs.readFileSync(path.join(ROOT, "src", "loop.js"), "utf8"));
const TC = global.window.__TC;

TC.canLoopHere = () => true;            // pretend we are on a VOD
let uiEvents = [];
TC.ui = { onLoopStateChange: (r) => uiEvents.push(r) };

function makeVideo(duration) {
  const v = { duration, paused: false, seeking: false, isConnected: true, seeks: [], pauses: 0 };
  v.pause = () => { v.pauses++; v.paused = true; };
  const subs = {};
  v.addEventListener = (type, fn) => { (subs[type] = subs[type] || []).push(fn); };
  v.removeEventListener = (type, fn) => {
    if (subs[type]) subs[type] = subs[type].filter((f) => f !== fn);
  };
  v.emit = (type) => { (subs[type] || []).slice().forEach((f) => f()); };
  let t = 0;
  Object.defineProperty(v, "currentTime", {
    get() { return t; },
    set(x) { t = x; v.seeks.push(x); }
  });
  return v;
}

const timeupdate = listeners.timeupdate && listeners.timeupdate[0];
console.log("\nloop.js registration");
ok("timeupdate fallback registered", typeof timeupdate === "function");

const v = makeVideo(100);
TC.state.video = v;

console.log("\nforeground frame loop");
TC.loop.reset();
TC.loop.load({ enabled: true, start: 10, stop: 20, maxLoops: 0 });
TC.loop.startRuntime();
ok("runtime started", TC.loop.running === true);
v.currentTime = 15; v.seeks.length = 0;
rafCb && rafCb();
ok("does not loop before the stop point", v.seeks.length === 0, v.seeks);
v.currentTime = 20; v.seeks.length = 0;
rafCb && rafCb();
ok("loops back to start at the stop point", v.seeks.length === 1 && v.seeks[0] === 10, v.seeks);
ok("loop counter increments", TC.loop.loops === 1, TC.loop.loops);
ok("seeking latch engaged", TC.loop.seeking === true);
v.emit("seeked");
ok("seeked event releases the latch", TC.loop.seeking === false);

v.paused = true;
v.currentTime = 25; v.seeks.length = 0;
rafCb && rafCb();
ok("paused video is not looped", v.seeks.length === 0);
v.paused = false;

console.log("\nstop point past the end of the video");
TC.loop.load({ enabled: true, start: 50, stop: 500, maxLoops: 0 });
TC.loop.startRuntime();
v.currentTime = 100; v.seeks.length = 0;
rafCb && rafCb();
ok("stop is clamped to duration and still loops", v.seeks.length === 1 && v.seeks[0] === 50, v.seeks);
v.emit("seeked");

console.log("\nbackground-tab fallback (requestAnimationFrame is paused)");
TC.loop.load({ enabled: true, start: 10, stop: 20, maxLoops: 0 });
TC.loop.startRuntime();
document.hidden = true;
v.currentTime = 20; v.seeks.length = 0;
timeupdate();
ok("timeupdate fallback loops in a hidden tab", v.seeks.length === 1 && v.seeks[0] === 10, v.seeks);
v.emit("seeked");

document.hidden = false;
v.currentTime = 20; v.seeks.length = 0;
timeupdate();
ok("fallback stays out of the way when visible", v.seeks.length === 0, v.seeks);

console.log("\nmaxLoops");
TC.loop.load({ enabled: true, start: 10, stop: 20, maxLoops: 2 });
TC.loop.startRuntime();
document.hidden = true;
v.currentTime = 20; timeupdate();
ok("first repeat", TC.loop.loops === 1, TC.loop.loops);
v.emit("seeked");
v.currentTime = 20; timeupdate();
ok("second repeat", TC.loop.loops === 2, TC.loop.loops);
v.emit("seeked");
v.currentTime = 20; timeupdate();
ok("stops after maxLoops", TC.loop.running === false && TC.loop.done === true, {
  running: TC.loop.running, done: TC.loop.done, loops: TC.loop.loops
});
v.currentTime = 20; timeupdate();
ok("does not restart itself after finishing", TC.loop.running === false && TC.loop.loops === 2);

console.log("\nfinishing: stop after the last loop (default) or play on");
TC.loop.load({ enabled: true, start: 10, stop: 20, maxLoops: 1 });
TC.loop.startRuntime();
document.hidden = true;
v.paused = false;
v.currentTime = 20; timeupdate();
v.emit("seeked");
v.pauses = 0;
v.currentTime = 20; timeupdate();
ok("default stops playback after the last loop", v.pauses === 1 && TC.loop.done === true, { pauses: v.pauses, done: TC.loop.done });

TC.loop.load({ enabled: true, start: 10, stop: 20, maxLoops: 1, continueAfter: true });
TC.loop.startRuntime();
v.paused = false;
v.pauses = 0;
v.currentTime = 20; timeupdate();
v.emit("seeked");
v.currentTime = 20; timeupdate();
ok("Continue after max loops keeps playing", v.pauses === 0 && TC.loop.done === true, { pauses: v.pauses, done: TC.loop.done });

ok("continueAfter round-trips through serialize", TC.loop.serialize().continueAfter === true);
ok("and defaults to off", (function () { TC.loop.load({ enabled: true, start: 1, stop: 2 }); return TC.loop.serialize().continueAfter === false; })());

console.log("\nstart < stop validation");
TC.loop.load({ enabled: true, start: 30, stop: 20, maxLoops: 0 });
TC.loop.startRuntime();
ok("refuses to run when stop <= start", TC.loop.running === false);

console.log("\n" + (fail === 0 ? "ALL " + pass + " CHECKS PASSED" : pass + " passed, " + fail + " FAILED"));
process.exit(fail === 0 ? 0 : 1);
