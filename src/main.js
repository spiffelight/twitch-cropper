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
  // Likewise, a popout carries over whether the loop was running when it was
  // opened; the switches are otherwise never carried between page loads.
  var forceLoopOn = false;
  // True in the player-only popout window, however it was opened.
  var popoutWindow = TC.isPopout === true;

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
      var saved = !!(data.crop && TC.isCropValid(data.crop));
      TC.state.crop = saved ? TC.normalizeCrop(data.crop) : TC.defaultCrop();
      // The numbers are remembered, the switches are not: cropping and looping
      // both start switched off when the extension loads. A popout window is the
      // one exception, and only when something is actually saved to crop there.
      TC.state.crop.enabled = forceCropOn && (saved || !popoutWindow);
      TC.loop.load(data.loop);
      TC.loop.enabled = forceLoopOn;
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
      try { TC.chat.reconcile(); } catch (e) {}
    } else {
      TC.clearCrop();
      TC.loop.stopRuntime();
      try { TC.chat.suspend(); } catch (e) {}
    }

    // The panel is optional. Nothing it does may stop the crop from working.
    try { TC.ui.setActive(active); } catch (e) {}
    try { TC.ui.syncInputs(); } catch (e) {}
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
      loop: TC.loop.enabled,
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
  function beginPopout(width, height, loopOn) {
    forceCropOn = true;
    forceLoopOn = loopOn === true;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}
    if (width && height) {
      try {
        var chromeW = Math.max(0, window.outerWidth - window.innerWidth);
        var chromeH = Math.max(0, window.outerHeight - window.innerHeight);
        browser.runtime.sendMessage({
          type: "tc-resize",
          width: Math.round(width) + chromeW,
          height: Math.round(height) + chromeH
        });
      } catch (e) {}
    }
    try { TC.ui.showReturnBar(); } catch (e) {}
    setActive(true);
    // The popout has its own small controls; it does not need the launcher.
    try { if (TC.ui.hideLauncher) TC.ui.hideLauncher(); } catch (e) {}
    TC.removeStored(POP_KEY);

    // If there was nothing saved to crop for this stream, say so rather than
    // leaving a plain window behind with no explanation.
    setTimeout(function () {
      try {
        // Put the answer in the window's own title bar, so whether this window
        // is cropped is visible without opening anything.
        var on = document.documentElement.getAttribute("data-tc-crop") === "on";
        document.title = on ? "Twitch Cropper \u00b7 cropped" : "Twitch Cropper \u00b7 nothing saved to crop";
        if (!on && TC.ui.toast) TC.ui.toast("No crop saved for this stream yet.");
      } catch (e) {}
    }, 3000);
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
    // Stick with the video we are already cropping while it is still on screen,
    // and only switch when a replacement is actually found. Dropping the video
    // because it momentarily looks unavailable is what flashes the crop off.
    var v = TC.state.video;
    if (!v || !TC.isUsableVideo(v)) {
      var picked = TC.pickVideo();
      if (picked) v = picked;
    }
    if (v && v !== TC.state.video) {
      TC.state.video = v;
      if (TC.state.marked && !TC.state.marked.isConnected) TC.state.marked = null;
    }

    // Only un-crop when cropping is genuinely meant to be off. If it is wanted
    // but the video is momentarily unavailable, leave the last crop applied.
    var wantCrop = active && TC.state.crop.enabled && TC.isCropValid(TC.state.crop);
    if (!wantCrop) TC.clearCrop();
    else if (TC.state.video) TC.applyCrop();

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
      // The panel lives here too, so settings can be changed without leaving.
      TC.getStored("tc.ui", null)
        .catch(function () { return null; })
        .then(function (stored) {
          TC.ui.init(stored || null);
          return TC.getStored(POP_KEY, null).catch(function () { return null; });
        })
        .then(function (req) {
          // The size may arrive in the URL, in the record written just before the
          // window opened, or both; whichever survived is used.
          var ours = TC.isOurPopout(req, location.pathname + location.search, Date.now());
          var loopOn = ours ? req.loop === true : false;
          // Any player-only window is cropped: it is a bare view of a stream,
          // and a stream with nothing saved is left exactly as it is. Using the
          // window is what matters, not how it was opened.
          if (m) beginPopout(parseInt(m[1], 10), parseInt(m[2], 10), loopOn);
          else if (ours) beginPopout(req.w, req.h, loopOn);
          else beginPopout(null, null, false);
          start();
        })
        .catch(function () {
          // Whatever failed above - the panel not building, say - the crop still
          // has to happen, and the window still needs a way back.
          try {
            if (m) beginPopout(parseInt(m[1], 10), parseInt(m[2], 10), false);
            else beginPopout(null, null, false);
          } catch (e) {}
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
