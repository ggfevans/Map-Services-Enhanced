# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3, Chromium browsers only) that adds diagnostic and query tools to the HTML pages served by ArcGIS Server REST endpoints (`.../rest/services/...`). It packages the bookmarklets from [ESRI REST Diagnostics](https://github.com/raykendo/ESRI_REST_Diagnostics) into one tool. The code is plain vanilla JS with no framework, no bundler, no runtime dependencies, and no test suite.

## Commands

Requires Node 20.19+. Run `npm install` first.

- `npm run lint`: ESLint 10 (flat config in `eslint.config.js`) over the repo. Formatting rules come from `@stylistic` (2-space indent, double quotes, semicolons).
- `npm run build`: lint, then zip `src/` into `build/map-services-enhanced-<version>.zip`. The build fails if the versions in `package.json` and `src/manifest.json` differ, so bump both together.
- To try the extension, open `chrome://extensions`, turn on Developer mode, and use "Load unpacked" on `src/`. Branded Chrome ignores `--load-extension`, so automated browser tests need Playwright's bundled Chromium.

There is no automated test suite yet.

## Layout

The extension root is `src/`, which holds `manifest.json`, `_locales`, and `icons`. The scripts sit one level deeper, in `src/src/`. Paths in the manifest and in `chrome.runtime.getURL(...)` resolve relative to `src/`. For example, `getURL("src/config/options.json")` loads **`src/src/config/options.json`**. The top-level `src/config/options.json` is a divergent copy that nothing references at runtime.

## Architecture

**Content scripts** (`src/src/inject/`) do nearly all the work. The manifest injects them by URL pattern:
- `inject.js`, `status.js`, `mapImages.js` (and `inject.css`) run on every `rest/services` page:
  - `inject.js` is the main tool. It fetches service JSON, collects metadata, feature counts, and field/domain counts, and color-codes spatial references.
  - `status.js` renders the in-page status/settings icon and an options form.
  - `mapImages.js` shows map image previews when you hover over links.
- `queryTest.js` runs on `.../query` pages and handles the query builder, SQL helpers, and the "Select All" behavior.
- `printTask.js` runs on `execute`/`submitjob` pages and pre-fills the default `Web_Map_as_JSON`.

Each script is wrapped in a bare `{ ... }` block and defines its own copies of helpers such as `ajax` and `loadElement`. This is deliberate: scripts in the same content-script group share one global scope, and the blocks keep their `const` declarations from colliding. There is no shared module. If you change a helper, the change applies only to that file's copy.

**Page action popup** (`src/src/page_action/`): `search.js` searches the REST endpoint tree of the active tab, and `url_shortener.js` strips unneeded query parameters. Both use `chrome.tabs` (the permissions are limited to `activeTab` and `storage`).

**Background** (`src/src/bg/background.js`) is a service worker with one job. On install/update it disables the toolbar action globally, then registers a `declarativeContent` rule that enables the action on URLs whose path matches `^https?://[^/]+/.+/rest/services(/.*)?$` (via `originAndPathMatches`; `UrlFilter` has no `pathMatches`). Keep that rule's regex in sync with the content-script `matches` in the manifest. `mapImages.js` and `queryTest.js` start from a `window` `load` listener (MV2 used a `sendMessage` handshake).

**Settings** live in `chrome.storage.sync`, and three places must stay in sync with each other:
1. `src/src/options/options.html` + `options.js`: the Chrome options page, with hard-coded fields and defaults
2. `src/src/config/options.json`: the declarative schema that `status.js` uses to render the in-page settings form
3. Each content script's `chrome.storage.sync.get({key: default}, ...)` call, which supplies its own defaults

The storage keys are `autoMetadata`, `autoFeatureCounts`, `autoFieldCounts`, `autoDomainCounts`, `defaultWebMapAsJSON`, `defaultWhereClause`, `queryHelperSelectAll`, `showMapImages`, `mapImageWidth`, and `mapImageHeight`. When you add or rename a setting, update all three places. The values already disagree in one spot: for "do nothing", `queryHelperSelectAll` is `donothing` in `options.html` but `nothing` in `src/src/config/options.json`.

Recent commits removed `innerHTML` usage in favor of DOM construction (`loadElement`, `createTextNode`). Keep to that pattern.
