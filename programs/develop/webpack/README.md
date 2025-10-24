[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

## @/webpack

> Rspack-powered plugin stack used by Extension.js to build browser extensions.

A curated set of Rspack-powered plugins used by Extension.js to build browser extensions. Each plugin is small and focused; together they provide a batteries‑included developer experience with sensible defaults and production‑ready output.

### Plugins

| Name                 | Group | Summary                                                                                                                                                                                                         |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plugin-extension     | core  | - Core builder: emits pages and scripts<br/>- Validates and rewrites `manifest.json`<br/>- Ships icons, JSON, locales, and web resources<br/>- Ensures dev parity between local and shipped output              |
| plugin-css           | core  | - Auto‑wires CSS for HTML and content scripts<br/>- Optional SASS/LESS/PostCSS when configs exist<br/>- Integrates Stylelint when configured                                                                    |
| plugin-js-frameworks | core  | - Detects React/Preact/Vue/Svelte and TypeScript<br/>- Configures SWC parsing, loaders/plugins, and safe aliases<br/>- Sets `tsconfig` resolution<br/>- Defers heavy work to `beforeRun` in production          |
| plugin-static-assets | core  | - Emits images, fonts, and misc files to `assets/`<br/>- Inlines small SVGs (≤2KB), emits larger ones<br/>- Content hashing in production; stable names in development<br/>- Respects existing custom SVG rules |
| plugin-compatibility | core  | - Cross‑browser helpers<br/>- Normalizes browser‑specific manifest fields<br/>- Optional `webextension-polyfill` for Chromium                                                                                   |
| plugin-compilation   | core  | - Loads env and templating (`EXTENSION_PUBLIC_*`)<br/>- Optional `dist/<browser>` cleaning<br/>- Compact, de‑duplicated compilation summary                                                                     |

### Notes and compatibility

- Built against `@rspack/core`; Webpack 5 may work for some plugins but is not officially supported here.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid embedding secrets in templated `.json`/`.html`.

### Related files in this folder

- `webpack-config.ts`: Assembles the plugin stack and shared configuration.
- `dev-server/`: Local development server wiring and reload orchestration.
- `webpack-types.ts`: Common types for the plugin stack.

### License

MIT(c) Cezar Augusto
