/*
 * Twitch Cropper - bootstrap.
 *
 * The extension starts switched OFF on every page load: a Twitch page looks
 * completely untouched, with nothing applied and no UI, until the user turns it
 * on. Saved settings (per channel / per video) are remembered, just not applied
 * until then.
 *
 * Also watches the page (Twitch is a single-page app), keeps the crop transform
 * in sync with the player size, drives the popout window, and reacts to the
 * toolbar button and keyboard shortcuts.
 */

(function () {
  "use strict";

  var TC = window.__TC;
  if (!TC || TC.__mainReady) return;
  TC.__mainReady = true;

  var lastHref = location.href;
  var scopeToken = 0;
  var reconcileQueued = false;
  var active = false;

  // True only inside a popout this extension just opened, which *is* a request
  // to crop. Everywhere else cropping starts switched off.
  var forceCropOn = false;

  // A popout is identified two independent ways, because losing the marker
  // means an uncropped window with no way back: a `#tc=WxH` marker in the URL,
  // and a short-lived record written to storage before the window is opened.
  // Whichever survives, the popout knows it is ours and how big to be.
  var POPOUT_HASH = /#tc=(\d+)x(\d+)/;
  var POP_KEY = "tc.popout";

  /* ------------------------------------------------------------- page keys */

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

  /* ---------------------------------------------------------------- scopes */

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
      // The numbers are remembered, the switches are not: cropping and looping
      // both start switched off when the extension loads.
      TC.state.crop.enabled = forceCropOn;
      TC.loop.load(data.loop);
      TC.loop.enabled = false;
      TC.loop.done = false;
      TC.ui.setScope(ck || lk, info);
      TC.ui.syncInputs();
      reconcile();
    }).catch(function () {});
  }

  /* ------------------------------------------------------------ activation */

  // Turn the whole extension on or off. Off is the default on every load.
  function setActive(next) {
    active = !!next;
    TC.state.active = active;

    if (active) {
      TC.applyCrop();
      if (TC.loop.enabled && TC.canLoopHere() && !TC.loop.done) TC.loop.startRuntime();
      TC.chat.reconcile();
    } else {
      TC.clearCrop();
      TC.loop.stopRuntime();
      TC.chat.suspend();
    }

    TC.ui.setActive(active);
    TC.ui.syncInputs();
  }

  TC.setActive = setActive;
  TC.isActive = function () {
    return active;
  };

  /* ----------------------------------------------------------- popout mode */

  // Move THIS tab into a chrome-less popup window and load the cropped,
  // player-only view in it. This goes through the background because only an
  // extension can create a window without browser chrome.
  TC.enterPopout = function () {
    var base = TC.popoutUrl();
    if (!base) return false;
    var size = TC.popoutSize();
    var url = base + "#tc=" + size.width + "x" + size.height;
    // Record the request *and wait for it* before opening the window, so the
    // popout can identify itself even if the URL marker is dropped on the way.
    TC.setStored(POP_KEY, {
      path: location.pathname + location.search,
      w: size.width,
      h: size.height,
      ts: Date.now()
    }).then(function () {
      try {
        browser.runtime.sendMessage({
          type: "tc-popout",
          url: url,
          width: size.width,
          height: size.height
        });
      } catch (e) {}
    });
    return true;
  };

  // Crop this window and give it a way back. Only ever called when we are sure
  // the popout is one this extension opened, so Twitch's own popout is left be.
  function beginPopout(width, height) {
    forceCropOn = true;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}
    try {
      var chromeW = Math.max(0, window.outerWidth - window.innerWidth);
      var chromeH = Math.max(0, window.outerHeight - window.innerHeight);
      browser.runtime.sendMessage({
        type: "tc-resize",
        width: Math.round(width) + chromeW,
        height: Math.round(height) + chromeH
      });
    } catch (e) {}
    TC.ui.showReturnBar();
    setActive(true);
    TC.removeStored(POP_KEY);

    // If there was nothing saved to crop for this stream, say so rather than
    // leaving a plain window behind with no explanation.
    setTimeout(function () {
      try {
        if (!TC.state.cropKey && TC.ui.toast) TC.ui.toast("No crop saved for this stream yet.");
      } catch (e) {}
    }, 2500);
  }

  // Hand the tab back: the background moves it to a normal window if there is
  // one, restores the normal Twitch page and drops the popup window.
  TC.returnFromPopout = function () {
    try {
      browser.runtime.sendMessage({ type: "tc-return", url: TC.returnUrl() });
    } catch (e) {}
  };

  /* ------------------------------------------------------------- reconcile */

  function reconcile() {
    // Stick with the video we are already cropping while it is still on screen.
    // Twitch can briefly add a second <video> (ads, previews) and re-picking on
    // every tick makes the crop jump between elements and flash.
    var v = TC.state.video;
    if (!v || !TC.isUsableVideo(v)) v = TC.pickVideo();
    if (v !== TC.state.video) {
      TC.state.video = v;
      if (TC.state.marked && !TC.state.marked.isConnected) TC.state.marked = null;
    }

    if (active && TC.state.video && TC.state.crop.enabled) TC.applyCrop();
    else TC.clearCrop();

    if (active && TC.loop.enabled && TC.canLoopHere()) {
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

  /* ---------------------------------------------------------------- boot */

  function start() {
    applyScope();
    reconcile();

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

    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        TC.state.scopeId = null;
        applyScope();
      }
      if (active) TC.chat.reconcile();
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
        if (msg.type === "tc-toggle-active") {
          if (active) setActive(false);
          else { setActive(true); TC.ui.openPanel(); }
        } else if (msg.type === "tc-toggle-panel") {
          if (!active) { setActive(true); TC.ui.openPanel(); }
          else TC.ui.togglePanel();
        } else if (msg.type === "tc-toggle-crop") {
          if (!active) setActive(true);
          else {
            TC.state.crop.enabled = !TC.state.crop.enabled;
            TC.applyCrop();
            TC.ui.syncInputs();
            TC.ui.persistCrop();
          }
        }
      });
    } catch (e) {}
  }

  function init() {
    // The player-only popout this extension opened: crop it and offer a way out.
    if (TC.isPopout) {
      var m = POPOUT_HASH.exec(location.hash);
      if (m) {
        beginPopout(parseInt(m[1], 10), parseInt(m[2], 10));
        start();
        return;
      }
      // The URL marker did not survive, so fall back to the record written just
      // before this window was opened.
      TC.getStored(POP_KEY, null)
        .then(function (req) {
          if (TC.isOurPopout(req, location.pathname + location.search, Date.now())) {
            beginPopout(req.w, req.h);
          }
          start();
        })
        .catch(function () {
          start();
        });
      return;
    }

    TC.getStored("tc.ui", null)
      .then(function (stored) {
        TC.ui.init(stored || null);
      })
      .catch(function () {
        TC.ui.init(null);
      })
      .then(function () {
        return TC.chat.init();
      })
      .then(function () {
        start();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
