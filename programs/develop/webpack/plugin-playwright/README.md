[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-playwright

> Machine-readable automation metadata for Playwright/AI workflows, especially when running with `--no-browser`.

### What it does

- **PlaywrightPlugin**: Hooks compiler lifecycle and writes deterministic metadata to:
  - `dist/extension-js/<browser>/ready.json`
  - `dist/extension-js/<browser>/events.ndjson`
- **createPlaywrightMetadataWriter**: Reusable writer for run-only flows (`preview`/`start`) that do not rely on full compiler watch semantics.

### Contract

`ready.json` fields (stable for automation):

- `status`: `starting` | `ready` | `error`
- `command`: `dev` | `start` | `preview`
- `browser`
- `runId`
- `startedAt`
- `distPath`
- `manifestPath`
- `port`
- `pid`
- `ts`
- `compiledAt`
- `errors`
- optional `code` and `message` on failures

`events.ndjson` events:

- `compile_start`
- `compile_success`
- `compile_error`
- `shutdown`

### Usage

In bundler config (`dev`/watch-oriented):

```ts
new PlaywrightPlugin({
  packageJsonDir,
  browser, // optional (defaults to "chromium")
  mode, // used to derive command when command is omitted
  outputPath,
  manifestPath,
  port,
  // command: "dev" // optional explicit override
})
```

In run-only command flows:

```ts
const metadata = createPlaywrightMetadataWriter({
  packageJsonDir,
  browser,
  command: 'preview',
  distPath,
  manifestPath,
  port: null
})

metadata.writeStarting()
// ... command work ...
metadata.writeReady()
// ... or on failure ...
metadata.writeError('preview_manifest_missing', 'Expected manifest at ...')
```

### Notes

- Keep extension payload clean: metadata lives under `dist/extension-js/*`, not `dist/<browser>`.
- For scripts/agents, parse these files instead of terminal output.
