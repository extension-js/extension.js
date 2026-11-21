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
  message fallback a content script uses when it cannot import a chunk
- naming the hot update files of a dev server compile, in
  `steps/name-hot-update-files.ts` and nowhere else: `hot/[id].[fullhash].js`
  in a reload session, and the same with the `.hot-update` suffix when
  reload is off
- on Chromium, turning the manifest's `content_scripts` entries into
  signalling stubs and registering the real bundles from the worker, so an
  edit reaches new and open pages without a second copy running
- adding the reinject runtime to every content script of a dev session
  build: a registry of generations, owner markers, root sweeps and the
  isolated world DOM instrumentation, so a new copy retires the one an
  earlier injection left in the page
- stripping the rspack-dev-server startup runtime from emitted content
  scripts so reinjection stays browser-owned
- giving every page of a dev session its hot update client (the dev
  server client and a minimum script, so a page with no script still
  updates), and letting the scripts a page names accept
  their own update in a dev session
- classifying a watch-mode change into a reload instruction
  (`full` / `service-worker` / `content-scripts` / notify-only `page`)
- dispatching that instruction over the control-bridge broker, the same
  executor for launched browsers and `--no-browser`
- the reload executor the background runs when a reload frame arrives
  (`reload-lib/producer-reload.ts`), which the control-bridge producer only
  carries

## Entry point

`index.ts` exposes three seams:

- `PageReloadPlugin` (`steps/setup-page-reload.ts`), applied by
  `rspack-config.ts` BEFORE `plugin-web-extension`. It registers with
  `plugin-web-extension/shared/html-page-extensions.ts` and is told the
  pages as `feature-html` declares them, so what it adds sits where the
  pages plugin sits in the plugin order. It wraps each page entry for any
  build in `development` mode, and adds the page HMR rule when the config
  names a dev session (otherwise for any mode but production). It reads
  neither `EXTENSION_NO_RELOAD` nor the manifest file check below.

- `ReloadPlugin`, the rspack plugin applied by `rspack-config.ts`. It must
  register AFTER `plugin-web-extension`: `SetupReloadStrategy` decorates the
  background/content entries that `feature-scripts`' `AddScripts` declares.
  The whole pipeline no-ops in production, for a build whose `devSession`
  is `false`, under `EXTENSION_NO_RELOAD=true` (`--no-reload`), and when
  the manifest path is not a file. The first three are `isReloadSession`
  in `reload-session.ts`. Chunk loading is not part of this plugin:
  `plugin-web-extension` installs its chunk loading target in every build.
- the reload session (`reload-session.ts`). `createReloadSession` is what
  `plugin-browsers`' `BrowsersPlugin` and `SafariDevPlugin` (with
  `packaged: true`) keep, and `reloadEachBuild` is the one call the dev
  server's `--no-browser` path makes. The dev server hands the session its
  broker and the hold of a pending restart. Callers say when a build was
  loaded and when a reload may be sent. What must reload, the trim and merge
  a packaged browser needs, and the dispatch are answered here, so the same
  change always resolves to the same reload on every path.

## Development pipeline

Applied by `ReloadPlugin` in order. The first runs ahead of the gate, under
the wrapper's own reading of a dev session (`devSession` when the config
names one, otherwise any mode but production), so it also runs under
`EXTENSION_NO_RELOAD=true`, as the wrapper did before the runtime moved here:

1. `AddContentScriptReinject`
2. `StripContentScriptDevServerRuntime`
3. `StableContentScriptNames`
4. `SetupReloadStrategy` (`SetupBackgroundEntry`, then the message
   fallback request)
5. `InjectScriptsReplayShim`
6. `SetupDevContentScripts` (Chromium only, not the emulator)
7. `InjectBridgeProducer` (not the emulator)
8. `InjectBridgeRelay` (not the emulator)
9. `PruneStaleHotUpdates`
10. `PruneUnreachableChunks`

`NameHotUpdateFiles` runs ahead of the gate as well, in every compile of a
dev server, reload on or off.

## Important files

- `steps/setup-page-reload.ts`
  The page side. In a dev session a page entry imports, in order, the
  dev server client and hot
  runtime (when a session names a host and port), the page's own files and
  `reload-lib/minimum-files/minimum-script-file.ts`, which also reloads an
  open page whose served markup changed. With a client it points the dev
  server's stock socket file at `reload-lib/page-socket-client.ts`, which names the page
  to the server. It also adds one rule, the
  `steps/ensure-hmr-for-scripts.ts` loader, for the script files the pages
  name: not a module they import, not a content script, and not at all
  when React, Vue or Svelte owns refresh.

- `reload-session.ts`
  One session per caller. `watch(compiler)` taps the changed sources of a
  compiler and `plan` answers what its build reloads, or that a pending
  restart holds it. `loaded` records a build the browser read, `deliver`
  sends a plan and records what the browser took. With `packaged` it trims
  each plan to what a restart cannot deliver and stamps every package as
  the applied reload. What the browser read outlives a compiler restart.
  A delivery that is still out holds the next build of every watched
  compiler, so the browser never reads a dist that is being written.

- `build-reload.ts`
  The classification a session runs after a build. `reloadForBuild` reads
  the tracker's snapshot, classifies it and, when given what the browser last
  read, resolves against it. `loadedContentScriptsFor` maps a browser name to
  that record: none for the emulator, an in-place sheet swap for Gecko.

- `html-refresh.ts`
  Which open pages load again after a markup save. The dev server attaches
  it to its socket server through `attachHtmlRefresh`, and the page names
  itself with the socket client in `reload-lib/page-socket-client.ts`.

- `classify-reload.ts`
  The pure reload classifier. Decision order per changed file: forced-full
  (the project manifest ReloadPlugin was given and the `_locales` folder
  beside it, never a file that only carries the name) → chunk-graph
  membership → emitted static asset → name heuristics. Also defines `ReloadType` / `ReloadInstruction`, the
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

- `build-reads.ts`
  Which saved files count. The tracker in `reload-dispatch.ts` keeps a
  changed file only when the build read it: a file dependency of this
  compile or the one before it (modules, a loader's `addDependency` input,
  the icons, pages and web resources the manifest names, the config and env
  files), a path the compile looked for and did not find, anything under
  `public/`, and the manifest and `_locales`. A note nothing reads still
  rebuilds when its folder is watched, and reloads nothing. The watcher names
  only the folder when a file appears in or leaves one a glob reads
  (a `require.context` folder, `public/`), so
  the tracker names the files the build started or stopped reading there,
  and an added or deleted file reloads like an edited one. A compile that
  does not list its dependencies keeps every reported file.

  The decision sits after the compile, not in the watcher: only the compile
  knows whether a glob or a loader picked a new file up, and an unread file
  changes nothing rspack emits, so its rebuild is cheap.

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

- `steps/apply-dev-defaults.ts` / `reload-lib/dev-manifest/`
  The manifest of a dev session. `ApplyDevDefaults` runs ahead of the gate
  in every dev session, reload on or off, at `REPORT + 100`
  (`DEV_MANIFEST_STAGE_AFTER_REPORT`), last at that stage, so every later
  step reads the grants. It adds what the session needs (permissions,
  content script hosts, a pages policy that reaches the dev server, a
  background, the hot update and control resources), reports each as a dev
  addition, and warns where the project's own source leans on a grant only
  the session made. What a manifest declares and what a source uses is the
  manifest feature's knowledge, read through
  `plugin-web-extension/shared/manifest-grants.ts`.
  `reload-lib/dev-manifest/content-script-paths.ts` names the hashed content
  scripts of a development compile in the manifest. The manifest feature
  asks for it through `plugin-web-extension/shared/manifest-extensions.ts`,
  in every development compile, session or not.

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
  and its public path module stay in `plugin-web-extension`.

- `reload-lib/dev-content-scripts.ts` / `steps/setup-dev-content-scripts.ts`
  Chromium loads a static content script's bytes once, at extension load,
  so no edit can reach a page through the manifest entry. In development
  each entry's `js` becomes `content_scripts/dev-stub-<n>.js`, which only
  messages the worker (the step reports it as a `manifest_change` in the
  session card and in `devAdditions` of `ready.json`);
  `content_scripts/dev-registry.json` carries the real
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
  on the page itself. It asks the wrapper for the list of roots older than
  the mount and for the public path in every bundle, puts its owner checks
  in place of the wrapper's own host checks, and prints the two hints about
  a declared entry with no default export and a default export the script
  also calls, from what the wrapper read of each module.

- `reload-lib/producer-reload.ts`
  The reload executor of the background: re-inject, script addresses, sheet
  swaps, page and override tabs, the restart and the boot heal. It is text
  the control-bridge producer composes between its own parts, so the bridge
  in `dev-server/control-bridge/producer-runtime.ts` keeps the connection,
  the control verbs and the logs only. `buildDevProducerSource` is the
  producer a dev background runs.

- `steps/keep-open-tab-stylesheets.ts`
  A tab opened before a rebuild still names the stylesheet of the build it
  loaded, and a development output is never cleaned. This step reads the
  sheets left under `content_scripts/` and hands them to
  plugin-web-extension through `shared/kept-resource-extensions`, which
  keeps them web accessible. Applied in every development build.
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
- `page-reload-entries.spec.ts`, whole builds of one project in production,
  in a development build and in a dev session: the emitted files, each
  page's markup, what each page entry imports, the page loader and the
  socket alias. It reads loaders from `programs/develop/dist`.
- `setup-page-reload.unit.spec.ts`, `page-hmr-entry-only.spec.ts`,
  `ensure-hmr-for-scripts.unit.spec.ts`, `minimum-script-file.unit.spec.ts`,
  the page side piece by piece
- `classify-reload.unit.spec.ts`, classifier decisions
- `reload-session.unit.spec.ts`, the session every caller keeps and the
  one call of the `--no-browser` path
- `reload-session-gate.unit.spec.ts`, which builds carry the pipeline
- `build-reload.unit.spec.ts`, the per-build call and the browser mapping
- `reload-dispatch.unit.spec.ts`, dispatch seam and the changed-sources
  tracker
- `files-the-build-never-read.spec.ts`, a real watch session: a note
  nothing reads reloads nothing, and a glob add or delete, a loader input,
  an icon, a web resource, `public/` and the manifest still reload
- `reload-stamp.unit.spec.ts`, the reload kind a dispatch stamps into
  `ready.json`, through the broker and the ready contract writer
- `loaded-content-scripts.spec.ts`, `web-resources.unit.spec.ts`, what the
  browser last read
- `reload-after-package.unit.spec.ts`, the trim and the burst merge for a
  packaged browser
- `renamed-content-scripts.unit.spec.ts`,
  `rewritten-content-script-styles.unit.spec.ts`,
  `classifier-inputs.unit.spec.ts`, the reload a session plans for a
  renamed bundle, a rewritten stylesheet or a copied page, driven through
  `helpers/launched-session.ts`, which makes the calls a browser plugin
  makes on a session with no browser under it
- `restart-reload-once.unit.spec.ts`, the one reload a restarted session owes
- `reload-frame-build.unit.spec.ts`, the build name a reload frame carries
- `setup-reload-strategy.spec.ts`, `setup-background-entry.spec.ts`,
  background entries and the fallback background a session asks for. The
  hot update names are in `reload-plugin-gating.spec.ts`. The chunk
  loading specs live in
  `plugin-web-extension/feature-chunk-loading`.
- `plugin-boundary.spec.ts`, that this folder installs no chunk loading code
  and reaches the target only through its extension point, what it may
  import from the dev server and the browser plugins, that it reaches the
  pages only through their extension point, and that no spec here imports
  a browser plugin
- `dev-content-scripts.spec.ts`, the Chromium stub and registry runtime
- `content-script-reinject.spec.ts`, `reinject-during-pending-await.spec.ts`,
  the reinject runtime in the wrapper output, its generations across
  injections, a copy injected while an earlier one awaits, when the
  plugin adds it, the two default export hints, and the runtime in a real
  dev session build. That build reads loaders from `programs/develop/dist`.
- `inject-bridge-steps.spec.ts`, `inject-bridge-boot-registrations.spec.ts`,
  the control-bridge producer and relay
- `producer-reload-*.spec.ts`, the reload executor in a background with a
  fake socket and extension API: boot registrations, declared sheets, page
  tabs, registered scripts and script addresses
- `inject-scripts-replay-shim.spec.ts`, `scripts-replay-shim.runtime.spec.ts`,
  `scripts-replay-shim-namespaces.spec.ts`, the worker replay shim
- `keep-open-tab-stylesheets.spec.ts`, the leftover sheets read from real
  folders and what the manifest step is handed
- `producer-reload-reinject-failure.spec.ts`, the full reload a reinject
  falls back to when the manifest cannot be read
- `strip-content-script-dev-server-runtime.spec.ts`,
  `prune-stale-hot-updates.spec.ts`, `prune-unreachable-chunks.spec.ts`,
  emitted-asset steps
- `reload-steps-stage.spec.ts`, that the reload runtime and the bridge are
  written to the background after every step at the shared report stage,
  and that the replay shim, the stand-ins and the bridge each have a stage
  of their own, in the order they sit in the file
- `stable-content-script-names.spec.ts`,
  `source-index-nameless-chunks.spec.ts`, real rspack compiles. They read
  loaders from `programs/develop/dist`, so run the package `compile` first.

All files above sit in `__spec__/`.

How `BrowsersPlugin` and `SafariDevPlugin` call this API is covered from
`plugin-browsers/__spec__/` (`reload-eligibility.unit.spec.ts`,
`safari-dev-coalesce.unit.spec.ts`). Behavioral reload
verification is covered by the scripts templates in the public
[extension-js/templates](https://github.com/extension-js/templates) repo.

## What the browser console says

A line the reload code prints in the browser for a failure or a warning reads `Extension.js <CODE>: <text>`, with the code from the shared table, so a reader can look it up the way a terminal reader does. The codes are `W_RELOAD_NOT_APPLIED` (a reload or a hot update did not land), `W_CONTENT_SCRIPT_NOT_INJECTED` (the background cannot answer a page asking for its content script) and `W_DEV_SERVER_SOCKET` (a page lost its dev server socket). The content script wrapper prints `W_CONTENT_SCRIPT_CLEANUP` and `W_CONTENT_SCRIPT_MOUNT` the same way. A line that only informs, such as `[Extension.js] Reloading <label>…` in open tabs, carries no code. `__spec__/browser-console-codes.spec.ts` pins both rules.

The two reload failures the terminal reports (`compiled but the extension never confirmed the reload` and `has not come back since`) are the same failure seen from the dev server, so each is also recorded under `W_RELOAD_NOT_APPLIED`. The dev server writes it at once as a `warning` frame of a `--output json` or `ndjson` run and as a `warning` row of `events.ndjson`, and no compile frame repeats it. The terminal text carries no code. The log path, not this plugin, reads the code off a forwarded console line: `lib/browser-console-codes.ts` holds the pattern and the list, and the broker fills the `code` field of the log event when it takes the line in.
