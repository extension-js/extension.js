# `plugin-reload`

`plugin-reload` owns the dev-only reload/HMR strategy for `extension dev`,
end to end. It was extracted from `plugin-web-extension/feature-scripts`
(build-time injection) and `plugin-browsers` (classification + dispatch) so
the reload concern has a single owner.

It is responsible for:

- injecting the dev reload runtime into the built extension:
  background entry setup, the vendored `webpack-target-webextension` fork,
  the SW scripts-replay shim, and the control-bridge producer/relay
  (console forwarding for unified logging)
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
  The whole pipeline no-ops in production and under
  `EXTENSION_NO_RELOAD=true` (`--no-reload`).
- the classifier/dispatch API (`classifyReloadFromSources`,
  `buildSourceFeatureIndex`, `dispatchReload`,
  `createChangedSourcesTracker`, …) consumed by `plugin-browsers`'
  `BrowsersPlugin` (launched-browser path) and `dev-server/index.ts`
  (`--no-browser` broadcast path). Centralizing the decision keeps both
  paths converged: the same change always resolves to the same reload type.

## Development pipeline

Applied by `ReloadPlugin` in order:

1. `StripContentScriptDevServerRuntime`
2. `SetupReloadStrategy`
3. `InjectScriptsReplayShim`
4. `SetupDevContentScripts` (Chromium only)
5. `InjectBridgeProducer`
6. `InjectBridgeRelay`

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
  extension. `createLoadedContentScripts` keeps what the browser last read,
  so `--no-browser` resolves an edit the way a launched browser does, and
  it takes a swapped sheet as read only once `settle(true)` says a producer
  received it.
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

- `steps/setup-reload-strategy/`
  Dev-only background entry setup and the vendored
  `webpack-target-webextension-fork` runtime behavior (see `VENDORED.md`).
  Builds MAIN-world bridge metadata under canonical content asset names.

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

## Contracts

The canonical content-script entry/asset names come from
`plugin-web-extension/feature-scripts/contracts.ts`. This plugin consumes
that contract; it does not define it.

## Testing

- `__spec__/reload-plugin-gating.spec.ts`, dev-only gating
- `__spec__/classify-reload.unit.spec.ts`, classifier decisions
- `__spec__/reload-dispatch.unit.spec.ts`, dispatch seam
- `__spec__/loaded-content-scripts.spec.ts`, `__spec__/web-resources.unit.spec.ts`, what the browser last read
- `__spec__/setup-background-entry.spec.ts`, `__spec__/inject-scripts-replay-shim.spec.ts`, `__spec__/strip-content-script-dev-server-runtime.spec.ts`, step behavior

`BrowsersPlugin`-level classification integration is covered from
`plugin-browsers/__spec__/classify.unit.spec.ts`. Behavioral reload
verification is covered by the scripts templates in the public
[extension-js/templates](https://github.com/extension-js/templates) repo.
