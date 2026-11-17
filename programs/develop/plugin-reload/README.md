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
- applying the chunk loading target of `plugin-web-extension` in a dev
  session, with the message fallback a content script uses when it cannot
  import a chunk, and naming hot update files `hot/[id].[fullhash].js`
- on Chromium, turning the manifest's `content_scripts` entries into
  signalling stubs and registering the real bundles from the worker, so an
  edit reaches new and open pages without a second copy running
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
  in `lib/reload-session.ts`, which `plugin-web-extension` reads too, so a
  build this plugin skips still gets the chunk loading target, once.
- the classifier/dispatch API (`classifyReloadFromSources`,
  `buildSourceFeatureIndex`, `createLoadedContentScripts`, `dispatchReload`,
  `createChangedSourcesTracker`, `readDevBuild`, …) consumed by
  `plugin-browsers`' `BrowsersPlugin` (launched-browser path) and
  `SafariDevPlugin` (which adds `reloadSurvivingPackage` and
  `mergeReloadInstructions`), and by `dev-server/index.ts` (`--no-browser`
  broadcast path). Centralizing the decision keeps the paths converged: the
  same change always resolves to the same reload type. The callers say when
  a build was loaded and when a reload may be sent. What must reload is
  answered here.

## Development pipeline

Applied by `ReloadPlugin` in order:

1. `StripContentScriptDevServerRuntime`
2. `StableContentScriptNames`
3. `SetupReloadStrategy` (`SetupBackgroundEntry`, then the chunk loading
   target, then the hot update file names)
4. `InjectScriptsReplayShim`
5. `SetupDevContentScripts` (Chromium only, not the emulator)
6. `InjectBridgeProducer` (not the emulator)
7. `InjectBridgeRelay` (not the emulator)
8. `PruneStaleHotUpdates`
9. `PruneUnreachableChunks`

## Important files

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
  and records it as `generated`. The message fallback is answered from the
  authored background when `getBackgroundEntryName` names one, and from the
  generated one otherwise. It then applies `ChunkLoadingTarget` from
  `plugin-web-extension/feature-chunk-loading`, which owns chunk loading in
  every mode, and renames hot update files. Every build that is not a
  reload session gets the same target from that feature's
  `SetupChunkLoadingTarget`, not from here.

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
- `reload-dispatch.unit.spec.ts`, dispatch seam and the changed-sources
  tracker
- `reload-stamp.unit.spec.ts`, the reload kind a dispatch stamps into
  `ready.json`, through the broker and the Playwright metadata writer
- `loaded-content-scripts.spec.ts`, `web-resources.unit.spec.ts`, what the
  browser last read
- `reload-after-package.unit.spec.ts`, the trim and the burst merge for a
  packaged browser
- `setup-reload-strategy.spec.ts`, `setup-background-entry.spec.ts`,
  background entries and the chunk loading target in a dev session. The
  target's own specs live in `plugin-web-extension/feature-chunk-loading`.
- `chunk-loading-runtime.spec.ts`, which code sets the public path, the base
  URI and the chunk loader in each world, read off builds made with the whole
  plugin list. It reads loaders from `programs/develop/dist` too.
- `dev-content-scripts.spec.ts`, the Chromium stub and registry runtime
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
