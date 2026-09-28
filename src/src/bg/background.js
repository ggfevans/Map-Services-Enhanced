{
  // Matches the content script patterns in manifest.json: */rest/services and */rest/services/*
  const REST_SERVICES_PATH = "/rest/services(/.*)?$";

  // The toolbar button is disabled everywhere except ArcGIS REST pages.
  // Rules registered with declarativeContent persist, so they only need setting on install/update.
  chrome.runtime.onInstalled.addListener(() => {
    chrome.action.disable();

    chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
      chrome.declarativeContent.onPageChanged.addRules([{
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: { pathMatches: REST_SERVICES_PATH }
          })
        ],
        actions: [new chrome.declarativeContent.ShowAction()]
      }]);
    });
  });
}
