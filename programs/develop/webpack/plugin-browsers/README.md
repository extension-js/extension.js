[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/plugin-browsers

Runs a target browser (Chrome, Edge, Firefox, or custom binaries) with your extension loaded, managing user profiles, flags, live inspection (CDP/RDP), and optional unified logging to the CLI.

### Feature overview

|                                                                            | Feature                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Ephemeral profiles**<br/>Default per-run profiles under `dist/extension-js/profiles`.  |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Persistent dev profile (opt-in)**<br/>`persistProfile: true` uses `/dev`.              |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **System profile (opt-in)**<br/>`EXTENSION_USE_SYSTEM_PROFILE=true` uses system profile. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Flags & prefs**<br/>Append/exclude flags; merge preferences.                           |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Binary selection**<br/>System Chrome/Edge, custom Chromium/Gecko binaries.             |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Protocol inspection**<br/>CDP (Chromium) and RDP (Firefox) setup after start.          |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Unified logging (Chromium)**<br/>Stream console/log events per-context to the CLI.     |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Port selection**<br/>Derives per-instance port and falls back to a free one.           |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Dry-run**<br/>Print resolved binary/flags without running the browser.                 |

### Profile behavior

- Default (no `profile`): ephemeral profile at `dist/extension-js/profiles/<browser>-profile/tmp-*`.
- `persistProfile: true`: stable `dist/extension-js/profiles/<browser>-profile/dev`.
- `profile: '<path>'`: use the provided directory.
- `profile: false`: skip managed profile (Chromium omits `--user-data-dir`, Firefox omits `--profile`).
- `EXTENSION_USE_SYSTEM_PROFILE=true`: force system profile (skip managed flags entirely).
- `EXTENSION_TMP_PROFILE_MAX_AGE_HOURS=<n>`: retention for old `tmp-*` dirs (default 12).

### Usage

```ts
import {BrowsersPlugin} from '@/plugin-browsers'

export default {
  plugins: [
    new BrowsersPlugin({
      extension: ['/abs/path/to/dist/chrome'],
      browser: 'chrome', // also supports 'edge' | 'firefox' | 'chromium-based' | 'gecko-based' | 'firefox-based'
      // Profile options (see Profile behavior):
      // profile: '/custom/profile/path' | false
      persistProfile: false,
      browserFlags: ['--hide-scrollbars'],
      excludeBrowserFlags: ['--mute-audio'],
      preferences: {},
      startingUrl: 'http://localhost:5173',
      // Custom binaries (auto-sets browser to chromium-based/gecko-based)
      // chromiumBinary: '/path/to/chromium'
      // geckoBinary: '/path/to/firefox'
      port: 9222,
      dryRun: false,
      // Unified logging (Chromium via CDP)
      logLevel: 'info',
      logContexts: [
        'background',
        'content',
        'page',
        'sidebar',
        'popup',
        'options',
        'devtools'
      ],
      logFormat: 'pretty', // 'json' | 'ndjson'
      logTimestamps: true,
      logColor: true
    })
  ]
}
```

### API (constructor options)

```ts
export class BrowsersPlugin {
  static readonly name: 'plugin-browsers'
  constructor(options: {
    extension: string | string[]
    browser:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'chromium-based'
      | 'gecko-based'
      | 'firefox-based'
    noOpen?: boolean
    browserFlags?: string[]
    excludeBrowserFlags?: string[]
    profile?: string | false
    persistProfile?: boolean
    preferences?: Record<string, unknown>
    startingUrl?: string
    chromiumBinary?: string
    geckoBinary?: string
    port?: number | string
    instanceId?: string
    // Source inspection (dev only)
    source?: string
    watchSource?: boolean
    // Dry-run (print binary/flags and exit)
    dryRun?: boolean
    // Unified logging (Chromium CDP)
    logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'
    logContexts?: Array<
      | 'background'
      | 'content'
      | 'page'
      | 'sidebar'
      | 'popup'
      | 'options'
      | 'devtools'
    >
    logFormat?: 'pretty' | 'json' | 'ndjson'
    logTimestamps?: boolean
    logColor?: boolean
    logUrl?: string
    logTab?: number | string
  })
  apply(compiler: import('@rspack/core').Compiler)
}
```

### Port behavior

- Base port taken from `port` (or dev-server) plus per-instance offset; if busy, a nearby free port is selected.
- The effective port is recorded internally for downstream inspection steps.

### Quality of life

- **Dry-run mode**: Skip running the browser and print the resolved binary and flags.
- **Port fallback**: If the chosen CDP/RDP port is busy, the plugin falls back to a nearby free port.
- **Safer defaults**: Suppresses `--load-extension` pollution in flags, supports `excludeBrowserFlags`, and warns when using `profile: false`.

### Notes

- Inspection: CDP (Chromium) and RDP (Firefox) are wired for reload/inspection in development mode.
- Ports: chosen via `port` and probed for availability; fallback to nearby free port.

### Logging (CLI unified stream)

Chromium can stream unified logs from different contexts to the CLI:

- `logLevel`: filter which events are printed (`off|error|warn|info|debug|trace|all`).
- `logContexts`: contexts to include (`background,content,page,sidebar,popup,options,devtools`).
- Optional formatting: `logFormat` (`pretty|json|ndjson`), `logTimestamps`, `logColor`.

Notes:

- These flags affect only CLI output. They do not change the centralized DevTools UI.
- The centralized DevTools UI (see `templates/extension-js-devtools/`) is independent and runs in DevTools.

### License

MIT (c) Cezar Augusto
