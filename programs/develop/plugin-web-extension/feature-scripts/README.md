# `feature-scripts`

`feature-scripts` is the scripts pipeline for `@/webpack/plugin-extension`.

It is responsible for:

- turning manifest script declarations into Rspack entries
- wrapping content scripts so they can mount into isolated roots
- keeping content-script runtime behavior separate from page/script entries
- enforcing the canonical content-script contract used by `plugin-reload` and `plugin-browsers`

The dev-only reload/HMR strategy is NOT part of this feature. It lives in
`programs/develop/plugin-reload`, which registers after this plugin and
decorates the entries created here.

## Entry point

The feature is wired from `index.ts`, in every mode:

1. `AddScripts`
2. `TraceRuntimeLoadedFiles`
3. `KeepGetURLImportsNative`
4. `AddContentScriptWrapper`
5. `AddPublicPathRuntimeModule` (production only)
6. `ValidateContentScriptSyntax`

## Important files

- `contracts.ts`
  Defines the canonical content-script entry and asset names like `content_scripts/content-0.js`.

- `steps/add-scripts.ts`
  Reads manifest script fields, validates paths, creates Rspack entries, and synthesizes a sequential data-url entry when a single content-script group declares multiple files.

- `steps/add-content-script-wrapper/*`
  Adds the loader/wrapper layer for content scripts and emits MAIN-world bridge scripts when needed. The wrapper is load-bearing in every mode: it converts `export default fn` into the `__EXTENSIONJS_mount(...)` call that invokes the user's default export — without it, production tree-shakes the entire content-script body.

- `steps/trace-runtime-loaded-files.ts`
  Copies through runtime-loaded files the module graph cannot see (classic worker `importScripts(...)`, `executeScript`/`insertCSS` `files` payloads).

- `steps/keep-geturl-imports-native.ts`
  Keeps `import(chrome.runtime.getURL(...))` a native `import()` in the emitted bundle.

- `steps/add-public-path-runtime-module.ts`
  Injects the production public-path runtime module for content bundles.

- `steps/validate-content-script-syntax.ts`
  Fails loudly on syntax errors swc tolerates but browsers silently refuse to inject.

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
- `plugin-reload` (classifier + reload strategy)
- `plugin-browsers`

If this contract changes, update those consumers together.

## Multiple content files

When a single manifest content-script group declares multiple files, `AddScripts` emits a sequential data-url module that imports all resolved JS and CSS inputs in order.

That keeps the user-facing manifest contract intact while giving the bundler and reload layer one canonical content entry to track.

## MAIN world support

MAIN-world content scripts get wrapper-side bridge script generation in `add-content-script-wrapper`; dev-mode bridge metadata for reinjection is built by `plugin-reload`'s `SetupReloadStrategy`.

The main bundle and bridge bundle are both registered under canonical content asset names so browser-side reinjection and source tracking stay deterministic.

## Testing

Focused unit coverage for this feature lives in `__spec__/`.

High-signal specs include:

- `add-scripts.spec.ts`
- `content-script-wrapper.spec.ts`
- `contracts.spec.ts`
- `get-bridge-scripts.spec.ts`
- `scripts-plugin-wrapper-gating.spec.ts`

Reload-strategy specs live in `plugin-reload/__spec__/`. Behavioral reload verification is covered from `_FUTURE/examples/scripts/`.

## Maintenance notes

- Keep path-sensitive helpers inside `steps/` or `scripts-lib/` so imports remain local and easy to refactor.
- Prefer documenting canonical entry behavior in `contracts.ts` and this README instead of scattering assumptions across comments.
- If files move again, update this README alongside import paths so the folder remains self-describing.
