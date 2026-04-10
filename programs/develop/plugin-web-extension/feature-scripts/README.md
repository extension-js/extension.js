# `feature-scripts`

`feature-scripts` is the scripts pipeline for `@/webpack/plugin-extension`.

It is responsible for:

- turning manifest script declarations into Rspack entries
- wrapping content scripts so they can mount into isolated roots
- keeping content-script runtime behavior separate from page/script entries
- applying the dev-only reload strategy for background and content updates
- enforcing the canonical content-script contract used by `plugin-browsers`

## Entry point

The feature is wired from `index.ts`.

Production mode:

1. `AddScripts`
2. `AddContentScriptWrapper`
3. `AddPublicPathRuntimeModule`

Development mode:

1. `AddScripts`
2. `AddContentScriptWrapper`
3. `StripContentScriptDevServerRuntime`
4. `SetupReloadStrategy`
5. `ThrowIfManifestScriptsChange`

## Important files

- `contracts.ts`
  Defines the canonical content-script entry and asset names like `content_scripts/content-0.js`.

- `steps/add-scripts.ts`
  Reads manifest script fields, validates paths, creates Rspack entries, and synthesizes a sequential data-url entry when a single content-script group declares multiple files.

- `steps/setup-reload-strategy/index.ts`
  Applies the dev-only background entry setup, manifest defaults, and the `webpack-target-webextension-fork` runtime behavior used during development.

- `steps/setup-reload-strategy/add-content-script-wrapper/*`
  Adds the loader/wrapper layer for content scripts and emits MAIN-world bridge scripts when needed.

- `steps/add-public-path-runtime-module.ts`
  Injects the production public-path runtime module for content bundles.

- `steps/strip-content-script-dev-server-runtime.ts`
  Removes dev-server startup code from emitted content-script assets so content scripts use browser-owned reinjection instead of page HMR startup.

- `steps/throw-if-manifest-scripts-change.ts`
  Stops watch mode when manifest script entrypoints change, because those changes require a clean dev restart.

- `steps/setup-reload-strategy/apply-manifest-dev-defaults/*`
  Dev-only manifest patch helpers for background, CSP, externally connectable, and web-accessible resources.

- `scripts-lib/*`
  Shared helpers for manifest/script discovery and minimum runtime files.

## Canonical contract

The rest of the dev pipeline does not infer content entries from user folder names. It relies on the canonical contract exported by `contracts.ts`.

- Entry names: `content_scripts/content-${index}`
- JS assets: `content_scripts/content-${index}.js`
- CSS assets: `content_scripts/content-${index}.css`
- Layer: `extensionjs-content-script`

That contract is consumed by:

- `feature-manifest`
- `feature-html`
- `plugin-browsers`
- content reload dependency tracking

If this contract changes, update those consumers together.

## Multiple content files

When a single manifest content-script group declares multiple files, `AddScripts` emits a sequential data-url module that imports all resolved JS and CSS inputs in order.

That keeps the user-facing manifest contract intact while giving the bundler and reload layer one canonical content entry to track.

## MAIN world support

MAIN-world content scripts are handled through bridge metadata built in `SetupReloadStrategy` and wrapper-side bridge script generation in `add-content-script-wrapper`.

The main bundle and bridge bundle are both registered under canonical content asset names so browser-side reinjection and source tracking stay deterministic.

## Testing

Focused unit coverage for this feature lives in `__spec__/`.

High-signal specs include:

- `add-scripts.spec.ts`
- `content-script-wrapper.spec.ts`
- `contracts.spec.ts`
- `get-bridge-scripts.spec.ts`
- `apply-manifest-dev-defaults.spec.ts`
- `strip-content-script-dev-server-runtime.spec.ts`

Behavioral reload verification is covered from `_FUTURE/examples/scripts/`.

## Maintenance notes

- Keep path-sensitive helpers inside `steps/` or `scripts-lib/` so imports remain local and easy to refactor.
- Prefer documenting canonical entry behavior in `contracts.ts` and this README instead of scattering assumptions across comments.
- If files move again, update this README alongside import paths so the folder remains self-describing.
