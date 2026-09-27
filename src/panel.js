/*
 * Twitch Cropper - user interface.
 *
 * Everything the user sees lives in its own Shadow DOM host, so Twitch's CSS
 * cannot reach it and ours cannot leak into the page. The panel and the
 * launcher button are draggable and remember where you put them.
 */

(function () {
  "use strict";

  var TC = window.__TC;
  if (!TC || TC.__uiReady) return;
  TC.__uiReady = true;

  var UI_KEY = "tc.ui";
  var uiSettings = { fabPos: null, panelPos: null, open: false, collapsed: false };

  var els = {}; // references inside the shadow root
  var fabEls = {};
  var panelHost = null;
  var fabHost = null;
  var syncing = false;
  var saveTimer = 0;

  var PANEL_CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".panel{width:min(262px,calc(100vw - 20px));max-height:calc(100vh - 20px);display:flex;flex-direction:column;background:#18181b;color:#efeff1;border:1px solid #2f2f35;border-radius:12px;",
    "box-shadow:0 12px 34px rgba(0,0,0,.55);font:13px/1.45 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden}",
    ".head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1f1f23;border-bottom:1px solid #2f2f35;cursor:grab;user-select:none;touch-action:none}",
    ".head:active{cursor:grabbing}",
    ".dot{width:20px;height:20px;flex:0 0 auto;border-radius:6px;background:#9147ff;display:grid;place-items:center;font-size:12px;line-height:1}",
    ".name{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".ico{all:unset;cursor:pointer;width:22px;height:22px;display:grid;place-items:center;border-radius:6px;color:#adadb8;font-size:16px}",
    ".ico:hover{background:#2f2f35;color:#fff}",
    ".body{flex:1 1 auto;min-height:0;padding:9px 10px 10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;overflow-x:hidden}",
    ".body>*{flex:0 0 auto}",
    ".panel.collapsed .body{display:none}",
    ".panel.collapsed .foot{display:none}",
    ".sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#adadb8}",
    ".switch{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}",
    ".switch input{position:absolute;opacity:0;width:0;height:0}",
    ".track{width:34px;height:19px;border-radius:19px;background:#3a3a3d;position:relative;transition:background .15s;flex:0 0 auto}",
    ".track::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:transform .15s}",
    ".switch input:checked + .track{background:#9147ff}",
    ".switch input:checked + .track::after{transform:translateX(15px)}",
    ".switch input:focus-visible + .track{outline:2px solid #a970ff;outline-offset:2px}",
    ".btn{all:unset;cursor:pointer;text-align:center;padding:8px 10px;border-radius:8px;font-weight:600;background:#2f2f35;color:#efeff1}",
    ".btn:hover{background:#3d3d44}",
    ".btn.primary{background:#9147ff}",
    ".btn.primary:hover{background:#772ce8}",
    ".row{display:flex;gap:6px;flex-wrap:wrap}",
    ".chip{all:unset;cursor:pointer;flex:1 1 auto;text-align:center;padding:5px 7px;border-radius:7px;background:#26262c;color:#d3d3d9;font-size:11.5px;white-space:nowrap}",
    ".chip:hover{background:#34343c;color:#fff}",
    ".chip.on{background:#9147ff;color:#fff}",
    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}",
    ".field{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#adadb8}",
    ".field input{all:unset;background:#0e0e10;border:1px solid #3a3a3d;border-radius:7px;padding:6px 7px;color:#efeff1;font:12px/1.2 ui-monospace,Menlo,Consolas,monospace}",
    ".field input:focus{border-color:#9147ff}",
    ".field input.invalid{border-color:#e91916}",
    ".hint{font-size:11px;color:#8f8f99;min-height:0}",
    ".hint.warn{color:#ffb31a}",
    ".sep{height:1px;background:#2f2f35;margin:1px 0}",
    ".foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid #2f2f35;background:#161619;font-size:11px;color:#8f8f99}",
    ".foot span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".link{all:unset;cursor:pointer;color:#bf94ff;font-size:11px}",
    ".link:hover{text-decoration:underline}",
    ".disabled{opacity:.45;pointer-events:none}",
    ".fab{width:40px;height:40px;border-radius:50%;background:#18181b;border:1px solid #3a3a3d;",
    "box-shadow:0 6px 18px rgba(0,0,0,.5);display:grid;place-items:center;cursor:pointer;font-size:17px;user-select:none;touch-action:none}",
    ".fab:hover{border-color:#9147ff}",
    ".fab.active{border-color:#9147ff;background:#1f1230}"
  ].join("");

  var PANEL_HTML =
    '<div class="panel" id="panel">' +
    '  <div class="head" id="head">' +
    '    <span class="dot">\u2702</span>' +
    '    <span class="name">Twitch Cropper</span>' +
    '    <button class="ico" id="min" title="Collapse">\u2212</button>' +
    '    <button class="ico" id="close" title="Hide panel (reopen with the \u2702 button or the toolbar icon)">\u2715</button>' +
    "  </div>" +
    '  <div class="body">' +
    '    <div class="sec">Crop</div>' +
    '    <label class="switch"><input type="checkbox" id="enabled"><span class="track"></span><span>Cropping on</span></label>' +
    '    <button class="btn primary" id="select">Select region\u2026</button>' +
    '    <div class="row">' +
    '      <button class="chip" data-mode="fit" title="Show the whole crop and shape the player to it">Fit crop</button>' +
    '      <button class="chip" data-mode="fill" title="Fill the player with the crop, trimming any overhang">Fill player</button>' +
    "    </div>" +
    '    <div class="row">' +
    '      <button class="chip" data-preset="left">Left</button>' +
    '      <button class="chip" data-preset="right">Right</button>' +
    '      <button class="chip" data-preset="top">Top</button>' +
    '      <button class="chip" data-preset="bottom">Bottom</button>' +
    '      <button class="chip" data-preset="center">Centre</button>' +
    "    </div>" +
    '    <div class="grid">' +
    '      <label class="field">X %<input type="number" id="x" min="0" max="100" step="0.5"></label>' +
    '      <label class="field">Y %<input type="number" id="y" min="0" max="100" step="0.5"></label>' +
    '      <label class="field">Width %<input type="number" id="w" min="0" max="100" step="0.5"></label>' +
    '      <label class="field">Height %<input type="number" id="h" min="0" max="100" step="0.5"></label>' +
    "    </div>" +
    '    <div class="row"><button class="chip" id="reset">Reset crop</button></div>' +
    '    <div class="hint" id="cropHint"></div>' +
    '    <div class="sep"></div>' +
    '    <div class="sec">Loop (VODs &amp; clips)</div>' +
    '    <div id="loopWrap">' +
    '      <label class="switch"><input type="checkbox" id="loopEnabled"><span class="track"></span><span>Loop a segment</span></label>' +
    '      <div class="grid" style="margin-top:7px">' +
    '        <label class="field">Start<input type="text" id="loopStart" placeholder="hh:mm:ss"></label>' +
    '        <label class="field">Stop<input type="text" id="loopStop" placeholder="hh:mm:ss"></label>' +
    "      </div>" +
    '      <div class="row" style="margin-top:6px">' +
    '        <button class="chip" id="startNow">Start = now</button>' +
    '        <button class="chip" id="stopNow">Stop = now</button>' +
    '        <button class="chip" id="jumpStart">Jump to start</button>' +
    "      </div>" +
    '      <div class="grid" style="margin-top:6px">' +
    '        <label class="field">Max loops (0 = \u221e)<input type="number" id="maxLoops" min="0" step="1" value="0"></label>' +
    '        <label class="field">Completed<input type="text" id="loopCount" readonly value="0"></label>' +
    "      </div>" +
    '      <div class="hint" id="loopHint"></div>' +
    "    </div>" +
    '    <div class="hint" id="liveNote" style="display:none">Looping is for VODs and clips only.</div>' +
    '    <div class="sep"></div>' +
    '    <div class="sec">Chat</div>' +
    '    <button class="btn" id="chatToggle">Unload chat</button>' +
    '    <div class="hint" id="chatHint"></div>' +
    "  </div>" +
    '  <div class="foot"><span id="scope">Not saved yet</span><button class="link" id="clear">Clear</button></div>' +
    "</div>";

  var FAB_HTML =
    '<div class="fab" id="fab" title="Twitch Cropper (Alt+Shift+P)">\u2702</div>';

  /* --------------------------------------------------------------- helpers */

  function makeHost(id) {
    var host = document.createElement("div");
    host.id = id;
    host.style.cssText = "position:fixed;z-index:2147483600;";
    var shadow = host.attachShadow({ mode: "open" });
    return { host: host, shadow: shadow };
  }

  function mountHost(host) {
    // In fullscreen the browser only paints the fullscreen element's subtree,
    // so the UI moves into it to stay visible.
    var target = document.fullscreenElement || document.body;
    if (host.parentNode !== target) target.appendChild(host);
  }

  function place(host, pos, fallback) {
    var p = pos || fallback;
    var rect = host.getBoundingClientRect();
    var w = rect.width || 40;
    var h = rect.height || 40;
    var x = TC.clamp(p.x, 6, Math.max(6, window.innerWidth - w - 6));
    var y = TC.clamp(p.y, 6, Math.max(6, window.innerHeight - h - 6));
    host.style.left = x + "px";
    host.style.top = y + "px";
    host.style.right = "auto";
    host.style.bottom = "auto";
    return { x: x, y: y };
  }

  function defaultPanelPos() {
    return {
      x: Math.max(8, window.innerWidth - 262 - 14),
      y: 92
    };
  }

  function defaultFabPos() {
    return {
      x: Math.max(8, window.innerWidth - 40 - 14),
      y: Math.max(8, window.innerHeight - 40 - 120)
    };
  }

  function drag(host, handle, onEnd) {
    var dragging = false;
    var moved = false;
    var offX = 0;
    var offY = 0;
    var downX = 0;
    var downY = 0;

    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest("button.chip,.btn,.ico,.link")) return;
      dragging = true;
      moved = false;
      downX = e.clientX;
      downY = e.clientY;
      var r = host.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {}
      // Deliberately no preventDefault() here: cancelling pointerdown can
      // suppress the click event that opens the panel / toggles the launcher.
    });

    handle.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) moved = true;
      var rect = host.getBoundingClientRect();
      var w = rect.width || 40;
      var h = rect.height || 40;
      var x = TC.clamp(e.clientX - offX, 2, Math.max(2, window.innerWidth - w - 2));
      var y = TC.clamp(e.clientY - offY, 2, Math.max(2, window.innerHeight - h - 2));
      host.style.left = x + "px";
      host.style.top = y + "px";
    });

    function stop(e) {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (moved) {
        // A drag that ends over the button must not also count as a click.
        var swallow = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          handle.removeEventListener("click", swallow, true);
        };
        handle.addEventListener("click", swallow, true);
      }
      if (onEnd) onEnd({ x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 });
    }
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  /* ------------------------------------------------------------------ saving */

  function persistUI() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      TC.setStored(UI_KEY, {
        fabPos: uiSettings.fabPos,
        panelPos: uiSettings.panelPos,
        open: uiSettings.open,
        collapsed: uiSettings.collapsed
      });
    }, 300);
  }

  // Crop values change on every keystroke, so coalesce the writes.
  var storeTimers = {};
  function persistDebounced(key, value) {
    if (!key) return;
    clearTimeout(storeTimers[key]);
    storeTimers[key] = setTimeout(function () {
      delete storeTimers[key];
      TC.setStored(key, value);
    }, 250);
  }
  function cancelPersist(key) {
    if (key && storeTimers[key]) {
      clearTimeout(storeTimers[key]);
      delete storeTimers[key];
    }
  }

  /* ------------------------------------------------------------- rendering */

  function setValue(input, value) {
    // Inside a shadow root, document.activeElement is the host, so ask the
    // input's own root who is focused before overwriting what the user typed.
    var rootNode = input.getRootNode ? input.getRootNode() : null;
    var active = (rootNode && rootNode.activeElement) || document.activeElement;
    if (active === input) return;
    if (input.value !== value) input.value = value;
  }

  function syncInputs() {
    if (!els.enabled) return;
    syncing = true;
    try {
      var c = TC.state.crop;
      els.enabled.checked = !!c.enabled;
      setValue(els.x, String(Math.round(c.x * 1000) / 10));
      setValue(els.y, String(Math.round(c.y * 1000) / 10));
      setValue(els.w, String(Math.round(c.w * 1000) / 10));
      setValue(els.h, String(Math.round(c.h * 1000) / 10));
      if (els.modeChips) {
        for (var i = 0; i < els.modeChips.length; i++) {
          els.modeChips[i].classList.toggle(
            "on",
            els.modeChips[i].getAttribute("data-mode") === c.mode
          );
        }
      }

      var L = TC.loop;
      els.loopEnabled.checked = !!L.enabled;
      setValue(els.loopStart, L.start == null ? "" : TC.formatTime(L.start));
      setValue(els.loopStop, L.stop == null ? "" : TC.formatTime(L.stop));
      setValue(els.maxLoops, String(L.maxLoops || 0));
      els.loopCount.value = String(L.loops || 0);

      var canLoop = TC.canLoopHere();
      els.loopWrap.classList.toggle("disabled", !canLoop);
      els.liveNote.style.display = canLoop ? "none" : "";
      updateCropHint();
      updateChatUI();
    } finally {
      syncing = false;
    }
  }

  function updateCropHint() {
    if (!els.cropHint) return;
    var c = TC.state.crop;
    if (!c.enabled) {
      els.cropHint.textContent = "Pick a region to zoom into.";
      els.cropHint.classList.remove("warn");
      return;
    }
    var t = TC.currentTransform();
    if (!t) {
      els.cropHint.textContent = "Waiting for the video\u2026";
      els.cropHint.classList.remove("warn");
      return;
    }
    var zoom = "\u2248" + Math.round(t.s * 100) + "% zoom";
    if (c.mode === "fill") {
      var v = TC.state.video;
      var regAR = (c.w * v.clientWidth) / (c.h * v.clientHeight);
      var boxAR = v.clientWidth / v.clientHeight;
      if (Math.abs(regAR - boxAR) / boxAR > 0.02) {
        els.cropHint.textContent = zoom + " \u00b7 overhanging edges trimmed";
        els.cropHint.classList.add("warn");
        return;
      }
    }
    els.cropHint.textContent = zoom + " \u00b7 whole crop shown";
    els.cropHint.classList.remove("warn");
  }

  function persistCrop() {
    if (!TC.state.cropKey) return;
    persistDebounced(TC.state.cropKey, TC.normalizeCrop(TC.state.crop));
  }

  function persistLoop() {
    if (!TC.state.loopKey) return;
    persistDebounced(TC.state.loopKey, TC.loop.serialize());
  }

  function applyPreset(name) {
    var c = TC.state.crop;
    if (name === "left") {
      c.x = 0; c.y = 0; c.w = 0.5; c.h = 1;
    } else if (name === "right") {
      c.x = 0.5; c.y = 0; c.w = 0.5; c.h = 1;
    } else if (name === "top") {
      c.x = 0; c.y = 0; c.w = 1; c.h = 0.5;
    } else if (name === "bottom") {
      c.x = 0; c.y = 0.5; c.w = 1; c.h = 0.5;
    } else if (name === "center") {
      c.x = 0.15; c.y = 0.15; c.w = 0.7; c.h = 0.7;
    }
    c.enabled = true;
    TC.applyCrop();
    syncInputs();
    persistCrop();
  }

  function setMode(mode) {
    if (mode !== "fit" && mode !== "fill") return;
    TC.state.crop.mode = mode;
    if (TC.state.crop.enabled) TC.applyCrop();
    syncInputs();
    persistCrop();
  }

  function readNumberInput(input, min, max) {
    var v = parseFloat(input.value);
    if (!isFinite(v)) return null;
    return TC.clamp(v, min, max);
  }

  /* ------------------------------------------------------------------ toast */

  function toast(message) {
    try {
      var t = document.createElement("div");
      t.textContent = message;
      t.style.cssText =
        "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);" +
        "background:#18181b;color:#efeff1;border:1px solid #3a3a3d;border-radius:9px;" +
        "padding:8px 13px;font:13px -apple-system,'Segoe UI',Roboto,sans-serif;" +
        "z-index:2147483647;box-shadow:0 8px 22px rgba(0,0,0,.5);pointer-events:none;max-width:70vw;text-align:center;";
      (document.fullscreenElement || document.body).appendChild(t);
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 2600);
    } catch (e) {}
  }

  /* ------------------------------------------------------------ panel setup */

  function buildPanel() {
    var made = makeHost("twitch-cropper-panel");
    panelHost = made.host;
    var shadow = made.shadow;
    var style = document.createElement("style");
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);
    var wrap = document.createElement("div");
    wrap.innerHTML = PANEL_HTML;
    while (wrap.firstChild) shadow.appendChild(wrap.firstChild);
    return shadow;
  }

  function wirePanel(shadow) {
    els.panel = shadow.getElementById("panel");
    els.head = shadow.getElementById("head");
    els.min = shadow.getElementById("min");
    els.close = shadow.getElementById("close");
    els.enabled = shadow.getElementById("enabled");
    els.select = shadow.getElementById("select");
    els.x = shadow.getElementById("x");
    els.y = shadow.getElementById("y");
    els.w = shadow.getElementById("w");
    els.h = shadow.getElementById("h");
    els.reset = shadow.getElementById("reset");
    els.cropHint = shadow.getElementById("cropHint");
    els.loopWrap = shadow.getElementById("loopWrap");
    els.loopEnabled = shadow.getElementById("loopEnabled");
    els.loopStart = shadow.getElementById("loopStart");
    els.loopStop = shadow.getElementById("loopStop");
    els.startNow = shadow.getElementById("startNow");
    els.stopNow = shadow.getElementById("stopNow");
    els.jumpStart = shadow.getElementById("jumpStart");
    els.maxLoops = shadow.getElementById("maxLoops");
    els.loopCount = shadow.getElementById("loopCount");
    els.loopHint = shadow.getElementById("loopHint");
    els.liveNote = shadow.getElementById("liveNote");
    els.chatToggle = shadow.getElementById("chatToggle");
    els.chatHint = shadow.getElementById("chatHint");
    els.scope = shadow.getElementById("scope");
    els.clear = shadow.getElementById("clear");

    els.enabled.addEventListener("change", function () {
      if (syncing) return;
      TC.state.crop.enabled = els.enabled.checked;
      TC.applyCrop();
      syncInputs();
      persistCrop();
    });

    els.select.addEventListener("click", function () {
      TC.select.begin();
    });

    els.reset.addEventListener("click", function () {
      TC.state.crop = TC.defaultCrop();
      TC.state.crop.enabled = false;
      TC.clearCrop();
      syncInputs();
      persistCrop();
    });

    var chips = shadow.querySelectorAll("[data-preset]");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function () {
        applyPreset(this.getAttribute("data-preset"));
      });
    }

    els.modeChips = shadow.querySelectorAll("[data-mode]");
    for (var m = 0; m < els.modeChips.length; m++) {
      els.modeChips[m].addEventListener("click", function () {
        setMode(this.getAttribute("data-mode"));
      });
    }

    function onCropInput() {
      if (syncing) return;
      var x = readNumberInput(els.x, 0, 100);
      var y = readNumberInput(els.y, 0, 100);
      var w = readNumberInput(els.w, 0.5, 100);
      var h = readNumberInput(els.h, 0.5, 100);
      if (x == null || y == null || w == null || h == null) return;
      var c = TC.state.crop;
      c.x = x / 100;
      c.y = y / 100;
      c.w = w / 100;
      c.h = h / 100;
      if (c.x + c.w > 1) c.w = 1 - c.x;
      if (c.y + c.h > 1) c.h = 1 - c.y;
      c.enabled = true;
      TC.applyCrop();
      updateCropHint();
      persistCrop();
    }
    [els.x, els.y, els.w, els.h].forEach(function (input) {
      input.addEventListener("input", onCropInput);
      input.addEventListener("change", function () {
        onCropInput();
        syncInputs();
      });
    });

    els.loopEnabled.addEventListener("change", function () {
      if (syncing) return;
      TC.loop.enabled = els.loopEnabled.checked;
      if (TC.loop.enabled) {
        TC.loop.loops = 0;
        TC.loop.startRuntime();
      } else {
        TC.loop.stopRuntime();
      }
      updateLoopHint();
      persistLoop();
    });

    function onTimeInput() {
      if (syncing) return;
      var s = TC.parseTime(els.loopStart.value);
      var e = TC.parseTime(els.loopStop.value);
      els.loopStart.classList.toggle("invalid", els.loopStart.value.trim() !== "" && s == null);
      els.loopStop.classList.toggle("invalid", els.loopStop.value.trim() !== "" && e == null);
      if (els.loopStart.value.trim() !== "" && s == null) return;
      if (els.loopStop.value.trim() !== "" && e == null) return;
      TC.loop.start = s;
      TC.loop.stop = e;
      if (TC.loop.enabled) TC.loop.startRuntime();
      updateLoopHint();
      persistLoop();
    }
    els.loopStart.addEventListener("change", onTimeInput);
    els.loopStop.addEventListener("change", onTimeInput);
    els.loopStart.addEventListener("blur", onTimeInput);
    els.loopStop.addEventListener("blur", onTimeInput);

    function setNow(which) {
      var v = TC.state.video;
      if (!v) return;
      var t = Math.max(0, v.currentTime);
      TC.loop[which] = t;
      if (TC.loop.enabled) TC.loop.startRuntime();
      syncInputs();
      updateLoopHint();
      persistLoop();
    }
    els.startNow.addEventListener("click", function () {
      setNow("start");
    });
    els.stopNow.addEventListener("click", function () {
      setNow("stop");
    });
    els.jumpStart.addEventListener("click", function () {
      if (!TC.loop.jumpToStart()) toast("Set a start time first.");
    });

    els.maxLoops.addEventListener("change", function () {
      if (syncing) return;
      var v = parseInt(els.maxLoops.value, 10);
      TC.loop.maxLoops = isFinite(v) && v > 0 ? v : 0;
      TC.loop.loops = 0;
      if (TC.loop.enabled) TC.loop.startRuntime();
      persistLoop();
    });

    els.min.addEventListener("click", function () {
      uiSettings.collapsed = !uiSettings.collapsed;
      els.panel.classList.toggle("collapsed", uiSettings.collapsed);
      persistUI();
    });

    els.close.addEventListener("click", function () {
      TC.select.cancel();
      ui.closePanel();
    });

    els.clear.addEventListener("click", function () {
      // Cancel anything still queued, or it would re-save after the removal.
      cancelPersist(TC.state.cropKey);
      cancelPersist(TC.state.loopKey);
      if (TC.state.cropKey) TC.removeStored(TC.state.cropKey);
      if (TC.state.loopKey) TC.removeStored(TC.state.loopKey);
      TC.state.crop = TC.defaultCrop();
      TC.loop.reset();
      TC.clearCrop();
      syncInputs();
      els.scope.textContent = "Cleared for this page";
    });

    els.chatToggle.addEventListener("click", function () {
      TC.chat.toggle();
      updateChatUI();
    });

    drag(panelHost, els.head, function (pos) {
      uiSettings.panelPos = pos;
      persistUI();
    });
  }

  function updateChatUI() {
    if (!els.chatToggle) return;
    var unloaded = TC.chat.isUnloaded();
    els.chatToggle.textContent = unloaded ? "Load chat" : "Unload chat";
    if (!TC.chat.available()) {
      els.chatToggle.classList.add("disabled");
      els.chatHint.textContent = "No chat on this page.";
    } else {
      els.chatToggle.classList.remove("disabled");
      els.chatHint.textContent = unloaded
        ? "Chat is detached from the page."
        : "Removes the chat column from the page.";
    }
  }

  function updateLoopHint() {
    if (!els.loopHint) return;
    var canLoop = TC.canLoopHere();
    if (!canLoop) {
      els.loopHint.textContent = "";
      return;
    }
    if (!TC.loop.enabled) {
      els.loopHint.textContent = "Turn on to repeat the segment.";
      return;
    }
    var stop = TC.loop.stop != null ? TC.loop.stop : (TC.state.video && TC.state.video.duration);
    if (TC.loop.start == null) {
      els.loopHint.textContent = "Set a start time.";
      return;
    }
    if (stop == null || stop <= TC.loop.start) {
      els.loopHint.textContent = "Stop must be after start.";
      return;
    }
    els.loopHint.textContent =
      "Looping " + TC.formatTime(TC.loop.start) + " \u2192 " + TC.formatTime(stop) +
      (TC.loop.maxLoops > 0 ? " \u00b7 max " + TC.loop.maxLoops : "");
  }

  function buildFab() {
    var made = makeHost("twitch-cropper-fab");
    fabHost = made.host;
    var shadow = made.shadow;
    var style = document.createElement("style");
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);
    var wrap = document.createElement("div");
    wrap.innerHTML = FAB_HTML;
    while (wrap.firstChild) shadow.appendChild(wrap.firstChild);
    fabEls.fab = shadow.getElementById("fab");
    fabEls.fab.addEventListener("click", togglePanel);
    drag(fabHost, fabEls.fab);
    return shadow;
  }

  /* ------------------------------------------------------------- public API */

  var ui = (TC.ui = {});

  ui.init = function (stored) {
    if (ui.__initialized) return;
    ui.__initialized = true;
    if (stored && typeof stored === "object") {
      uiSettings.fabPos = stored.fabPos || null;
      uiSettings.panelPos = stored.panelPos || null;
      uiSettings.open = !!stored.open;
      uiSettings.collapsed = !!stored.collapsed;
    }
    buildFab();
    buildPanel();
    wirePanel(panelHost.shadowRoot);
    mountHost(fabHost);
    mountHost(panelHost);
    place(fabHost, uiSettings.fabPos, defaultFabPos());
    place(panelHost, uiSettings.panelPos, defaultPanelPos());
    els.panel.classList.toggle("collapsed", uiSettings.collapsed);
    panelHost.style.display = uiSettings.open ? "" : "none";
    fabEls.fab.classList.toggle("active", uiSettings.open);
    syncInputs();

    window.addEventListener("resize", function () {
      place(fabHost, { x: parseFloat(fabHost.style.left) || 0, y: parseFloat(fabHost.style.top) || 0 }, defaultFabPos());
      place(panelHost, { x: parseFloat(panelHost.style.left) || 0, y: parseFloat(panelHost.style.top) || 0 }, defaultPanelPos());
    });
    document.addEventListener("fullscreenchange", function () {
      mountHost(fabHost);
      mountHost(panelHost);
    });
  };

  ui.openPanel = function () {
    uiSettings.open = true;
    if (panelHost) panelHost.style.display = "";
    if (fabEls.fab) fabEls.fab.classList.add("active");
    syncInputs();
    persistUI();
  };

  ui.closePanel = function () {
    uiSettings.open = false;
    if (panelHost) panelHost.style.display = "none";
    if (fabEls.fab) fabEls.fab.classList.remove("active");
    persistUI();
  };

  function togglePanel() {
    if (uiSettings.open) ui.closePanel();
    else ui.openPanel();
  }
  ui.togglePanel = togglePanel;

  ui.syncInputs = syncInputs;

  ui.setScope = function (key, info) {
    if (!els.scope) return;
    if (!key) {
      els.scope.textContent = "Cropping not saved on this page";
      return;
    }
    if (key.indexOf("crop:c:") === 0) {
      els.scope.textContent = "Saved for channel " + key.slice(7);
    } else if (key.indexOf("crop:v:") === 0) {
      els.scope.textContent = "Saved for this VOD";
    } else if (key.indexOf("crop:k:") === 0) {
      els.scope.textContent = "Saved for this clip";
    } else {
      els.scope.textContent = "Saved";
    }
  };

  ui.persistCrop = persistCrop;
  ui.persistLoop = persistLoop;
  ui.toast = toast;
  ui.updateCropHint = updateCropHint;

  ui.onLoopStateChange = function (reason) {
    if (els.loopCount) els.loopCount.value = String(TC.loop.loops || 0);
    updateLoopHint();
    if (reason === "done") toast("Finished the last loop.");
  };

  /* -------------------------------------------------- drag-to-select overlay */

  function playerRoot(video) {
    return (
      video.closest('[data-a-target="video-player"]') ||
      video.closest('[data-a-target="video-ref"]') ||
      video.closest(".video-player") ||
      video.closest(".persistent-player") ||
      video.parentElement
    );
  }

  var OVERLAY_CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    // pointer-events is inherited: the host is set to `none` so the overlay
    // never blocks Twitch, so the surface must explicitly opt back in.
    ".surface{position:absolute;cursor:crosshair;pointer-events:auto;touch-action:none;overflow:hidden}",
    ".box{position:absolute;border:2px solid #9147ff;background:rgba(145,71,255,.18);pointer-events:none;",
    "box-shadow:0 0 0 100vmax rgba(0,0,0,.55)}",
    ".hint{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);background:rgba(24,24,27,.92);",
    "color:#efeff1;border:1px solid #3a3a3d;border-radius:8px;padding:7px 12px;font:13px -apple-system,'Segoe UI',Roboto,sans-serif;",
    "white-space:nowrap;pointer-events:none;max-width:92%;text-align:center}",
    ".size{position:absolute;right:6px;bottom:6px;background:rgba(24,24,27,.92);color:#efeff1;",
    "border-radius:6px;padding:3px 7px;font:12px ui-monospace,Menlo,Consolas,monospace;pointer-events:none}"
  ].join("");

  var sel = (TC.select = {
    active: false,
    host: null,
    surface: null,
    box: null,
    sizeTag: null,
    bounds: { left: 0, top: 0, width: 1, height: 1 },
    sx: 0,
    sy: 0,
    cx: 0,
    cy: 0,
    dragging: false,
    savedEnabled: false,
    rafId: 0
  });

  function overlayUpdateBounds() {
    if (!sel.active) return;
    var v = TC.state.video;
    if (!v || !v.isConnected) {
      sel.cancel();
      return;
    }
    if (!sel.host.isConnected) {
      (playerRoot(v) || document.body).appendChild(sel.host);
    }
    var hr = sel.host.getBoundingClientRect();
    var vr = TC.videoContentRect(v);
    sel.surface.style.left = vr.left - hr.left + "px";
    sel.surface.style.top = vr.top - hr.top + "px";
    sel.surface.style.width = vr.width + "px";
    sel.surface.style.height = vr.height + "px";
    sel.bounds = { left: vr.left, top: vr.top, width: vr.width, height: vr.height };
  }

  function overlayLoop() {
    if (!sel.active) return;
    overlayUpdateBounds();
    sel.rafId = requestAnimationFrame(overlayLoop);
  }

  function normalizedDrag() {
    return {
      x0: Math.min(sel.sx, sel.cx),
      x1: Math.max(sel.sx, sel.cx),
      y0: Math.min(sel.sy, sel.cy),
      y1: Math.max(sel.sy, sel.cy)
    };
  }

  function drawBox(W, H) {
    var d = normalizedDrag();
    sel.box.style.left = d.x0 + "px";
    sel.box.style.top = d.y0 + "px";
    sel.box.style.width = Math.max(0, d.x1 - d.x0) + "px";
    sel.box.style.height = Math.max(0, d.y1 - d.y0) + "px";
    var pct = W > 0 ? Math.round(100 * (d.x1 - d.x0) / W) : 0;
    var zoom = pct > 0 ? Math.round(100 / (pct / 100)) : 0;
    if (sel.sizeTag) sel.sizeTag.textContent = pct + "% wide \u00b7 \u2248" + zoom + "% zoom";
    return d;
  }

  function endOverlay() {
    sel.active = false;
    if (sel.rafId) cancelAnimationFrame(sel.rafId);
    sel.rafId = 0;
    sel.dragging = false;
    window.removeEventListener("keydown", overlayKey, true);
    if (sel.host && sel.host.parentNode) sel.host.parentNode.removeChild(sel.host);
    sel.host = null;
  }

  function overlayKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      sel.cancel();
    }
  }

  function finishSelection() {
    var W = sel.bounds.width;
    var H = sel.bounds.height;
    if (W <= 0 || H <= 0) {
      sel.cancel();
      return;
    }
    var d = normalizedDrag();
    var nw = (d.x1 - d.x0) / W;
    var nh = (d.y1 - d.y0) / H;
    if (nw < 0.02 || nh < 0.02) {
      ui.toast("Selection is too small \u2014 drag a bigger box.");
      sel.dragging = false;
      sel.box.style.width = "0px";
      sel.box.style.height = "0px";
      return;
    }
    var c = TC.state.crop;
    c.x = d.x0 / W;
    c.y = d.y0 / H;
    c.w = nw;
    c.h = nh;
    c.enabled = true;
    endOverlay();
    TC.applyCrop();
    syncInputs();
    persistCrop();
  }

  sel.begin = function () {
    if (sel.active) return;
    var v = TC.state.video;
    if (!v) {
      ui.toast("No video found on this page yet.");
      return;
    }
    var root = playerRoot(v);
    if (!root) {
      ui.toast("Could not find the player.");
      return;
    }

    sel.savedEnabled = TC.state.crop.enabled;
    TC.state.crop.enabled = false;
    TC.applyCrop();
    syncInputs();

    sel.host = document.createElement("div");
    sel.host.id = "twitch-cropper-select";
    sel.host.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;";

    var cs = getComputedStyle(root);
    if (cs.position === "static") {
      sel.host.style.position = "fixed";
      document.body.appendChild(sel.host);
    } else {
      root.appendChild(sel.host);
    }

    var shadow = sel.host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);

    var surface = document.createElement("div");
    surface.className = "surface";
    var box = document.createElement("div");
    box.className = "box";
    box.style.width = "0px";
    box.style.height = "0px";
    surface.appendChild(box);

    var hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Drag the area to keep \u00b7 Esc to cancel";
    var size = document.createElement("div");
    size.className = "size";
    size.textContent = "0%";

    shadow.appendChild(surface);
    shadow.appendChild(hint);
    shadow.appendChild(size);

    sel.surface = surface;
    sel.box = box;
    sel.sizeTag = size;
    sel.active = true;
    sel.dragging = false;
    overlayUpdateBounds();

    surface.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var r = surface.getBoundingClientRect();
      sel.dragging = true;
      sel.sx = TC.clamp(e.clientX - r.left, 0, r.width);
      sel.sy = TC.clamp(e.clientY - r.top, 0, r.height);
      sel.cx = sel.sx;
      sel.cy = sel.sy;
      try {
        surface.setPointerCapture(e.pointerId);
      } catch (err) {}
      drawBox(r.width, r.height);
    });

    surface.addEventListener("pointermove", function (e) {
      if (!sel.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      var r = surface.getBoundingClientRect();
      sel.cx = TC.clamp(e.clientX - r.left, 0, r.width);
      sel.cy = TC.clamp(e.clientY - r.top, 0, r.height);
      drawBox(r.width, r.height);
    });

    function up(e) {
      if (!sel.dragging) return;
      sel.dragging = false;
      e.preventDefault();
      e.stopPropagation();
      finishSelection();
    }
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", function (e) {
      sel.dragging = false;
    });
    surface.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      sel.cancel();
    });

    window.addEventListener("keydown", overlayKey, true);
    overlayLoop();
  };

  sel.cancel = function () {
    if (!sel.active) return;
    TC.state.crop.enabled = sel.savedEnabled;
    endOverlay();
    TC.applyCrop();
    syncInputs();
  };
})();
