# Changelog

## Unreleased

- Inline content-script CSS as data URLs to close the WAR gap on rspack 2.x (52a64932)
- Fire chrome.runtime.reload() once per save instead of N times racing on the eval response (93ff8482)
- Anchor relative profile paths to the rspack context so sequential examples do not share one profile (7d7c55ef)
- Bump browser-extension-manifest-fields (26b3bedc)
- Pick user extension over companion when version + manifest_version tie (a802a46c)
- Compile extension CLI on demand from companion Firefox MV3 spec (0e9940b1)
- Update README.md (0b549dcf)
- Prevent companion extension duplication (4adc882d)
- Dedupe extension load list and ignore companion shadows of built-in packages (98a08902)
- Skip dependency install in web-only mode to fix extension dev crash on Chrome samples (6bd005a3)
- Rework README with growth-oriented hero, comparison table, and ship-to-store guide (dbe60b0f)
- Lock in companion-extension Firefox bundle as MV3-API-free (4312e013)
- Force single Playwright worker to eliminate content-reload spec race (3713f71c)
- Stop installing unused firefox/chromium in cli CI suite to dodge snap hang (2336ac10)
- Hold firefox apt package so --with-deps does not trigger snap install (716a650f)
- Soften strict _locales layout policy from build error to warning (8cffc694)
- Mark generated templates/package.json as ESM to keep spec imports working (2236e5a3)
- Fix nightly CI template builds and the playwright-core resolution (b48c25f3)
- Teach perf-warning inventory to parse the new PerfBudgetWarning block (c08b92d2)
- Add per-category perf budgets tuned for browser-extension workloads (6d138195)
- Add script to inventory perf warnings across _FUTURE example builds (4be47fb1)
- Discriminate page vs content errors in devtools dialog by script origin (fd3fae7a)
- Stop devtools companion from toggling user extension via chrome.management (f8882c3f)
- Pick newest content-script bundle by mtime so reload reflects latest rebuild (070152ec)
- Resolve _locales at the project root and reject manifest-dir layout (ef5f885a)
- Fix manifest/SW/locale reload classifier and lock companion-targeting in tests (3d5e072a)
- Stop passing chromium-only flags to Firefox launch (884dad5d)
- Make Firefox welcome tab open reliably on first run (76a7a256)
- Gate chromium-only background listeners in extension-js-devtools (3c32d787)
- Stop manifest icons diff from firing spuriously on every rebuild (3c31901f)
- Fix bad output of the (re)compilation banner (ec28102e)
- Stop extension-develop resolver from escaping node_modules into outer monorepo (a1b35ec8)
- Normalize watch path separators in dev-server config spec for Windows CI (d983622c)
- Normalize watch path separators in dev-server config spec for Windows CI (4621cf80)
- Drop dist-build dependency from minimum-script-file/preact-refresh-shim specs (5b3ce992)
- Fix HTML live-reload regression on rspack 2.x and lock the contract in tests (55b66df2)
- Restore content-script wrapper in production to keep mount call alive (67333afc)
- Bump @rspack/core, plugin-preact-refresh, plugin-react-refresh patches (222bd4fa)
- Bump less/postcss/sass-loader patch versions for rspack 2.x peer range (a83dc17d)
- Bump @rslib/core to 0.21.x to unify on rspack 2.x (11bf7c68)
- Drop content-script reinject runtime in prod and add extension dev --no-reload (5ef7884a)
- Add --mode override to extension build (mirrors vite/webpack) (f19e18ce)
- Harden Firefox content-script reload across MV2/MV3 templates (6b02c645)
- Align Firefox dev banner with Chromium and fix update suffix loss (8e3798b1)
- Stop letting build errors crash the dev process (b79b4251)
- Make F2 actually catch external Firefox tab navigations (efa451d9)
- Wire F2/F3 into the Firefox launcher and cache the watcher target (5ccede9c)
- Make Firefox runtime reinjection actually take effect on real Firefox (7360a63f)
- Bring Firefox content-script reload to parity with Chromium via RDP (780e9a49)
- Slim the repo root by moving docs into docs/ and removing dead config (27b59ac5)
- Always overwrite scaffolded README so projects feel like the user's own (6448cf92)
- Prefer Linux-native browsers under WSL with GUI (47935de8)
- Focus on GitHub as funding source (08dbd9a8)

## 3.8.2

- Harden optional dependency runtime resolution to reduce first-run failures.

## 3.8.1

- No user-facing changes beyond release packaging updates.

## 3.8.0

- Add support for canary releases.
- Add an experimental `install` command.
- Improve Windows test and runtime reliability across Chromium, Edge, and Firefox flows.
- Improve path handling and source output behavior for more consistent CLI runtime output.
- Stabilize remote zip/template handling and companion loading defaults.
- Improve extension developer feedback by making Extension ID output more reliable and less noisy.

