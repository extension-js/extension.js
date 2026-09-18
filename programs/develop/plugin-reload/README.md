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

- `reload-dispatch.ts`
  Routes a `ReloadInstruction` to the control-bridge broker (SW producer).
  Honors `EXTENSION_NO_RELOAD`.

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
  on a stub's signal, heals open tabs after a worker restart and reloads the
  tabs an edited entry matches. Every emitted bundle starts with a marker
  that records its file on the world it runs in, and every injection path
  probes that marker first, so a frame never runs two copies. Entries with
  `include_globs`/`exclude_globs` are stub-only (no dynamic form exists):
  the static stub decides where they run and the worker injects on its
  signal. Firefox, MV2 and a build without a worker keep static entries and
  the producer's manifest-based re-inject.

- `steps/inject-bridge-producer.ts` / `steps/inject-bridge-relay.ts`
  Control-bridge instrumentation: forward background-SW and content-script
  console output to the dev-server control WS. Not reload in the strict
  sense, they ride the same bridge and the same dev-only gate.

## Contracts

The canonical content-script entry/asset names come from
`plugin-web-extension/feature-scripts/contracts.ts`. This plugin consumes
that contract; it does not define it.

## Testing

- `__spec__/reload-plugin-gating.spec.ts`, dev-only gating
- `__spec__/classify-reload.unit.spec.ts`, classifier decisions
- `__spec__/reload-dispatch.unit.spec.ts`, dispatch seam
- `__spec__/setup-background-entry.spec.ts`, `__spec__/inject-scripts-replay-shim.spec.ts`, `__spec__/strip-content-script-dev-server-runtime.spec.ts`, step behavior

`BrowsersPlugin`-level classification integration is covered from
`plugin-browsers/__spec__/classify.unit.spec.ts`. Behavioral reload
verification is covered by the scripts templates in the public
[extension-js/examples](https://github.com/extension-js/examples) repo.
