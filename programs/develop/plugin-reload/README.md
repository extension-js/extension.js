# `plugin-reload`

`plugin-reload` owns the dev-only reload/HMR strategy for `extension dev`,
end to end. It was extracted from `plugin-web-extension/feature-scripts`
(build-time injection) and `plugin-browsers` (classification, dispatch, what
the browser last read, and the Safari trim and burst merge) so the reload
concern has a single owner.

It is responsible for:

- injecting the dev reload runtime into the built extension:
  background entry setup, the SW scripts-replay shim, and the control-bridge
  producer/relay (console forwarding for unified logging)
- asking the chunk loading target of `plugin-web-extension` for the
  message fallback a content script uses when it cannot import a chunk,
  and naming hot update files `hot/[id].[fullhash].js`
- on Chromium, turning the manifest's `content_scripts` entries into
  signalling stubs and registering the real bundles from the worker, so an
  edit reaches new and open pages without a second copy running
- adding the reinject runtime to every content script of a dev session
  build: a registry of generations, owner markers, root sweeps and the
  isolated world DOM instrumentation, so a new copy retires the one an
  earlier injection left in the page
- stripping the rspack-dev-server startup runtime from emitted content
  scripts so reinjection stays browser-owned
- classifying a watch-mode change into a reload instruction
  (`full` / `service-worker` / `content-scripts` / notify-only `page`)
- dispatching that instruction over the control-bridge broker, the same
  executor for launched browsers and `--no-browser`

## Entry point

`index.ts` exposes two seams:

- `ReloadPlugin`, the rspack plugin applied by `rspack-config.ts`. It must
  register AFTER `plugin-web-extension`: `SetupReloadStrategy` decorates the
  background/content entries that `feature-scripts`' `AddScripts` declares.
  The whole pipeline no-ops in production, for a build whose `devSession`
  is `false`, under `EXTENSION_NO_RELOAD=true` (`--no-reload`), and when
  the manifest path is not a file. The first three are `isReloadSession`
  in `lib/reload-session.ts`. Chunk loading is not part of this plugin:
  `plugin-web-extension` installs its chunk loading target in every build.
- the classifier/dispatch API (`reloadForBuild`, `loadedContentScriptsFor`,
  `classifyReloadFromSources`, `buildSourceFeatureIndex`,
  `createLoadedContentScripts`, `dispatchReload`,
  `createChangedSourcesTracker`, `readDevBuild`, …) consumed by
  `plugin-browsers`' `BrowsersPlugin` (launched-browser path) and
  `SafariDevPlugin` (which adds `reloadSurvivingPackage` and
  `mergeReloadInstructions`), and by `dev-server/index.ts` (`--no-browser`
  broadcast path). Centralizing the decision keeps the paths converged: the
  same change always resolves to the same reload type. The callers say when
  a build was loaded and when a reload may be sent. What must reload is
  answered here.

## Development pipeline

Applied by `ReloadPlugin` in order. The first runs ahead of the gate, under
the wrapper's own reading of a dev session (`devSession` when the config
names one, otherwise any mode but production), so it also runs under
`EXTENSION_NO_RELOAD=true`, as the wrapper did before the runtime moved here:

1. `AddContentScriptReinject`
2. `StripContentScriptDevServerRuntime`
3. `StableContentScriptNames`
4. `SetupReloadStrategy` (`SetupBackgroundEntry`, then the message
   fallback request, then the hot update file names)
5. `InjectScriptsReplayShim`
6. `SetupDevContentScripts` (Chromium only, not the emulator)
7. `InjectBridgeProducer` (not the emulator)
8. `InjectBridgeRelay` (not the emulator)
9. `PruneStaleHotUpdates`
10. `PruneUnreachableChunks`

## Important files

- `build-reload.ts`
  The one call each reload path makes after a build. `reloadForBuild` reads
  the tracker's snapshot, classifies it and, when given what the browser last
  read, resolves against it. `loadedContentScriptsFor` maps a browser name to
  that record: none for the emulator, an in-place sheet swap for Gecko.

- `classify-reload.ts`
  The pure reload classifier. Decision order per changed file: forced-full
  (manifest/_locales) → chunk-graph membership → emitted static asset →
  name heuristics. Also defines `ReloadType` / `ReloadInstruction`, the
  control-bridge `contracts.ts` mirrors `ReloadType`; update them together.

  The source index reads the `scripts/` and `content_scripts/` bundles of
  child compilations too (a dev MAIN world script compiles in one) and takes
  the request out of a typed module identifier, so an imported image or
  stylesheet belongs to the bundle that carries it.
  `reloadForRewrittenContentScripts` answers a stylesheet the loaded manifest
  names that keeps its name and changes its bytes. Gecko keeps a declared
  sheet by address, so inserting the file again shows the old rules. With
  `refreshInPlace` (Gecko) the instruction stays a content script one and
  carries `refreshedStylesheets`: in every frame that runs the entry the
  producer inserts the file under a `?v=<digest>` address and then removes
  the declared copy, registers that address at the entry's own `run_at` so
  a later document gets the new rules last in the cascade, and records the
  swap so a content script in a later document asks for the declared copy
  to be dropped there too. Each content script bundle names itself to its
  frame, so the frames are the ones the browser ran the entry in, whatever
  the tab shows. Nothing restarts and the tab keeps its state. Any other
  browser, an entry with no script, and a changed script still reload the
  extension. `createLoadedContentScripts` keeps what the browser last read
  for both the launched-browser plugin and `--no-browser`, so they resolve
  an edit alike: `noteLoaded` records a build the browser loaded, `resolve`
  compares a compile with it, and a swapped sheet counts as read only once
  `settle(true)` says a producer received it.
  `reloadForNewWebResources` reloads the extension when the emitted manifest
  lists a web accessible resource the loaded one did not, as an imported
  image does under its hashed name after an edit.
  An HTML page the build emits byte for byte carries no dev client. The
  instruction names it in `standalonePages` and the producer reloads the
  tabs that show it. A reload that restarts the extension records the
  extension's own page tabs first, and the next generation reloads the ones
  the browser kept and opens again the ones it closed.

- `reload-dispatch.ts`
  Routes a `ReloadInstruction` to the control-bridge broker (SW producer).
  Honors `EXTENSION_NO_RELOAD`. A broadcast that reaches no producer is
  latched, and where the launcher can start a suspended background (a
  Firefox event page after about 30 s idle) it is started so its hello takes
  the edit. The undelivered warning prints only when that brings nobody back.
  `dispatchReload` resolves `true` only when a producer took the edit. A
  reload that only restarts the worker is not sent when every connected
  background already names the build being shipped, which two quick saves
  that compile the same bytes would otherwise run twice.
  `fullReloadsDeliveredTo` counts the full reloads a producer took, and
  `dispatchRestartReload` is the one reload a restarted dev session owes: it
  sends nothing when the first build of the new compiler already reloaded
  the extension for its manifest, so one reload prints one line.

- `reload-after-package.ts`
  For a browser whose every build is packaged and restarts the extension
  (Safari). `reloadSurvivingPackage` keeps only what a restart cannot
  deliver: a content script or notify-only page instruction, and the content
  half of an edit shared with the background. `mergeReloadInstructions`
  folds the instructions of a save burst into the one its single package
  sends, unioning content entries and injected script files.

- `steps/setup-reload-strategy/`
  Dev-only background entry setup. `SetupBackgroundEntry` generates
  `background/service_worker` (Chromium MV3) or `background/script` (Gecko
  and MV2) for a manifest that declares no background the browser can run,
  and records it as `generated`. A live session needs the message fallback,
  which injects a chunk a content script could not import, so the step
  asks for it through `extendChunkLoadingTarget` in
  `plugin-web-extension/shared/chunk-loading-target-extensions.ts`. The
  fallback is answered from the authored background when the manifest names
  one, and from the generated one otherwise. The target itself, its loaders
  and its public path module stay in `plugin-web-extension`. The step also
  renames hot update files.

- `reload-lib/dev-content-scripts.ts` / `steps/setup-dev-content-scripts.ts`
  Chromium loads a static content script's bytes once, at extension load,
  so no edit can reach a page through the manifest entry. In development
  each entry's `js` becomes `content_scripts/dev-stub-<n>.js`, which only
  messages the worker; `content_scripts/dev-registry.json` carries the real
  files, and a runtime prepended to the background bundle registers them
  with `chrome.scripting` at boot (`persistAcrossSessions: false`), injects
  on a stub's signal (and inserts the entry's stylesheet into a frame that
  Chromium did not add it to, which it only does at document start for a
  registration that already exists: a one-rule `dev-sheet-<n>.css`
  registered beside the entry's sheets tells such a frame from one that has
  them), heals open tabs after a worker restart and reloads the
  tabs an edited entry matches. Every emitted bundle starts with a marker
  that records its file on the world it runs in, and every injection path
  probes that marker first, so a frame never runs two copies. Entries with
  `include_globs`/`exclude_globs` are stub-only (no dynamic form exists):
  the static stub decides where they run and the worker injects on its
  signal. A `run_at: document_start` entry in the isolated world stays
  static, exactly as production emits it: a stub's injection lands tens of
  milliseconds after document start and misses a message the page posts
  once at that moment, so the registry marks it `static`, an edit to it
  reloads the extension (then the tabs it matches), and the dev output says
  so in one line. Every boot records the static entries' hashed bundle
  names in `chrome.storage.local` and reloads the tabs of one whose name
  changed since the previous generation, so a module shared with the
  worker reaches its tabs after the worker reload too. Firefox, MV2 and a
  build without a worker keep static entries and the producer's
  manifest-based re-inject.

- `reload-lib/content-script-reinject.ts` / `steps/add-content-script-reinject.ts`
  The reinject runtime, as text for the named points of the content script
  wrapper in `plugin-web-extension/feature-scripts`. The step adds it to the
  wrapper through `extendContentScriptWrapper` from
  `plugin-web-extension/shared/content-script-wrapper-extensions.ts`. The
  runtime reads the owner key the wrapper writes for every bundle, and in a
  MAIN world bundle it leaves out the DOM instrumentation, which would land
  on the page itself.

- `steps/inject-bridge-producer.ts` / `steps/inject-bridge-relay.ts`
  Control-bridge instrumentation: forward background-SW and content-script
  console output to the dev-server control WS. Not reload in the strict
  sense, they ride the same bridge and the same dev-only gate. The producer
  step also names the build in the background bundle, a digest of every
  emitted file without the compilation hash, and `readDevBuild` hands the
  same value to the dispatch.

  A file the background registered with `scripting.registerContentScripts`
  is read by Gecko once per address and kept through an update and a tab
  reload. The producer gives each edited `scripts/` file a new address
  (`scripts/hook.js?extjs-dev=<token>`), moves the registrations that name
  it and reloads the tabs they match, so the extension keeps running. It
  reads the registrations with the browser's own call, so a file both
  worlds run keeps each registration on its own build. The
  tokens live in `storage.session`. The background's own register and update
  calls take the current address and its reads get the plain names back, so
  a background that registers again after it was suspended stays on the
  edited file. An edit that wakes a suspended background waits until its
  register calls have settled before it reads the registrations. Without
  session storage, or when the browser refuses the update, the extension
  restarts and the next generation reloads the tabs.

## Contracts

The canonical content-script entry/asset names come from
`plugin-web-extension/feature-scripts/contracts.ts`, and so do the names of
the stub, CSS marker and sheet probe files this plugin emits. This plugin
consumes that contract. It does not define it, and nothing in
`plugin-web-extension` imports from here.

## Testing

- `reload-plugin-gating.spec.ts`, `reload-plugin-emulator.spec.ts`, which
  steps a real compiler gets per mode, session, opt-out and engine
- `classify-reload.unit.spec.ts`, classifier decisions
- `build-reload.unit.spec.ts`, the per-build call and the browser mapping
- `reload-dispatch.unit.spec.ts`, dispatch seam and the changed-sources
  tracker
- `reload-stamp.unit.spec.ts`, the reload kind a dispatch stamps into
  `ready.json`, through the broker and the Playwright metadata writer
- `loaded-content-scripts.spec.ts`, `web-resources.unit.spec.ts`, what the
  browser last read
- `reload-after-package.unit.spec.ts`, the trim and the burst merge for a
  packaged browser
- `setup-reload-strategy.spec.ts`, `setup-background-entry.spec.ts`,
  background entries, the fallback background a session asks for and the
  hot update names. The chunk loading specs live in
  `plugin-web-extension/feature-chunk-loading`.
- `plugin-boundary.spec.ts`, that this folder installs no chunk loading code
  and reaches the target only through its extension point
- `dev-content-scripts.spec.ts`, the Chromium stub and registry runtime
- `content-script-reinject.spec.ts`, `reinject-during-pending-await.spec.ts`,
  the reinject runtime in the wrapper output, its generations across
  injections, a copy injected while an earlier one awaits, and when the
  plugin adds it
- `inject-bridge-steps.spec.ts`, `inject-bridge-boot-registrations.spec.ts`,
  the control-bridge producer and relay
- `inject-scripts-replay-shim.spec.ts`, `scripts-replay-shim.runtime.spec.ts`,
  `scripts-replay-shim-namespaces.spec.ts`, the worker replay shim
- `strip-content-script-dev-server-runtime.spec.ts`,
  `prune-stale-hot-updates.spec.ts`, `prune-unreachable-chunks.spec.ts`,
  emitted-asset steps
- `stable-content-script-names.spec.ts`,
  `source-index-nameless-chunks.spec.ts`, real rspack compiles. They read
  loaders from `programs/develop/dist`, so run the package `compile` first.

All files above sit in `__spec__/`.

How `BrowsersPlugin` and `SafariDevPlugin` call this API is covered from
`plugin-browsers/__spec__/` (`reload-eligibility.unit.spec.ts`,
`safari-dev-coalesce.unit.spec.ts`). Behavioral reload
verification is covered by the scripts templates in the public
[extension-js/templates](https://github.com/extension-js/templates) repo.
