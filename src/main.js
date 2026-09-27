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

  var POP_KEY = "tc.popout";
  var RETURN_HASH = "#tc-active";

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
      TC.loop.load(data.loop);
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

  function savePopoutRequest() {
    var size = TC.popoutSize();
    TC.setStored(POP_KEY, {
      url: location.href,
      path: location.pathname + location.search,
      w: size.width,
      h: size.height,
      ts: Date.now()
    });
  }

  function clearPopoutRequest() {
    TC.removeStored(POP_KEY);
  }

  // Open the cropped, player-only view in its own window, sized to the crop.
  // A real window is the only thing that can hide the browser chrome *and* be
  // resized to the crop; a normal tab can do neither.
  TC.enterPopout = function () {
    var url = TC.popoutUrl();
    if (!url) return false;
    var size = TC.popoutSize();
    savePopoutRequest();
    var features =
      "width=" + size.width + ",height=" + size.height +
      ",toolbar=no,menubar=no,scrollbars=no,location=no,status=no,resizable=yes";
    var win = null;
    try {
      win = window.open(url, "_blank", features);
    } catch (e) {}
    if (!win) {
      clearPopoutRequest();
      return "blocked";
    }
    return true;
  };

  // Leave the popout: close the window, or fall back to navigating if the
  // browser will not let us close it.
  TC.returnFromPopout = function (url) {
    clearPopoutRequest();
    try {
      window.close();
    } catch (e) {}
    setTimeout(function () {
      var target = url || "https://www.twitch.tv/";
      location.href = target + (target.indexOf("#") === -1 ? RETURN_HASH : "");
    }, 250);
  };

  function consumeReturnHash() {
    if (location.hash !== RETURN_HASH) return false;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}
    return true;
  }

  /* ------------------------------------------------------------- reconcile */

  function reconcile() {
    var v = TC.pickVideo();
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
    var returning = consumeReturnHash();

    // The player-only popout: apply the crop, offer a way back, no panel.
    if (TC.isPopout) {
      start();
      TC.getStored(POP_KEY, null)
        .then(function (req) {
          // Only act on a popout this extension opened. Twitch's own popout is
          // left completely alone, so "off by default" still holds.
          if (!req || !req.ts || Date.now() - req.ts > 3600000) return;
          setActive(true);
          // window.open's width/height include browser chrome, so correct for
          // it and make the *content* match the crop exactly.
          try {
            var chromeW = Math.max(0, window.outerWidth - window.innerWidth);
            var chromeH = Math.max(0, window.outerHeight - window.innerHeight);
            window.resizeTo(req.w + chromeW, req.h + chromeH);
          } catch (e) {}
          TC.ui.showReturnBar(req.url || null);
        })
        .catch(function () {});
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
        // Coming back from the popout: carry on where we left off.
        if (returning) setActive(true);
        start();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
