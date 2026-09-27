/*
 * Twitch Cropper - background event page.
 *
 * The toolbar button and the keyboard shortcuts just forward a message to the
 * content script in the active Twitch tab. Nothing else runs in the background.
 */

const TWITCH_URL = /^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//i;

function isTwitchTab(tab) {
  return !!(tab && tab.id != null && tab.url && TWITCH_URL.test(tab.url));
}

async function sendToActiveTab(type) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!isTwitchTab(tab)) return;
    await browser.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    // The content script may not be injected yet (e.g. the page is still
    // loading) or the tab may have navigated away. Nothing to do.
  }
}

browser.action.onClicked.addListener((tab) => {
  if (!isTwitchTab(tab)) return;
  browser.tabs.sendMessage(tab.id, { type: "tc-toggle-active" }).catch(() => {});
});

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-crop") sendToActiveTab("tc-toggle-active");
  else if (command === "toggle-panel") sendToActiveTab("tc-toggle-panel");
});

/*
 * Popout window handling.
 *
 * Only an extension can create a window with no address bar, so the content
 * script asks us to do it. "tc-popout" moves the asking tab into a chrome-less
 * popup window (nothing is left behind); "tc-resize" matches the window to the
 * crop once the page can measure its own chrome; "tc-return" puts the tab back
 * into a normal window and restores the regular Twitch page.
 */
browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type || !sender || !sender.tab || sender.tab.id == null) return;
  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;

  if (msg.type === "tc-popout") {
    const width = Math.max(200, Math.round(msg.width) || 640);
    const height = Math.max(160, Math.round(msg.height) || 360);
    browser.windows
      .create({ tabId: tabId, type: "popup", width: width, height: height })
      .then(() => browser.tabs.update(tabId, { url: msg.url }))
      .catch(() => {
        // Fallback: if a window cannot adopt the tab, make one and drop the old tab.
        browser.windows
          .create({ url: msg.url, type: "popup", width: width, height: height })
          .then(() => browser.tabs.remove(tabId))
          .catch(() => {});
      });
    return;
  }

  if (msg.type === "tc-resize") {
    if (windowId == null) return;
    browser.windows
      .update(windowId, {
        width: Math.max(120, Math.round(msg.width) || 400),
        height: Math.max(90, Math.round(msg.height) || 300)
      })
      .catch(() => {});
    return;
  }

  if (msg.type === "tc-return") {
    const url = msg.url || "https://www.twitch.tv/";
    browser.windows
      .getAll({ windowTypes: ["normal"] })
      .then((wins) => {
        const target = (wins || []).find((w) => w.id !== windowId);
        if (target) return browser.tabs.move(tabId, { windowId: target.id, index: -1 });
      })
      .then(() => browser.tabs.update(tabId, { url: url }))
      .then(() => {
        if (windowId == null) return;
        return browser.tabs.query({ windowId: windowId }).then((tabs) => {
          if (!tabs || tabs.length === 0) return browser.windows.remove(windowId);
        });
      })
      .catch(() => {});
    return;
  }
});
