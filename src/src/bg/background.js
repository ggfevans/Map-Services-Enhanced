{
  // Matches the content script patterns in manifest.json: *://*/*/rest/services and *://*/*/rest/services/*
  // (http/https only, with at least one path segment before /rest/services).
  const REST_SERVICES_PAGE = {
    originAndPathMatches: "^https?://[^/]+/.+/rest/services(/.*)?$"
  };

  // The toolbar button is disabled everywhere except ArcGIS REST pages, where the rule below shows it.
  const disableByDefault = () => chrome.action.disable();

  // declarativeContent rules persist across restarts, so they only need registering on install/update.
  chrome.runtime.onInstalled.addListener(() => {
    disableByDefault();

    chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
      chrome.declarativeContent.onPageChanged.addRules([{
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({ pageUrl: REST_SERVICES_PAGE })
        ],
        actions: [new chrome.declarativeContent.ShowAction()]
      }]);
    });
  });

  // Re-apply the disabled default on browser start; it is cheap and idempotent.
  chrome.runtime.onStartup.addListener(disableByDefault);
}
