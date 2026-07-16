// RH DataSheet Maker — service worker.
// Opens the builder page in a new tab when the content script finishes scraping.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "OPEN_BUILDER") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/builder/builder.html") });
    sendResponse({ ok: true });
  }
  return false;
});
