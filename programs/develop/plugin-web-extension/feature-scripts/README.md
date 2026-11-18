# `feature-scripts`

`feature-scripts` is the scripts pipeline for `plugin-web-extension`.

It is responsible for:

- turning manifest script declarations into Rspack entries
- wrapping content scripts so they can mount into isolated roots
- keeping content-script runtime behavior separate from page/script entries
- enforcing the canonical content-script contract the rest of the pipeline reads (see below)

The dev reload and HMR strategy lives in `programs/develop/plugin-reload`, which
registers after this plugin and decorates the entries created here. Two pieces
of dev reload logic still sit in this folder until the maintainer rules on their
home: the reinject runtime the wrapper loader writes into each content script in
a dev session, and the restart state of `warn-main-world-registration-changed`,
which `plugin-browsers` and `dev-server` read through `isAwaitingMainWorldRestart`.

## Entry point

`index.ts` applies nothing when the manifest path is not a file. Otherwise it
applies these steps in this order. A step with no note runs in every mode and
for every browser. `__spec__/scripts-plugin-steps.spec.ts` pins which steps a
real compiler takes per mode and browser.

1. `AddScripts`: script entries from the manifest and `scripts/`
2. `CompileMainWorldScripts`: in development, MAIN world files compile apart
   from the HMR runtime. In production, a MAIN world copy gets its own layer
3. `KeepCompletionValue`: a `scripts/` file ends on its own value
4. `PlaceRuntimeScriptSheets`: a `scripts/` file carries the sheet of its CSS
   modules. Development also prunes stale sheets after each build
5. `RootInjectedSheetUrls`: injected sheets name their `url()` targets from the
   extension (not on WebKit)
6. `TakeExtensionBase`: defines the base attribute and scheme everywhere, and
   on Gecko opens each MAIN world file on the read of the base
7. `PairRuntimeMainWorldBridges`: pairs runtime MAIN world registrations with a
   bridge (Gecko only)
8. `RouteMainWorldCopies`: routes MAIN world calls to the copy build (only when
   a file runs in the MAIN world at runtime)
9. `TraceRuntimeLoadedFiles`
10. `KeepGetURLImportsNative`
11. `AddContentScriptWrapper`
12. `AddPublicPathRuntimeModule` (production only)
13. `AddBaseUriRuntimeModule`
14. `PruneMainWorldBridges` (production only)
15. `ValidateEmittedScriptSyntax`
16. `StampWebkitUtf8Bom` (WebKit only)
17. `WarnSplitInitialChunks`
18. `WarnPageContextWorker`
19. `WarnPageRelativeScriptPath` (Gecko only)
20. `WarnMovedPageRelativeUrls`
21. `WarnUnknownRegistrationWorld`
22. `WarnMainWorldRegistrationChanged` (development only)
23. `WarnMissingBuildConstants` (production, and a development build with no
    dev session)
24. `WarnUnshippedRuntimeAssets`

## Important files

- `contracts.ts`
  Defines the canonical content-script entry and asset names like `content_scripts/content-0.js`.

- `steps/add-scripts.ts`
  Reads manifest script fields, validates paths, creates Rspack entries, and synthesizes a sequential data-url entry when a single content-script group declares multiple files.

- `steps/add-content-script-wrapper/*`
  Adds the loader/wrapper layer for content scripts and emits MAIN-world bridge scripts when needed. The wrapper is load-bearing in every mode: it converts `export default fn` into the `__EXTENSIONJS_mount(...)` call that invokes the user's default export, without it, production tree-shakes the entire content-script body.

- `steps/trace-runtime-loaded-files.ts`
  Copies through runtime-loaded files the module graph cannot see (classic worker `importScripts(...)`, `executeScript`/`insertCSS` `files` payloads, `{file}` entries of `contentScripts.register` and `userScripts.register`). A data or media file that a script names as a plain string inside a folder also ships, at the path the page or worker asks for, and a copied stylesheet brings its `url()` targets.

- `steps/keep-geturl-imports-native.ts`
  Keeps `import(chrome.runtime.getURL(...))` a native `import()` in the emitted bundle.

- `steps/add-public-path-runtime-module.ts`
  Injects the production public-path runtime module for content bundles.

- `steps/validate-emitted-script-syntax.ts`
  Fails loudly on syntax errors swc tolerates but browsers silently refuse to inject.

- `steps/compile-main-world-scripts.ts`
  Compiles MAIN world groups in child compilations during development, so the HMR runtime never lands on the page.

- `steps/warn-*.ts`
  Build warnings for mistakes the build would otherwise pass in silence. Each file names the case it warns about.

- `scripts-lib/*`
  Shared helpers: script entry paths (`utils.ts`), MAIN world discovery from source (`runtime-main-world-scripts.ts`, `registration-worlds.ts`), the bridge pairing and copy routing wrappers, injected sheet URLs, build constants, the taken extension base and completion values.

## Canonical contract

The rest of the dev pipeline does not infer content entries from user folder names. It relies on the canonical contract exported by `contracts.ts`.

- Entry names: `content_scripts/content-${index}`
- JS assets: `content_scripts/content-${index}.js` (a dev session adds a hash segment before `.js`)
- CSS assets: `content_scripts/content-${index}.css` (same hash rule)
- Layer: `extensionjs-content-script`

That contract is consumed by:

- `feature-manifest` (manifest overrides, dev content script paths, dev injected hosts)
- `feature-html` (keeps the page HMR loader off content entries)
- `feature-web-resources` (web accessible resources)
- `plugin-reload` (classifier, dev content script registry, reload strategy)
- `plugin-css` and `plugin-js-frameworks` (the content script layer)

If this contract changes, update those consumers together.

## Multiple content files

When a single manifest content-script group declares multiple files, `AddScripts` emits a sequential data-url module that imports all resolved JS and CSS inputs in order.

That keeps the user-facing manifest contract intact while giving the bundler and reload layer one canonical content entry to track.

## MAIN world support

MAIN-world content scripts get wrapper-side bridge script generation in `add-content-script-wrapper`. Dev-mode bridge metadata for reinjection is built by `plugin-reload`'s `SetupReloadStrategy`.

The main bundle and bridge bundle are both registered under canonical content asset names so browser-side reinjection and source tracking stay deterministic.

A `scripts/` file the background or an extension page (options, popup) puts into the MAIN world at runtime, with `scripting.registerContentScripts` or `executeScript({files, world: 'MAIN'})`, has no manifest group to pair a bridge with. On Gecko targets `pair-runtime-main-world-bridges` emits the bridge as `scripts/extjs-main-world-bridge.js` and prepends a wrapper to the background bundle, and to the bundle of each page that registers or injects, that registers it beside each `world: 'MAIN'` registration, under the id `extjs-main-world-bridge:<id>`. The wrapper follows updates and unregistrations and hides the pairs from `getRegisteredContentScripts`. Chromium targets and projects with no such registration are left alone.

Each pair is registered right before its own file and at that file's `runAt`. A production bundle takes the base at boot and clears the attribute in a microtask, so every file of one registration reads it first, and a later `import()` uses the base taken at boot. A development bundle keeps the attribute, as a declared group does. A production file that resolves nothing against the base is left unpaired, and a build where no file does ships neither the wrapper nor the bridge. A callback passed to a wrapped method is answered from the browser's own callback, so `runtime.lastError` names a failure there.

The build finds these calls by reading source (`scripts-lib/runtime-main-world-scripts.ts`). It reads the background, the scripts of every extension page, and the local modules they import, up to eight imports deep, resolved through the build's own resolve block, so aliases, tsconfig paths and linked workspace packages are followed. The path may be a literal in the call, a `const` of the same file, or an exported `const` one import away.

It does not see a call inside an installed package under `node_modules`, a link that leads out of the workspace, a `let`, a name declared twice, a constant behind a second hop, or a path built at runtime. Such a file gets neither the MAIN world treatment nor the pair. A declared `content_scripts` group stays with the manifest lane.

### One file in both worlds

Chromium injects one file path once per frame, so a file registered in both worlds under one path runs in the isolated world alone. The two worlds also need two builds: the isolated one carries the extension APIs and the reload hooks, the MAIN one runs on the page itself. When the source names a `scripts/` file in the MAIN world and in the isolated world, the build keeps `scripts/<name>.js` as the isolated build and emits a second one, `scripts/<name>.extjs-main-world.js` (`mainWorldCopyEntryName` in `contracts.ts`). An author's own file of that name wins, and no copy is made.

A file a `registerContentScripts` or `updateContentScripts` call puts in the MAIN world alone gets the copy too, next to `scripts/<name>.js`, and both are MAIN world builds. The browser keeps the path a file was registered under, across sessions and updates, so a MAIN registration is always sent to the copy: that path stays a MAIN world build when the isolated world starts or stops running the file. A file the MAIN world runs by `executeScript` alone leaves no path behind and ships once.

`route-main-world-copies` prepends a wrapper to the background bundle, and to the bundle of each page that registers or injects. It sends a `world: 'MAIN'` use of the file through `registerContentScripts`, `updateContentScripts` and `executeScript` to the copy, and `getRegisteredContentScripts` answers with the name the author wrote. An update that names the files or the world alone waits on a read of the registry, so the wrapper first makes the same call with an id the browser refuses: a malformed argument throws where the author made the call, and nothing changes. On Gecko it sits inside the bridge pairing, so the pair is made for the copy.

The world is read by `scripts-lib/registration-worlds.ts`. It reads a literal, a `const`, a choice between the two literals, a spread over a literal or constant object, and a `.map(...)` over a literal or constant list where the element is the world or the file. A call with no `world` is an isolated one.

A world the reading cannot settle (a parameter, a function call, a spread of an unknown value) is unknown, and never the MAIN world alone. An unknown world keeps the isolated build under the author's path, and `warn-unknown-registration-world` names the call site once.

The steps take this list once, as the compiler is made. When a later edit changes it, `warn-main-world-registration-changed` restarts the dev session, and warns instead where no session can restart.

## Testing

Focused unit coverage for this feature lives in `__spec__/`.

High-signal specs include:

- `scripts-plugin-steps.spec.ts` (which steps a real compiler takes per mode and browser)
- `add-scripts.spec.ts`
- `content-script-wrapper.spec.ts`
- `contracts.spec.ts`
- `get-bridge-scripts.spec.ts`

`production-page-exposure.spec.ts` and `production-bundle-payload.spec.ts` run real builds and resolve the loaders from `programs/develop/dist`, so they need `pnpm compile` in `programs/develop` first.

Reload-strategy specs live in `plugin-reload/__spec__/`. Behavioral reload verification is covered by the scripts templates in the public [extension-js/templates](https://github.com/extension-js/templates) repo.

## Maintenance notes

- Keep path-sensitive helpers inside `steps/` or `scripts-lib/` so imports remain local and easy to refactor.
- Prefer documenting canonical entry behavior in `contracts.ts` and this README instead of scattering assumptions across comments.
- If files move again, update this README alongside import paths so the folder remains self-describing.
