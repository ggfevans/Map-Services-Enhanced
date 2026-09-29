// Smoke test: loads the unpacked extension into the locally installed Google Chrome and checks each
// feature against a live ArcGIS Server (Esri's public sample server by default).
//
//   npm run test:smoke
//   MSE_TEST_SERVER=https://host/arcgis/rest/services npm run test:smoke
//
// Branded Chrome ignores --load-extension, so the extension is loaded over CDP (Extensions.loadUnpacked),
// which needs --enable-unsafe-extension-debugging and Developer mode in the throwaway profile.
import { chromium } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const BASE = process.env.MSE_TEST_SERVER || "https://sampleserver6.arcgisonline.com/arcgis/rest/services";
const REST_PAGE = /^https?:\/\/[^/]+\/.+\/rest\/services(\/.*)?$/;

// Test-only copy with the "tabs" permission, so the harness can read tab URLs when checking the action state.
const EXT = mkdtempSync(join(tmpdir(), "mse-ext-"));
const PROFILE = mkdtempSync(join(tmpdir(), "mse-profile-"));
cpSync(SRC, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
manifest.permissions.push("tabs");
writeFileSync(join(EXT, "manifest.json"), JSON.stringify(manifest));

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  args: ["--enable-unsafe-extension-debugging"],
  // Playwright passes --disable-extensions by default, which would unload the extension.
  ignoreDefaultArgs: ["--disable-extensions"]
});

try {
  // 1. Load the extension.
  const extensionsPage = await ctx.newPage();
  await extensionsPage.goto("chrome://extensions");
  await extensionsPage.evaluate(() => new Promise((res) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, res)));
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { id: extId } = await cdp.send("Extensions.loadUnpacked", { path: EXT });
  await extensionsPage.waitForTimeout(1500);
  const extInfo = await extensionsPage.evaluate((id) => new Promise((res) => chrome.developerPrivate.getExtensionInfo(id, (e) => res(e && {
    state: e.state,
    manifestErrors: e.manifestErrors.map((m) => m.message)
  }))), extId);
  record("extension loaded and enabled", extInfo?.state === "ENABLED" && extInfo.manifestErrors.length === 0, JSON.stringify(extInfo));
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(extId))
    || await ctx.waitForEvent("serviceworker", { predicate: (w) => w.url().includes(extId), timeout: 15000 }).catch(() => null);
  record("service worker registered", Boolean(sw));

  const pageErrors = {};
  const open = async (label, url, settle = 6000) => {
    const page = await ctx.newPage();
    pageErrors[label] = [];
    page.on("pageerror", (e) => pageErrors[label].push(e.message));
    page.on("console", (m) => m.type() === "error" && pageErrors[label].push(m.text()));
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(settle);
    return page;
  };
  const count = (page, selector) => page.locator(selector).count();

  // 2. Options page. Saves a Web_Map_as_JSON default, which the print page check relies on.
  const optionsPage = await open("options page", `chrome-extension://${extId}/src/options/options.html`, 1500);
  record("options page: inputs rendered", (await count(optionsPage, "input")) > 5);
  await optionsPage.locator("#mapimagewidth").fill("321");
  await optionsPage.locator("#defaultwebmapasjson").fill("{\"operationalLayers\":[]}");
  await optionsPage.locator("#save").click();
  await optionsPage.waitForTimeout(500);
  const saved = await optionsPage.evaluate(() => new Promise((res) => chrome.storage.sync.get(["mapImageWidth", "defaultWebMapAsJSON"], res)));
  record("options page: save writes chrome.storage", saved.mapImageWidth === 321 && saved.defaultWebMapAsJSON.length > 0);

  // 3. Content scripts on each page type.
  const other = await open("non-REST page", "https://example.com/", 1500);
  const root = await open("services root", BASE);
  record("services root: status icon injected", (await count(root, ".status-icon")) > 0);
  const srLinks = await count(root, "a[href*='spatialreference.org']");
  record("services root: spatial reference links rendered", srLinks > 0, `${srLinks} links`);

  const mapServer = await open("MapServer", `${BASE}/USA/MapServer`, 10000);
  const blocks = await count(mapServer, ".datablock");
  record("MapServer: metadata blocks rendered", blocks > 0, `${blocks} blocks`);

  const layer = await open("layer", `${BASE}/USA/MapServer/0`, 10000);
  const fieldCounts = await layer.getByText("Features with values:").count();
  record("layer page: field value counts rendered", fieldCounts > 0, `${fieldCounts} fields`);

  const query = await open("query page", `${BASE}/USA/MapServer/0/query`, 8000);
  record("query page: side panel rendered", (await count(query, ".sidepanel")) > 0);
  const sqlButtons = await count(query, "button.sql");
  record("query page: SQL buttons rendered", sqlButtons > 0, `${sqlButtons} buttons`);

  const print = await open("print page", `${BASE}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`, 8000);
  const selects = await count(print, "select");
  record("print page: choice lists swapped in", selects > 0, `${selects} selects`);
  const webMapLength = await print.evaluate(() => document.querySelector("textarea")?.value.length ?? -1);
  record("print page: Web_Map_as_JSON pre-filled", webMapLength > 0);

  // 4. Toolbar action is enabled on REST pages only.
  const states = await optionsPage.evaluate(async () => {
    const tabs = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url));
    return Promise.all(tabs.map(async (t) => ({ url: t.url, enabled: await chrome.action.isEnabled(t.id) })));
  });
  record("action state read for every web tab", states.length >= 6, `${states.length} tabs`);
  for (const { url, enabled } of states) {
    const expected = REST_PAGE.test(url.split(/[?#]/)[0]);
    record(`action ${expected ? "enabled" : "disabled"}: ${url}`, enabled === expected);
  }

  // Same tab: REST page -> non-REST page -> Back (restored from the back/forward cache).
  const nav = await open("navigation tab", `${BASE}/USA/MapServer`, 2000);
  const markTab = () => nav.evaluate(() => { document.title = "__nav__"; });
  const navEnabled = () => optionsPage.evaluate(async () => {
    const [t] = (await chrome.tabs.query({})).filter((x) => x.title === "__nav__");
    return t ? chrome.action.isEnabled(t.id) : null;
  });
  await markTab();
  record("navigation: enabled on REST page", (await navEnabled()) === true);
  await nav.goto("https://example.com/", { waitUntil: "load" });
  await nav.waitForTimeout(1000);
  await markTab();
  record("navigation: disabled after leaving REST page", (await navEnabled()) === false);
  await nav.goBack({ waitUntil: "load" });
  await nav.waitForTimeout(1500);
  await markTab();
  record("navigation: enabled again after Back", (await navEnabled()) === true);

  // The popup really opens on a REST tab, and Chrome refuses it elsewhere.
  const openPopupOn = async (page) => {
    await page.bringToFront();
    await page.waitForTimeout(500);
    return optionsPage.evaluate(async () => {
      const [w] = await chrome.windows.getAll({ windowTypes: ["normal"] });
      await chrome.windows.update(w.id, { focused: true });
      await new Promise((res) => setTimeout(res, 300));
      try {
        await chrome.action.openPopup({ windowId: w.id });
        return "opened";
      } catch (e) {
        return e.message;
      }
    });
  };
  // Window focus can lag behind bringToFront (and after a popup closes), so retry "inactive window" results.
  const tryPopup = async (page) => {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await openPopupOn(page);
      if (!/inactive window/.test(result)) break;
      await page.waitForTimeout(1000);
    }
    return result;
  };
  const restPopup = await tryPopup(root);
  record("popup opens on REST tab", restPopup === "opened", restPopup);
  // Close the open popup; it holds window focus, which would block the next openPopup call.
  const { targetInfos } = await cdp.send("Target.getTargets");
  for (const t of targetInfos.filter((x) => x.url.includes("page_action.html"))) {
    await cdp.send("Target.closeTarget", { targetId: t.targetId });
  }
  await root.waitForTimeout(500);
  const otherPopup = await tryPopup(other);
  record("popup refused on non-REST tab", /does not have a popup/.test(otherPopup), otherPopup);

  // 5. Popup page.
  const popup = await open("popup", `chrome-extension://${extId}/src/page_action/page_action.html`, 1500);
  record("popup: renders", (await count(popup, "input, button")) > 0);

  // 6. No errors.
  for (const [label, errors] of Object.entries(pageErrors)) {
    const relevant = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    record(`no JS errors: ${label}`, relevant.length === 0, relevant.slice(0, 3).join(" | "));
  }
  const runtimeErrors = await extensionsPage.evaluate((id) => new Promise((res) => chrome.developerPrivate.getExtensionInfo(id, (e) =>
    res(e ? e.runtimeErrors.map((x) => `${x.source}: ${x.message}`) : ["extension missing"]))), extId);
  record("no extension runtime errors", runtimeErrors.length === 0, runtimeErrors.slice(0, 5).join(" | "));
} catch (err) {
  record("test harness", false, err.stack);
} finally {
  await ctx.close();
  rmSync(EXT, { recursive: true, force: true });
  rmSync(PROFILE, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
