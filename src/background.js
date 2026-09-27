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
  browser.tabs.sendMessage(tab.id, { type: "tc-toggle-panel" }).catch(() => {});
});

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-crop") sendToActiveTab("tc-toggle-crop");
  else if (command === "toggle-panel") sendToActiveTab("tc-toggle-panel");
});
