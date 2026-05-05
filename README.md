[npm-version-image]: https://img.shields.io/npm/v/extension.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension
[npm-downloads-image]: https://img.shields.io/npm/dm/extension.svg?color=0971fe
[npm-downloads-url]: https://www.npmjs.com/package/extension
[stars-image]: https://img.shields.io/github/stars/extension-js/extension.js?style=flat&color=0971fe
[stars-url]: https://github.com/extension-js/extension.js/stargazers
[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main&color=0971fe
[action-url]: https://github.com/extension-js/extension.js/actions
[discord-image]: https://img.shields.io/discord/1253608412890271755?label=Discord&logo=discord&style=flat&color=0971fe
[discord-url]: https://discord.gg/v9h2RgeTSN
[snyk-image]: https://snyk.io/test/github/extension-js/extension/badge.svg?color=0971fe
[snyk-url]: https://snyk.io/test/github/extension-js/extension

# Extension.js [![Version][npm-version-image]][npm-version-url] [![Downloads][npm-downloads-image]][npm-downloads-url] [![Stars][stars-image]][stars-url] [![CI][action-image]][action-url] [![Discord][discord-image]][discord-url] 

> Build extensions for Chrome, Edge, and Firefox. No build config required.

<img alt="Logo" align="right" src="https://avatars.githubusercontent.com/u/172809806" width="20%" />

```bash
npx extension@latest create my-extension
cd my-extension
npm run dev
```

Works with `npm`, `pnpm`, `yarn`, and `bun`.

[Documentation](https://extension.js.org) · [Templates](https://templates.extension.dev) · [Examples](https://github.com/extension-js/examples) · [Discord](https://discord.gg/v9h2RgeTSN)

## Why Extension.js

Browser extensions ship with the worst dev experience in modern web. Manifest V3 fragmentation, browser-specific quirks, no hot reload for content scripts, and a separate build pipeline for every target. Extension.js fixes that.

- **Hot Module Replacement** for background, content, popup, and options scripts, including React, Vue, Svelte, and Preact components
- **Manifest V3 by default**, with automatic adapters for Chrome, Edge, and Firefox targets
- **One CLI** for Chrome, Edge, Firefox, and any Chromium or Gecko binary
- **Zero config**, no webpack, no rollup, no plugins to maintain
- **First-class** TypeScript, React, Vue, Svelte, and Preact support
- **Production builds** with `extension build --zip`, ready for the Chrome Web Store and Firefox Add-ons
- **Drop-in** for existing extensions with one `devDependency`

## Watch it work

[60-second demo](https://github.com/cezaraugusto/extension/assets/4672033/7263d368-99c4-434f-a60a-72c489672586)

Or skip the install and try a [live template](https://templates.extension.dev) in your browser.

## How is this different

If you have used [Plasmo](https://www.plasmo.com), [WXT](https://wxt.dev), or [CRXJS](https://crxjs.dev), here is what Extension.js does that the others do not:

| Capability | Extension.js |
| :--------- | :----------- |
| Run any GitHub sample directly | `extension dev https://github.com/.../sample` |
| Managed browser binaries | `extension install firefox` downloads an isolated build |
| Cross-browser HMR for content scripts | Built in, no plugin glue |
| Production zip for the stores | `extension build --zip` |
| Framework agnostic | [Vanilla](https://templates.extension.dev/javascript), [TS](https://templates.extension.dev/typescript), [React](https://templates.extension.dev/react), [Vue](https://templates.extension.dev/vue), [Svelte](https://templates.extension.dev/svelte), [Preact](https://templates.extension.dev/preact), no lock-in |
| Custom Chromium and Gecko binaries | `--chromium-binary`, `--gecko-binary` |

## Frameworks

<div align="center">

| <img alt="ESNext" src="https://github.com/cezaraugusto/extension.js/assets/4672033/a9e2541a-96f0-4caa-9fc9-5fc5c3e901c8" width="70"> | <img alt="TypeScript" src="https://github.com/cezaraugusto/extension.js/assets/4672033/b42c5330-9e2a-4045-99c3-1f7d264dfaf4" width="70"> | <img alt="WASM" src="https://github.com/cezaraugusto/extension.js/assets/4672033/f19edff3-9005-4f50-b05c-fba615896a7f" width="70"> | <img alt="React" src="https://github.com/cezaraugusto/extension.js/assets/4672033/ff64721d-d145-4213-930d-e70193f8d57e" width="70"> | <img alt="Vue" src="https://github.com/cezaraugusto/extension.js/assets/4672033/15f1314a-aa65-4ce2-a3f3-cf53c4f730cf" width="70"> | <img alt="Svelte" src="https://github.com/cezaraugusto/extension.js/assets/4672033/de1082fd-7cf6-4202-8c12-a5c3cd3e5b42" width="70"> | <img alt="Preact" src="https://github.com/cezaraugusto/extension.js/assets/4672033/8807efd9-93e5-4db5-a1d2-9ac524f7ecc2" width="70"> |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| ESNext<br>[Try out](https://templates.extension.dev/javascript) | TypeScript<br>[Try out](https://templates.extension.dev/typescript) | WASM<br>[Try out](https://github.com/extension-js/examples/tree/main/examples/transformers-js) | React<br>[Try out](https://templates.extension.dev/react) | Vue<br>[Try out](https://templates.extension.dev/vue) | Svelte<br>[Try out](https://templates.extension.dev/svelte) | Preact<br>[Try out](https://templates.extension.dev/preact) |

</div>

## Browsers

Use these flags with `extension dev`, `extension start`, or `extension preview`:

- Select a browser: `--browser <chrome | edge | firefox>`
- Custom Chromium binary: `--chromium-binary <path-to-binary>`
- Custom Gecko (Firefox) binary: `--gecko-binary <path-to-binary>`

```bash
# Chrome (system default)
npx extension@latest dev --browser=chrome

# Edge
npx extension@latest dev --browser=edge

# Custom Chrome/Chromium path
npx extension@latest dev --chromium-binary "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Custom Firefox path
npx extension@latest dev --gecko-binary "/Applications/Firefox.app/Contents/MacOS/firefox"
```

<div align="center">

| <img alt="Chrome" src="https://media.extension.land/logos/browsers/chrome.svg" width="70"> | <img alt="Edge" src="https://media.extension.land/logos/browsers/edge.svg" width="70"> | <img alt="Firefox" src="https://media.extension.land/logos/browsers/firefox.svg" width="70"> | <img alt="Safari" src="https://media.extension.land/logos/browsers/safari.svg" width="70"> | <img alt="Chromium" src="https://media.extension.land/logos/browsers/chromium.svg" width="70"> | <img alt="Gecko" src="https://media.extension.land/logos/browsers/firefox.svg" width="70"> |
| :-: | :-: | :-: | :-: | :-: | :-: |
| Google Chrome<br>✅ Supported | Microsoft Edge<br>✅ Supported | Mozilla Firefox<br>✅ Supported | Apple Safari<br> 🚙 Next | Chromium-based<br>✅ Supported | Gecko-based<br>✅ Supported |

</div>

## Ship to the store

Build a production-ready bundle and zip it for submission to the Chrome Web Store, Edge Add-ons, or Firefox AMO:

```bash
# Production build
npx extension@latest build

# Production build packaged as a ZIP
npx extension@latest build --zip

# Per-browser builds
npx extension@latest build --browser=firefox --zip
```

Useful flags:

- `--zip` packages the build into a ZIP ready for store upload
- `--zip-source` includes source files for store source-code review
- `--zip-filename <name>` controls the output filename
- `--polyfill` enables the cross-browser webextension polyfill

## Manage browser binaries

Skip the system-install dance. Extension.js can download and manage isolated browser binaries for clean dev sessions:

```bash
# Install a managed Firefox build
npx extension@latest install firefox

# Install Chrome and Edge in one go
npx extension@latest install --browser=all

# Print where managed browsers live
npx extension@latest install --where
```

## Add to an existing extension

Install Extension.js as a dev dependency and wire up your scripts.

```bash
npm install extension@latest --save-dev
```

```json
{
  "scripts": {
    "build": "extension build",
    "dev": "extension dev",
    "preview": "extension preview"
  }
}
```

Run `npm run dev` to develop, `npm run build` for production, and `npm run preview` to inspect the production output. [See it in action.](https://github.com/cezaraugusto/extension/assets/4672033/48694a23-b7f1-4098-9c5d-eff49983739c)

## Start from a Chrome sample

Pull any sample from [Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples) and run it directly:

```bash
npx extension@latest dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder --browser=edge
```

[Watch demo](https://github.com/cezaraugusto/extension/assets/4672033/ee221a94-6ec7-4e04-8553-8812288927f1)

## Community

- Star the repo if Extension.js helped you ship faster
- Join the [Discord](https://discord.gg/v9h2RgeTSN) for help and feedback
- Open issues and feature requests on [GitHub](https://github.com/extension-js/extension.js/issues)
- Browse production-ready [examples](https://github.com/extension-js/examples)

## Sponsors

<div align="center">
  <p>
    <span style="font-size:21px">Browser testing via</span><br>
    <a href="https://www.testmuai.com/?utm_medium=sponsor&utm_source=extensionjs" target="_blank" rel="noopener noreferrer">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://assets.testmu.ai/resources/images/testmu-ai/common/whiteTestmulogo.svg" />
        <source media="(prefers-color-scheme: light)" srcset="https://assets.testmu.ai/resources/images/logos/black-logo.png" />
        <img src="https://assets.testmu.ai/resources/images/logos/black-logo.png" width="250" height="45" alt="TestMu AI Logo" />
      </picture>
    </a>
  </p>
</div>

## License

MIT (c) Cezar Augusto and the Extension.js authors.
