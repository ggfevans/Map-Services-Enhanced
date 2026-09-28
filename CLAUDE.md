# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V2) that adds diagnostic and query tools to the HTML pages served by ArcGIS Server REST endpoints (`.../rest/services/...`). It packages the bookmarklets from [ESRI REST Diagnostics](https://github.com/raykendo/ESRI_REST_Diagnostics) into one tool. The code is plain vanilla JS with no framework, no bundler, no runtime dependencies, and no test suite.

## Commands

Grunt drives the build (`npm install` first; run the tasks with `npx grunt <task>`):

- `grunt inspect`: ESLint only, over `src/**/*.js`
- `grunt forTesting`: lint, then sync `src/` into `dist/`. Load `dist/` (or `src/` directly) as an unpacked extension at `chrome://extensions`.
- `grunt` (default): lint, sync, uglify JS into `dist/src/`, then zip to `build/Release/MSE_<version>.zip`

Lint rules (`.eslintrc.json`): 2-space indent, double quotes, required semicolons, ES6. **`linebreak-style` is set to `windows` (CRLF)**, but the files in the repo use LF, so lint may fail on line endings unless git converts them on checkout. Don't reformat whole files just to satisfy that rule.

When you bump the version, update it in both `package.json` (which names the release zip) and `src/manifest.json`.

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

**Background** (`src/src/bg/background.js`) is an empty placeholder. `mapImages.js` and `queryTest.js` call `chrome.extension.sendMessage({}, cb)` purely as a "ready" handshake; no listener handles it.

**Settings** live in `chrome.storage.sync`, and three places must stay in sync with each other:
1. `src/src/options/options.html` + `options.js`: the Chrome options page, with hard-coded fields and defaults
2. `src/src/config/options.json`: the declarative schema that `status.js` uses to render the in-page settings form
3. Each content script's `chrome.storage.sync.get({key: default}, ...)` call, which supplies its own defaults

The storage keys are `autoMetadata`, `autoFeatureCounts`, `autoFieldCounts`, `autoDomainCounts`, `defaultWebMapAsJSON`, `defaultWhereClause`, `queryHelperSelectAll`, `showMapImages`, `mapImageWidth`, and `mapImageHeight`. When you add or rename a setting, update all three places. The values already disagree in one spot: for "do nothing", `queryHelperSelectAll` is `donothing` in `options.html` but `nothing` in `src/src/config/options.json`.

Recent commits removed `innerHTML` usage in favor of DOM construction (`loadElement`, `createTextNode`). Keep to that pattern.
