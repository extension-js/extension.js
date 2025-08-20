[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

## @/plugin-browsers

Launches a target browser (Chrome, Edge, Firefox, or custom binaries) with your extension loaded, managing user profiles, flags, and live inspection options.

### Feature overview

|                                                                            | Feature                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Managed profiles**<br/>Creates and reuses profiles under `dist/extension-js/profiles/<browser>-profile` when safe. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Custom profiles**<br/>Use a specific profile directory via `--profile <path>` (validated/created if missing).      |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **System profile opt‑out**<br/>`--profile false` uses the browser’s default profile (no managed dir created).        |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Flags & prefs**<br/>Append or exclude browser flags; merge master preferences with user overrides.                 |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Binary selection**<br/>Support for system Chrome/Edge, Playwright Chromium, custom Chromium/Gecko binaries.        |

### Profile behavior

- No `--profile` provided: uses a managed shared profile at `dist/extension-js/profiles/<browser>-profile`. When a lock or concurrent run is detected, falls back to a per‑instance subfolder using a short instance ID.
- `--profile <path>`: uses the provided directory after validation; it will be created if missing and populated with baseline preferences.
- `--profile false`: disables managed profiles and launches the browser with its default user profile (Chromium without `--user-data-dir`, Firefox without `-profile`). No `false` directory is created.

### Usage

```ts
import {BrowsersPlugin} from '@/plugin-browsers'

export default {
  plugins: [
    new BrowsersPlugin({
      extension: ['/abs/path/to/dist/chrome'],
      browser: 'chrome',
      // Profile options (see Profile behavior):
      // profile: '/custom/profile/path'
      // profile: false
      browserFlags: ['--hide-scrollbars'],
      excludeBrowserFlags: ['--mute-audio'],
      preferences: {
        /* browser-specific prefs */
      }
    })
  ]
}
```

### API

```ts
export class BrowsersPlugin {
  static readonly name: 'plugin-browsers'
  constructor(options: {
    extension: string | string[]
    browser: 'chrome' | 'edge' | 'firefox' | 'chromium-based' | 'gecko-based'
    open?: boolean
    browserFlags?: string[]
    excludeBrowserFlags?: string[]
    profile?: string | false
    preferences?: Record<string, any>
    startingUrl?: string
    chromiumBinary?: string
    geckoBinary?: string
    port?: number | string
    // Internal: instanceId and reuseProfile are wired by the dev server
    instanceId?: string
    reuseProfile?: boolean
    // Source inspection (dev only)
    source?: string
    watchSource?: boolean
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### Quality of life

- **Dry-run mode**: Skip launching the browser and print the resolved binary and flags
- **Port fallback**: If the chosen CDP/RDP port is busy, the plugin falls back to a nearby free port
- **Safer defaults**: Suppresses `--load-extension` pollution in flags, supports `excludeBrowserFlags`, and warns when using `profile: false`

### Notes

- Managed profiles are stored inside the bundler output directory to keep build artifacts self‑contained and easy to clean.
- When profile reuse is enabled and safe, multiple runs will share a single profile; if a lock or another run is detected, a per‑instance profile is used automatically.
- `--profile false` is intended for scenarios where you want the browser to use its default user profile and session data.

### License

MIT (c) Cezar Augusto
