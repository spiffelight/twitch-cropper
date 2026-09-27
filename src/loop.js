/*
 * Twitch Cropper - segment loop.
 *
 * Plays [start, stop] on repeat. Only runs on VODs and clips, where the player
 * has a finite timeline; live streams are deliberately left alone.
 *
 * A requestAnimationFrame tick is used instead of `timeupdate` because
 * `timeupdate` only fires ~4 times a second, which would overshoot the stop
 * point by up to a quarter of a second.
 */

(function () {
  "use strict";

  var TC = window.__TC;
  if (!TC || TC.__loopReady) return;
  TC.__loopReady = true;

  var EPS = 0.05; // seconds of tolerance at the stop point

  var L = (TC.loop = {
    enabled: false,
    start: null,
    stop: null,
    maxLoops: 0, // 0 = endless
    continueAfter: false, // after the last loop: false = stop, true = play on
    loops: 0,
    running: false,
    done: false, // reached maxLoops and stopped on purpose
    seeking: false,
    rafId: 0,
    _seekTimer: 0
  });

  L.reset = function () {
    L.enabled = false;
    L.start = null;
    L.stop = null;
    L.maxLoops = 0;
    L.continueAfter = false;
    L.loops = 0;
    L.done = false;
    L.seeking = false;
  };

  L.serialize = function () {
    return {
      enabled: L.enabled,
      start: L.start,
      stop: L.stop,
      maxLoops: L.maxLoops,
      continueAfter: L.continueAfter
    };
  };

  L.load = function (raw) {
    L.reset();
    if (!raw || typeof raw !== "object") return;
    L.enabled = !!raw.enabled;
    L.start = typeof raw.start === "number" && isFinite(raw.start) ? raw.start : null;
    L.stop = typeof raw.stop === "number" && isFinite(raw.stop) ? raw.stop : null;
    L.maxLoops = typeof raw.maxLoops === "number" && raw.maxLoops > 0 ? Math.floor(raw.maxLoops) : 0;
    L.continueAfter = !!raw.continueAfter;
  };

  // Looping only makes sense on VODs and clips with a real, finite timeline.
  TC.canLoopHere = function () {
    var info = TC.pageInfo();
    if (info.kind !== "vod" && info.kind !== "clip") return false;
    var v = TC.state.video;
    if (!v) return false;
    try {
      return Number.isFinite(v.duration) && v.duration > 0;
    } catch (e) {
      return false;
    }
  };

  function effectiveStop() {
    var v = TC.state.video;
    var duration = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    var stop = L.stop != null ? L.stop : duration;
    // A stop time past the end of the video would otherwise never be reached.
    if (stop != null && duration != null) stop = Math.min(stop, duration);
    return stop;
  }

  function schedule() {
    if (!L.running || L.rafId) return;
    L.rafId = requestAnimationFrame(tick);
  }

  function doSeek(seconds) {
    var v = TC.state.video;
    if (!v) return;
    L.seeking = true;
    try {
      v.currentTime = seconds;
    } catch (e) {}

    var done = function () {
      v.removeEventListener("seeked", done);
      clearTimeout(L._seekTimer);
      L.seeking = false;
    };
    v.addEventListener("seeked", done);
    clearTimeout(L._seekTimer);
    L._seekTimer = setTimeout(done, 1500);
  }

  function finish(reason) {
    L.running = false;
    L.done = reason === "done";
    if (L.rafId) cancelAnimationFrame(L.rafId);
    L.rafId = 0;
    if (TC.ui && TC.ui.onLoopStateChange) TC.ui.onLoopStateChange(reason);
  }

  // Jump back if we have reached the stop point. Shared by the frame loop and
  // the background fallback so both use identical logic.
  function maybeLoop() {
    var v = TC.state.video;
    if (!v || !v.isConnected) return;
    var start = L.start;
    var stop = effectiveStop();
    if (start == null || stop == null || stop <= start) return;
    if (v.paused || v.seeking || L.seeking) return;
    if (v.currentTime < stop - EPS) return;

    if (L.maxLoops > 0 && L.loops >= L.maxLoops) {
      // Stopping after the last loop is the default; "Continue after max loops"
      // leaves playback running past the stop point instead.
      if (!L.continueAfter && !v.paused) {
        try {
          v.pause();
        } catch (e) {}
      }
      finish("done");
      return;
    }
    L.loops++;
    doSeek(start);
    if (TC.ui && TC.ui.onLoopStateChange) TC.ui.onLoopStateChange("looped");
  }

  function tick() {
    L.rafId = 0;
    if (!L.running) return;
    maybeLoop();
    schedule();
  }

  // requestAnimationFrame does not run while the tab is hidden, so a loop left
  // running in a background tab would just play on past the stop point. Media
  // playback keeps firing `timeupdate` though, so use it as a coarse fallback.
  // The frame loop stays the precise one whenever the tab is visible.
  function onTimeUpdate() {
    if (!L.running || !document.hidden) return;
    maybeLoop();
  }
  try {
    document.addEventListener("timeupdate", onTimeUpdate, true);
  } catch (e) {}

  L.startRuntime = function () {
    if (L.running) return;
    if (!TC.canLoopHere()) return;
    if (L.start == null || L.start < 0) return;
    var stop = effectiveStop();
    if (stop == null || stop <= L.start) return;
    L.running = true;
    L.done = false;
    L.loops = 0;
    schedule();
    if (TC.ui && TC.ui.onLoopStateChange) TC.ui.onLoopStateChange("started");
  };

  L.stopRuntime = function () {
    if (!L.running && !L.rafId) return;
    L.running = false;
    if (L.rafId) cancelAnimationFrame(L.rafId);
    L.rafId = 0;
    if (TC.ui && TC.ui.onLoopStateChange) TC.ui.onLoopStateChange("stopped");
  };

  // Jump to the start point once, on demand.
  L.jumpToStart = function () {
    if (L.start == null) return false;
    var v = TC.state.video;
    if (!v) return false;
    doSeek(L.start);
    return true;
  };

  // True when the stored settings describe a usable loop.
  L.isConfigured = function () {
    if (!L.enabled || L.start == null) return false;
    var stop = effectiveStop();
    return stop != null && stop > L.start;
  };
})();
