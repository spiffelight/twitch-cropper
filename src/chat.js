/*
 * Twitch Cropper - chat unloading.
 *
 * Twitch's own "hide chat" button only hides the column: the chat stays mounted
 * in the DOM and keeps working. This module instead detaches the whole chat
 * column from the document, which removes it (and all its nodes) from the page
 * and stops it being laid out and painted. "Load chat" puts it back.
 *
 * It cannot close Twitch's chat connection — only Twitch can unmount its own
 * component — so this is a rendering/CPU saving rather than a true teardown.
 */

(function () {
  "use strict";

  var TC = window.__TC;
  if (!TC || TC.__chatReady) return;
  TC.__chatReady = true;

  var KEY = "tc.chat";

  // Ordered from outermost to innermost; the first that matches is detached.
  var CANDIDATES = [
    ".stream-chat",
    '[data-test-selector="chat-room-component-layout"]',
    '[data-a-target^="chat-theme"]',
    '[data-a-target="chat-scroller"]'
  ];

  var saved = null; // { node, parent, next }
  var pref = false; // the user wants chat unloaded
  var lastAttempt = 0;

  function findChat() {
    for (var i = 0; i < CANDIDATES.length; i++) {
      var el = document.querySelector(CANDIDATES[i]);
      if (el && el.isConnected) return el;
    }
    return null;
  }

  function detach(node) {
    if (!node || !node.parentNode) return false;
    saved = { node: node, parent: node.parentNode, next: node.nextSibling };
    node.parentNode.removeChild(node);
    return true;
  }

  TC.chat = {
    isUnloaded: function () {
      return pref;
    },

    // True when there is a chat on this page to unload, or one we can put back.
    available: function () {
      return !!findChat() || !!(saved && saved.node && !saved.node.isConnected);
    },

    unload: function () {
      var node = findChat();
      if (!node) return false;
      detach(node);
      pref = true;
      lastAttempt = Date.now();
      TC.setStored(KEY, { unloaded: true });
      TC.log("chat unloaded");
      return true;
    },

    load: function () {
      if (saved && saved.node && !saved.node.isConnected && saved.parent && saved.parent.isConnected) {
        saved.parent.insertBefore(saved.node, saved.next);
      }
      saved = null;
      pref = false;
      TC.setStored(KEY, { unloaded: false });

      // Nudge Twitch to lay the column out and scroll to the newest message.
      try {
        window.dispatchEvent(new Event("resize"));
      } catch (e) {}
      try {
        var scroller = document.querySelector('[data-a-target="chat-scroller"]');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      } catch (e) {}
      TC.log("chat loaded");
      return true;
    },

    toggle: function () {
      return pref ? TC.chat.load() : TC.chat.unload();
    },

    /*
     * Re-apply the preference. Twitch is a single-page app and re-creates the
     * chat column on navigation, so this re-detaches it while the preference is
     * on. Throttled so we never fight Twitch in a tight loop if it decides to
     * re-render the column underneath us.
     */
    // Put the chat back without changing the saved preference. Used when the
    // whole extension is switched off, so Twitch looks normal again.
    suspend: function () {
      if (saved && saved.node && !saved.node.isConnected && saved.parent && saved.parent.isConnected) {
        saved.parent.insertBefore(saved.node, saved.next);
      }
      saved = null;
      lastAttempt = 0;
    },

    reconcile: function () {
      if (!pref) return;
      if (TC.isActive && !TC.isActive()) return;
      var node = findChat();
      if (!node) return;
      if (saved && saved.node === node) return;
      if (Date.now() - lastAttempt < 2000) return;
      lastAttempt = Date.now();
      detach(node);
      TC.log("chat re-unloaded after re-render");
    },

    init: function () {
      return TC.getStored(KEY, null).then(function (value) {
        pref = !!(value && value.unloaded);
        return pref;
      });
    }
  };
})();
