/*
 * Twitch Cropper - bootstrap.
 *
 * Watches the page (Twitch is a single-page app), decides which stored crop /
 * loop applies, keeps the crop transform in sync with the player's size, and
 * reacts to the toolbar button and keyboard shortcuts.
 */

(function () {
  "use strict";

  var TC = window.__TC;
  if (!TC || TC.__mainReady) return;
  TC.__mainReady = true;

  var lastHref = location.href;
  var scopeToken = 0;
  var reconcileQueued = false;

  function cropKey() {
    var info = TC.pageInfo();
    if (info.channel) return "crop:c:" + info.channel;
    var ch = TC.domChannel();
    if (ch) return "crop:c:" + ch;
    if (info.kind === "vod" && info.videoId) return "crop:v:" + info.videoId;
    if (info.kind === "clip" && info.clip) return "crop:k:" + info.clip;
    return null;
  }

  function loopKey() {
    var info = TC.pageInfo();
    if (info.kind === "vod" && info.videoId) return "loop:v:" + info.videoId;
    if (info.kind === "clip" && info.clip) return "loop:k:" + info.clip;
    return null;
  }

  function applyScope() {
    var info = TC.pageInfo();
    var ck = cropKey();
    var lk = loopKey();
    var id = (ck || "-") + "|" + (lk || "-");
    if (id === TC.state.scopeId) return;
    TC.state.scopeId = id;
    TC.state.cropKey = ck;
    TC.state.loopKey = lk;

    var token = ++scopeToken;
    var cropPromise = ck ? TC.getStored(ck, null) : Promise.resolve(null);
    cropPromise.then(function (crop) {
      return (lk ? TC.getStored(lk, null) : Promise.resolve(null)).then(function (loop) {
        return { crop: crop, loop: loop };
      });
    }).then(function (data) {
      if (token !== scopeToken) return;
      TC.state.crop = data.crop && TC.isCropValid(data.crop)
        ? TC.normalizeCrop(data.crop)
        : TC.defaultCrop();
      TC.loop.load(data.loop);
      TC.loop.done = false;
      TC.ui.setScope(ck || lk, info);
      TC.ui.syncInputs();
      reconcile();
    }).catch(function () {});
  }

  function reconcile() {
    var v = TC.pickVideo();
    if (v !== TC.state.video) {
      TC.state.video = v;
      if (TC.state.marked && !TC.state.marked.isConnected) TC.state.marked = null;
    }

    if (TC.state.video && TC.state.crop.enabled) TC.applyCrop();
    else TC.clearCrop();

    if (TC.loop.enabled && TC.canLoopHere()) {
      if (!TC.loop.running && !TC.loop.done) TC.loop.startRuntime();
    } else if (TC.loop.running) {
      TC.loop.stopRuntime();
    }
  }

  function queueReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    requestAnimationFrame(function () {
      reconcileQueued = false;
      reconcile();
    });
  }

  function onVideoEvent() {
    queueReconcile();
    TC.ui.updateCropHint();
  }

  function start() {
    applyScope();
    reconcile();

    // Media element lifecycle.
    ["loadedmetadata", "durationchange", "emptied", "loadstart", "resize"].forEach(function (evt) {
      document.addEventListener(evt, onVideoEvent, true);
    });
    document.addEventListener("fullscreenchange", function () {
      queueReconcile();
    });
    window.addEventListener("resize", function () {
      queueReconcile();
    });

    if (typeof ResizeObserver !== "undefined") {
      try {
        var ro = new ResizeObserver(function () {
          queueReconcile();
        });
        var lastObserved = null;
        setInterval(function () {
          var v = TC.state.video;
          if (v && v !== lastObserved) {
            if (lastObserved) ro.unobserve(lastObserved);
            ro.observe(v);
            lastObserved = v;
          }
        }, 900);
      } catch (e) {}
    }

    // Twitch navigates without reloading, so watch the URL and the DOM.
    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        TC.state.scopeId = null;
        applyScope();
      }
      queueReconcile();
    }, 800);

    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (t && t.nodeType === 1 && TC.state.video && (t === TC.state.video || t.contains(TC.state.video))) {
            queueReconcile();
            return;
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}

    try {
      browser.runtime.onMessage.addListener(function (msg) {
        if (!msg || !msg.type) return;
        if (msg.type === "tc-toggle-panel") {
          TC.ui.togglePanel();
        } else if (msg.type === "tc-toggle-crop") {
          TC.state.crop.enabled = !TC.state.crop.enabled;
          TC.applyCrop();
          TC.ui.syncInputs();
          TC.ui.persistCrop();
        }
      });
    } catch (e) {}
  }

  function init() {
    TC.getStored("tc.ui", null)
      .then(function (stored) {
        TC.ui.init(stored || null);
      })
      .catch(function () {
        TC.ui.init(null);
      })
      .then(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
