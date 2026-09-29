{
  // The toolbar button is disabled by default and enabled per tab by status.js, a content script
  // that only runs on ArcGIS REST pages (see content_scripts in manifest.json). Chrome clears
  // per-tab action state on navigation, so leaving a REST page disables the button again.
  const disableByDefault = () => chrome.action.disable();

  chrome.runtime.onInstalled.addListener(disableByDefault);
  chrome.runtime.onStartup.addListener(disableByDefault);

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message && message.type === "enableAction" && sender.tab) {
      chrome.action.enable(sender.tab.id);
    }
  });
}
