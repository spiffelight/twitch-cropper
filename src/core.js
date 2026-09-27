/*
 * Twitch Cropper - core.
 *
 * Loaded first. Provides the shared namespace (`window.__TC`), small utilities,
 * promise-based storage helpers, Twitch page/video discovery, and the crop
 * engine that maps a normalised crop rectangle onto the real <video> element.
 */

(function () {
  "use strict";

  var TC = (window.__TC = window.__TC || {});
  if (TC.__coreReady) return;
  TC.__coreReady = true;

  var PREFIX = "[Twitch Cropper]";

  TC.DEBUG = false;
  TC.log = function () {
    if (!TC.DEBUG) return;
    try {
      console.log.apply(console, [PREFIX].concat(Array.prototype.slice.call(arguments)));
    } catch (e) {}
  };
  TC.warn = function () {
    try {
      console.warn.apply(console, [PREFIX].concat(Array.prototype.slice.call(arguments)));
    } catch (e) {}
  };

  /* ------------------------------------------------------------------ utils */

  TC.clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // Accepts "hh:mm:ss", "mm:ss", "ss" (and decimals). Returns seconds or null.
  TC.parseTime = function (value) {
    if (value === null || value === undefined) return null;
    var str = String(value).trim();
    if (!str) return null;
    var parts = str.split(":");
    if (parts.length === 0 || parts.length > 3) return null;
    var nums = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p === "" || !/^\d+(\.\d+)?$/.test(p)) return null;
      nums.push(parseFloat(p));
    }
    var sec;
    if (nums.length === 1) sec = nums[0];
    else if (nums.length === 2) sec = nums[0] * 60 + nums[1];
    else sec = nums[0] * 3600 + nums[1] * 60 + nums[2];
    return isFinite(sec) ? sec : null;
  };

  TC.formatTime = function (seconds) {
    var sec = Math.floor(isFinite(seconds) && seconds > 0 ? seconds : 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : pad2(m) + ":" + pad2(s);
  };

  /* ---------------------------------------------------------------- storage */

  var hasStorage = false;
  try {
    hasStorage = typeof browser !== "undefined" && !!browser.storage && !!browser.storage.local;
  } catch (e) {}
  TC.hasStorage = hasStorage;

  TC.getStored = function (key, fallback) {
    if (!hasStorage) return Promise.resolve(fallback);
    return browser.storage.local
      .get(key)
      .then(function (obj) {
        return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
      })
      .catch(function () {
        return fallback;
      });
  };

  TC.setStored = function (key, value) {
    if (!hasStorage) return Promise.resolve();
    var obj = {};
    obj[key] = value;
    return browser.storage.local.set(obj).catch(function () {});
  };

  TC.removeStored = function (key) {
    if (!hasStorage) return Promise.resolve();
    return browser.storage.local.remove(key).catch(function () {});
  };

  // Wipe every setting this extension has ever stored.
  TC.clearAllStored = function () {
    if (!hasStorage) return Promise.resolve();
    return browser.storage.local.clear().catch(function () {});
  };

  /* -------------------------------------------------------------- page info */

  var RESERVED = {
    directory: 1, videos: 1, settings: 1, subscriptions: 1, inventory: 1,
    wallet: 1, drops: 1, friends: 1, search: 1, downloads: 1, jobs: 1,
    turbo: 1, p: 1, privacy: 1, following: 1, u: 1, gift: 1, products: 1,
    store: 1, creatorcamp: 1, prime: 1
  };

  // True on Twitch's player-only popout host, where our content script also runs.
  TC.isPopout = location.hostname === "player.twitch.tv";

  TC.pageInfo = function () {
    var info = { channel: null, videoId: null, clip: null, kind: "other" };
    var segs = location.pathname.split("/").filter(Boolean);

    if (location.hostname === "clips.twitch.tv") {
      info.kind = "clip";
      info.clip = segs[0] || null;
      return info;
    }
    if (TC.isPopout) {
      var query = new URLSearchParams(location.search);
      var popChannel = query.get("channel");
      var popVideo = query.get("video");
      if (popChannel) info.channel = popChannel.toLowerCase();
      if (popVideo) {
        info.kind = "vod";
        info.videoId = popVideo;
      } else if (popChannel) {
        info.kind = "channel";
      }
      return info;
    }
    if (!segs.length) return info;

    var first = segs[0];
    if (first === "videos") {
      info.kind = "vod";
      info.videoId = segs[1] || null;
      return info;
    }
    if (first === "clip") {
      info.kind = "clip";
      info.clip = segs[1] || null;
      return info;
    }
    if (!RESERVED[first]) {
      info.channel = first.toLowerCase();
      if (segs[1] === "videos" && segs[2]) {
        info.kind = "vod";
        info.videoId = segs[2];
      } else if (segs[1] === "clip" && segs[2]) {
        info.kind = "clip";
        info.clip = segs[2];
      } else {
        info.kind = "channel";
      }
    }
    return info;
  };

  // Best-effort channel name from the DOM (useful on VOD/clip pages where the
  // channel is not in the URL).
  TC.domChannel = function () {
    try {
      var el =
        document.querySelector('[data-a-target="channel-name"]') ||
        document.querySelector('[data-a-target="video-info-channel"]') ||
        document.querySelector('[data-test-selector="channel-name"]');
      if (el && el.textContent) {
        var t = el.textContent.trim().toLowerCase().replace(/^#/, "");
        if (t) return t;
      }
      var bar = document.querySelector('[data-a-target="channel-info-bar"] a[href^="/"]');
      if (bar) {
        var h = bar.getAttribute("href").split("/").filter(Boolean)[0];
        if (h && !RESERVED[h]) return h.toLowerCase();
      }
    } catch (e) {}
    return null;
  };

  /* --------------------------------------------------------- crop defaults */

  // Smallest allowed crop side, as a fraction of the picture. normalizeCrop and
  // isCropValid must agree on this or a crop sitting exactly on the minimum is
  // produced and then rejected, and silently stops applying.
  var MIN_CROP = 0.005;

  TC.defaultCrop = function () {
    return { enabled: false, x: 0, y: 0, w: 1, h: 1, mode: "fit" };
  };

  TC.normalizeCrop = function (raw) {
    var c = TC.defaultCrop();
    if (!raw || typeof raw !== "object") return c;
    c.enabled = !!raw.enabled;
    c.mode = raw.mode === "fill" ? "fill" : "fit";
    // Number.isFinite, not typeof: typeof NaN is "number", and a NaN that got
    // into storage would otherwise survive into the CSS and break the crop.
    c.x = Number.isFinite(raw.x) ? TC.clamp(raw.x, 0, 1) : 0;
    c.y = Number.isFinite(raw.y) ? TC.clamp(raw.y, 0, 1) : 0;
    c.w = Number.isFinite(raw.w) ? TC.clamp(raw.w, MIN_CROP, 1) : 1;
    c.h = Number.isFinite(raw.h) ? TC.clamp(raw.h, MIN_CROP, 1) : 1;
    if (c.x + c.w > 1) c.x = Math.max(0, 1 - c.w);
    if (c.y + c.h > 1) c.y = Math.max(0, 1 - c.h);
    return c;
  };

  TC.isCropValid = function (c) {
    return !!(
      c &&
      typeof c.x === "number" && typeof c.y === "number" &&
      typeof c.w === "number" && typeof c.h === "number" &&
      c.w >= MIN_CROP && c.h >= MIN_CROP && c.w <= 1.0001 && c.h <= 1.0001 &&
      c.x >= -0.0001 && c.y >= -0.0001 &&
      c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001
    );
  };

  /* -------------------------------------------------------- video discovery */

  TC.state = {
    active: false,
    crop: TC.defaultCrop(),
    loop: null,
    video: null,
    marked: null,
    scopeId: null,
    cropKey: null,
    loopKey: null
  };

  var CROP_ATTR = "data-tc-target";

  function isUsable(video) {
    if (!video || !video.isConnected) return false;
    var r = video.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) return false;
    var cs = getComputedStyle(video);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  // Exposed so the bootstrap can tell whether the video it is already using is
  // still on screen, rather than re-picking and flapping between elements.
  TC.isUsableVideo = isUsable;

  // Pick the most "primary" video on the page: the big, visible, playing one.
  TC.pickVideo = function () {
    var all = document.querySelectorAll("video");
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < all.length; i++) {
      var v = all[i];
      if (!isUsable(v)) continue;
      var r = v.getBoundingClientRect();
      var score = r.width * r.height;
      if (v.readyState > 0) score += 1e7;
      if (v.videoWidth) score += 1e6;
      if (!v.paused) score += 1e5;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  };

  // Where the actual picture sits inside the element, honouring object-fit.
  TC.contentBox = function (video, W, H) {
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    var fit = "contain";
    try {
      fit = getComputedStyle(video).objectFit || "contain";
    } catch (e) {}

    if (!vw || !vh || fit === "fill" || fit === "none") {
      return { x: 0, y: 0, w: W, h: H };
    }
    var boxAR = W / H;
    var vidAR = vw / vh;
    if (fit === "contain") {
      if (vidAR > boxAR) {
        var h1 = W / vidAR;
        return { x: 0, y: (H - h1) / 2, w: W, h: h1 };
      }
      var w1 = H * vidAR;
      return { x: (W - w1) / 2, y: 0, w: w1, h: H };
    }
    // cover
    if (vidAR > boxAR) {
      var w2 = H * vidAR;
      return { x: (W - w2) / 2, y: 0, w: w2, h: H };
    }
    var h2 = W / vidAR;
    return { x: 0, y: (H - h2) / 2, w: W, h: h2 };
  };

  /*
   * Map the selected region onto the video element.
   *
   *   rx, ry, rw, rh = the region, in the element's own pixel coordinates
   *   origin  = centre of the region   -> the zoom happens about it
   *   offset  = moves that centre to the element's centre (W/2, H/2)
   *
   * "fit"  (default): scale = min(W/rw, H/rh). The region is enlarged to fill
   *                   the element in one axis and letterboxed in the other, so
   *                   the whole crop is visible and the player takes its shape.
   * "fill":           scale = max(W/rw, H/rh). The region fills the element in
   *                   both axes, trimming the overhanging edges.
   *
   * The returned `clip` is where the region sits in the element's *local*
   * coordinates. clip-path is applied before the transform, and the transform
   * maps that rectangle to a centred box of size (rw*s, rh*s) — so clipping to
   * it hides the rest of the frame in "fit" mode and is a harmless no-op in
   * "fill" mode (where that box already covers the element).
   */
  TC.computeTransform = function (crop, W, H, cb, mode) {
    var rw = crop.w * cb.w;
    var rh = crop.h * cb.h;
    if (rw <= 0.001 || rh <= 0.001 || W <= 0 || H <= 0) return null;
    var s = mode === "fill" ? Math.max(W / rw, H / rh) : Math.min(W / rw, H / rh);
    var rx = cb.x + crop.x * cb.w;
    var ry = cb.y + crop.y * cb.h;
    var ox = rx + rw / 2;
    var oy = ry + rh / 2;
    return {
      s: s,
      ox: ox,
      oy: oy,
      tx: W / 2 - ox,
      ty: H / 2 - oy,
      clip: {
        top: ry,
        right: W - (rx + rw),
        bottom: H - (ry + rh),
        left: rx
      }
    };
  };

  // The transform currently in force, or null if there is no usable video.
  TC.currentTransform = function () {
    var v = TC.state.video;
    if (!v) return null;
    var W = v.clientWidth || v.getBoundingClientRect().width;
    var H = v.clientHeight || v.getBoundingClientRect().height;
    if (!W || !H) return null;
    return TC.computeTransform(TC.state.crop, W, H, TC.contentBox(v, W, H), TC.state.crop.mode);
  };

  TC.applyCrop = function () {
    var root = document.documentElement;
    var video = TC.state.video;
    var crop = TC.state.crop;

    // Genuinely off: the user switched cropping off, or the rectangle is
    // nonsense. Only this may un-crop.
    if (!crop.enabled || !TC.isCropValid(crop)) {
      TC.clearCrop();
      return false;
    }

    // Everything below is a *transient* problem - the player is between videos,
    // or briefly reports no size. None of these may remove the crop: doing so
    // flashes the uncropped picture for a frame, once per reconcile tick.
    if (!video) return false;

    // Without the video's own size we cannot know where the picture actually
    // sits inside the element (object-fit may be letterboxing it), so the crop
    // would be measured against the wrong box and show a larger area than
    // selected. Treat it as transient and leave the last good crop alone.
    if (!video.videoWidth || !video.videoHeight) return false;

    if (TC.state.marked && TC.state.marked !== video) {
      try {
        TC.state.marked.removeAttribute(CROP_ATTR);
      } catch (e) {}
      TC.state.marked = null;
    }

    var W = video.clientWidth || video.getBoundingClientRect().width;
    var H = video.clientHeight || video.getBoundingClientRect().height;
    if (!W || !H) return false;

    var t = TC.computeTransform(crop, W, H, TC.contentBox(video, W, H), crop.mode);
    if (!t) return false;

    // Doing this on a timer means writing the same values over and over. Skip
    // it when nothing has changed: the repeated style writes are what makes the
    // picture flash back to uncropped for a frame.
    var key = crop.x + "|" + crop.y + "|" + crop.w + "|" + crop.h + "|" +
      crop.mode + "|" + W + "|" + H;
    if (
      TC._appliedVideo === video &&
      TC._appliedKey === key &&
      video.getAttribute(CROP_ATTR) === "1" &&
      root.getAttribute("data-tc-crop") === "on"
    ) {
      return true;
    }

    video.setAttribute(CROP_ATTR, "1");
    TC.state.marked = video;
    TC._appliedVideo = video;
    TC._appliedKey = key;
    root.style.setProperty("--tc-s", String(t.s));
    root.style.setProperty("--tc-ox", t.ox + "px");
    root.style.setProperty("--tc-oy", t.oy + "px");
    root.style.setProperty("--tc-tx", t.tx + "px");
    root.style.setProperty("--tc-ty", t.ty + "px");
    root.style.setProperty("--tc-ct", t.clip.top + "px");
    root.style.setProperty("--tc-cr", t.clip.right + "px");
    root.style.setProperty("--tc-cb", t.clip.bottom + "px");
    root.style.setProperty("--tc-cl", t.clip.left + "px");
    root.setAttribute("data-tc-crop", "on");
    return true;
  };

  TC.clearCrop = function () {
    TC._appliedVideo = null;
    TC._appliedKey = null;
    try {
      document.documentElement.removeAttribute("data-tc-crop");
    } catch (e) {}
    if (TC.state.marked) {
      try {
        TC.state.marked.removeAttribute(CROP_ATTR);
      } catch (e) {}
      TC.state.marked = null;
    }
  };

  // Viewport rect of the visible picture (used by the selection overlay).
  TC.videoContentRect = function (video) {
    var r = video.getBoundingClientRect();
    var cb = TC.contentBox(video, r.width, r.height);
    return {
      left: r.left + cb.x,
      top: r.top + cb.y,
      width: cb.w,
      height: cb.h
    };
  };

  /* ------------------------------------------------------------- popout */

  // Twitch's own player-only popout, stripped of chat and site chrome. Opened
  // at a size we choose so the window matches the shape of the crop.
  TC.popoutUrl = function () {
    var info = TC.pageInfo();
    var params = [];
    if (info.kind === "vod" && info.videoId) {
      params.push("video=" + encodeURIComponent(info.videoId));
    } else if (info.channel) {
      params.push("channel=" + encodeURIComponent(info.channel));
    } else {
      return null;
    }
    params.push("enableExtensions=true");
    params.push("muted=false");
    params.push("parent=twitch.tv");
    params.push("player=popout");
    params.push("quality=auto");
    params.push("volume=0.5");
    return "https://player.twitch.tv/?" + params.join("&");
  };

  // True when a stored popout record means *this* window is one the extension
  // opened: it must be recent, and not the page that asked for it. Anything
  // else (an old record, or Twitch's own popout) is left alone.
  TC.isOurPopout = function (req, atPath, now) {
    if (!req || !req.ts) return false;
    if (now - req.ts > 120000) return false;
    if (req.path && req.path === atPath) return false;
    return true;
  };

  // Where the popout should send its window back to.
  TC.returnUrl = function () {
    var info = TC.pageInfo();
    if (info.kind === "vod" && info.videoId) return "https://www.twitch.tv/videos/" + info.videoId;
    if (info.kind === "clip" && info.clip) return "https://www.twitch.tv/clip/" + info.clip;
    if (info.channel) return "https://www.twitch.tv/" + info.channel;
    return "https://www.twitch.tv/";
  };

  // Window size whose aspect ratio matches the crop, fitted to the screen.
  TC.popoutSize = function () {
    var v = TC.state.video;
    var crop = TC.state.crop;
    var VW = v && v.videoWidth ? v.videoWidth : 16;
    var VH = v && v.videoHeight ? v.videoHeight : 9;
    var aspect = (crop.w * VW) / (crop.h * VH);
    if (!isFinite(aspect) || aspect <= 0) aspect = VW / VH;
    var availW = (typeof screen !== "undefined" && screen.availWidth) || 1280;
    var availH = (typeof screen !== "undefined" && screen.availHeight) || 720;
    var maxW = Math.round(availW * 0.9);
    var maxH = Math.round(availH * 0.9);
    var w = maxW;
    var h = Math.round(w / aspect);
    if (h > maxH) {
      h = maxH;
      w = Math.round(h * aspect);
    }
    return {
      width: Math.min(2400, Math.max(240, w)),
      height: Math.min(2400, Math.max(160, h)),
      aspect: aspect
    };
  };
})();
