# Content scripts in Extension.js

Extension.js wraps content scripts during development (and lightly in production) to make reloads safe without relying on `location.reload()` (which is problematic in real-page content script contexts).

This document describes the expected behavior and the authoring contract.

## Authoring contract (required)

For every **content-script-like** entry (anything referenced by `manifest.json > content_scripts[*].js` and scripts under the project `scripts/` folder), Extension.js expects:

- **Default export**: a **synchronous function** that performs your setup. (Classes are **not** supported as the default export.)
- **Optional cleanup**: the function may return a **synchronous** callback that undoes side effects.

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

### Supported default export shapes

- `export default function main() { ... }`
- `export default function () { ... }`
- `export default () => { ... }`
- `function main() { ... } export default main`
- `const main = () => { ... }; export default main`

### What happens if the contract is violated

- **No default export**: Extension.js warns during development, and the wrapper won’t mount anything.
- **Default export is not a function** (e.g. `export default class ...`, `export default {}`): Extension.js warns during development, and at runtime the wrapper will **skip mounting** (so the script won’t run until fixed).

### Async work and async exports

Extension.js calls your default export and expects a cleanup function (or `void`) back. Because of that:

- `export default async function main()` will be **called**, but it returns a `Promise`, so Extension.js cannot treat it as a cleanup callback.
- Unhandled rejections from that `Promise` are not automatically captured by the wrapper.

Recommended pattern: keep the default export synchronous, start async work inside it, and return a synchronous cleanup:

Copy/paste template (simple async pattern)

```ts
export default function main() {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []

  const addCleanup = (fn: () => void) => (cleanups.push(fn), fn)

  void run({signal: controller.signal, addCleanup})

  return () => {
    controller.abort()
    cleanups.splice(0).forEach((fn) => fn())
  }
}
```

Best practice: inside `run`, honor cancellation:

- Pass `signal` to async APIs that support it (e.g. `fetch`).
- Between `await`s, exit early when `signal.aborted` is true.
- For APIs without `signal`, register cleanup or add an abort listener.

If you want AI help, paste this prompt:

```txt
Replace `run` with my async logic. Keep the default export synchronous. Use the provided `signal` for cancellation and `addCleanup` for side effects. My async behavior is: <describe it>.
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
