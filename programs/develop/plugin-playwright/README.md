[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-playwright

> Machine-readable automation metadata for Playwright/AI workflows, especially when running with `--no-browser`.

### What it does

- **PlaywrightPlugin**: Hooks compiler lifecycle and writes deterministic metadata to:
  - `dist/extension-js/<browser>/ready.json`
  - `dist/extension-js/<browser>/events.ndjson`
- **createPlaywrightMetadataWriter**: Reusable writer for run-only flows (`preview`/`start`) that do not rely on full compiler watch semantics.

### Contract

`ready.json` fields (stable for automation):

- `status`: `starting` | `ready` | `error` | `stopped`
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

`events.ndjson` events (the file is reset at every run start and holds the
current run only, join on `runId` to correlate across runs):

- `compile_start`
- `compile_success`
- `compile_error`
- `browser_exited`
- `shutdown`

Every row carries `type`, `ts`, `command`, `browser` and `runId`. A
`compile_error` row adds `errorCount` and up to ten `errors`; a `browser_exited`
row adds `exitCode`, `exitSignal` and `browserExitedAt`.

The stream is bounded like `logs.ndjson`: it rotates at 8 MB or 50,000 lines
into `events.1.ndjson` through `events.3.ndjson`, and a single row over 64 KB
has its error text trimmed and is marked `truncated: true`. Every row stays
valid JSON, so a consumer always parses line by line.

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
