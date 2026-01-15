# Content scripts in Extension.js

Extension.js wraps content scripts during development (and lightly in production) to make reloads safe without relying on `location.reload()` (which is problematic in real-page content script contexts).

This document describes the expected behavior and the authoring contract.

## Authoring contract (required)

For every **content-script-like** entry (anything referenced by `manifest.json > content_scripts[*].js` and scripts under the project `scripts/` folder), Extension.js expects:

- **Default export**: a function that performs your setup. (Classes are **not** supported as the default export.)
- **Optional cleanup**: the function may return a callback that undoes side effects.

Example:

```ts
export default function main() {
  // create DOM, add listeners, start observers, etc.
  const onClick = () => console.log('clicked')
  window.addEventListener('click', onClick)

  return () => {
    // undo side effects so HMR/reloads don't duplicate state
    window.removeEventListener('click', onClick)
  }
}
```

If you want to use a class, declare it inside your content script module and instantiate it from the default function:

```ts
class App {
  start() {
    // ...
  }
  stop() {
    // ...
  }
}

export default function main() {
  const app = new App()
  app.start()
  return () => app.stop()
}
```

Why: during development, Extension.js will **re-run** your module multiple times. Without cleanup, it’s easy to end up with duplicated UI, leaked event listeners, and inconsistent state.

## When your `default export` runs (mount timing)

For **declared** content scripts, Extension.js schedules the initial mount based on that script’s `run_at`:

- **`document_start`**: mount immediately when the module is evaluated.
- **`document_end`**: mount when `document.readyState` is `interactive` or `complete`.
- **`document_idle`** (default): mount when `document.readyState` is not `loading` (usually `interactive` or `complete`).

For scripts under `scripts/` (not declared in the manifest), Extension.js currently defaults to **`document_idle`** scheduling.

## Development behavior (reload/HMR)

Extension.js injects a small wrapper around content scripts to handle:

- **Safe re-application**: it calls your default export to “mount”, and calls the returned cleanup during disposal.
- **HMR**: it accepts JS updates and re-imports the wrapped module when HMR becomes idle.
- **CSS updates**: if your content script imports CSS, Extension.js wires HMR accepts for those imports and triggers a remount signal so your UI can re-render cleanly.
- **No page reload loops**: it blocks HMR’s `location.reload()` fallback on normal `http(s)` pages to prevent infinite reload loops after syntax errors.

## Production behavior

In production builds, Extension.js inlines a minimal mount wrapper so:

- Your default export still acts as the “entry” function.
- The optional cleanup exists for symmetry, but it typically won’t be used unless something explicitly disposes the module.

## Common pitfalls

- **Calling your default export yourself**: avoid patterns like:

```ts
function init() {}
export default init
init()
```

Extension.js will try to strip a direct top-level call to avoid “double mount” during development.

- **Side effects at module top-level**: if you attach listeners or mutate DOM at top-level, Extension.js can’t reliably undo that without your cleanup callback.

## Implementation notes (regex vs AST transforms)

Today the wrapper uses **regex-based heuristics** to detect/transform the default export and strip a bare top-level call.

Moving away from regex to an AST-based transform **does not have to mean a huge dependency**, but it depends on the tooling choice:

- **Smaller approach**: `acorn` (parse) + `magic-string` (surgical edits) is typically a modest dependency footprint.
- **Heavier approach**: `@babel/parser` + code generation toolchains tend to bring more transitive deps and a larger install size.

If we only want _detection_ (“does this module have a default export?”), a lighter dependency like `es-module-lexer` can work. For _rewrites_ (turning `export default ...` into an assignable reference safely), we need an AST + rewrite strategy.
