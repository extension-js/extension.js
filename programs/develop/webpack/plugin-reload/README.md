[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

### @/webpack/plugin-reload

> Dev-time live-reload and HMR orchestration for browser extensions.

### What it does

- Starts a WebSocket server per dev instance to broadcast file changes to a Manager extension.
- Patches your manifest for safe dev defaults (CSP, web_accessible_resources, background entries, externally_connectable).
- Injects lightweight reload clients for Chromium- and Firefox-based browsers.
- Coordinates full recompiles when HTML entrypoints change.

### Feature overview

|                                                                            | Feature                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **WebSocket server**<br/>Per-instance server broadcasting changes to a Manager extension; instance-aware messaging and heartbeats. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Manifest dev defaults**<br/>Applies safe CSP, WER, background entries, externally_connectable overrides for development.         |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Browser clients**<br/>Injects minimal reload clients for Chromium and Firefox; falls back to HTTP when HTTPS certs are absent.   |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **HTML change coordination**<br/>Triggers full recompiles when HTML entrypoints change for correctness.                            |

### Usage

```ts
import {ReloadPlugin} from '@/webpack/plugin-reload'

export default {
  plugins: [
    new ReloadPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      browser: 'chrome',
      port: 3303,
      stats: true,
      autoReload: true
    })
  ]
}
```

### API

```ts
export class ReloadPlugin {
  static readonly name: 'plugin-reload'
  constructor(options: {
    manifestPath: string
    browser?:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'safari'
      | 'chromium-based'
      | 'gecko-based'
    port?: number | string
    stats?: boolean
    autoReload?: boolean
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### Notes

- Firefox development may log a certificate requirement if `localhost` certs are missing; the server will fall back to HTTP for convenience.
- The WebSocket server sends an initial `serverReady` message and tracks clients with heartbeat pings.
