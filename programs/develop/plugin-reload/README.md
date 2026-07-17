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
- stripping the rspack-dev-server startup runtime from emitted content
  scripts so reinjection stays browser-owned
- classifying a watch-mode change into a reload instruction
  (`full` / `service-worker` / `content-scripts` / notify-only `page`)
- dispatching that instruction over the control-bridge broker — the same
  executor for launched browsers and `--no-browser`

## Entry point

`index.ts` exposes two seams:

- `ReloadPlugin` — the rspack plugin applied by `rspack-config.ts`. It must
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
4. `InjectBridgeProducer`
5. `InjectBridgeRelay`

## Important files

- `classify-reload.ts`
  The pure reload classifier. Decision order per changed file: forced-full
  (manifest/_locales) → chunk-graph membership → emitted static asset →
  name heuristics. Also defines `ReloadType` / `ReloadInstruction` — the
  control-bridge `contracts.ts` mirrors `ReloadType`; update them together.

- `reload-dispatch.ts`
  Routes a `ReloadInstruction` to the control-bridge broker (SW producer).
  Honors `EXTENSION_NO_RELOAD`.

- `steps/setup-reload-strategy/`
  Dev-only background entry setup and the vendored
  `webpack-target-webextension-fork` runtime behavior (see `VENDORED.md`).
  Builds MAIN-world bridge metadata under canonical content asset names.

- `steps/inject-bridge-producer.ts` / `steps/inject-bridge-relay.ts`
  Control-bridge instrumentation: forward background-SW and content-script
  console output to the dev-server control WS. Not reload in the strict
  sense — they ride the same bridge and the same dev-only gate.

## Contracts

The canonical content-script entry/asset names come from
`plugin-web-extension/feature-scripts/contracts.ts`. This plugin consumes
that contract; it does not define it.

## Testing

- `__spec__/reload-plugin-gating.spec.ts` — dev-only gating
- `__spec__/classify-reload.unit.spec.ts` — classifier decisions
- `__spec__/reload-dispatch.unit.spec.ts` — dispatch seam
- `__spec__/setup-background-entry.spec.ts`, `__spec__/inject-scripts-replay-shim.spec.ts`, `__spec__/strip-content-script-dev-server-runtime.spec.ts` — step behavior

`BrowsersPlugin`-level classification integration is covered from
`plugin-browsers/__spec__/classify.unit.spec.ts`. Behavioral reload
verification is covered from `_FUTURE/examples/scripts/`.
