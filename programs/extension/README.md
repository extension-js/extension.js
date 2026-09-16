[npm-version-image]: https://img.shields.io/npm/v/extension.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension
[stars-image]: https://img.shields.io/github/stars/extension-js/extension.js?style=flat&color=0971fe
[stars-url]: https://github.com/extension-js/extension.js/stargazers
[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main&color=0971fe
[action-url]: https://github.com/extension-js/extension.js/actions
[discord-image]: https://img.shields.io/discord/1253608412890271755?label=Discord&logo=discord&style=flat&color=0971fe
[discord-url]: https://discord.gg/v9h2RgeTSN
[bestpractices-image]: https://img.shields.io/cii/level/14662?label=OpenSSF%20Best%20Practices&style=flat&color=0971fe
[bestpractices-url]: https://www.bestpractices.dev/projects/14662

# Extension.js [![Version][npm-version-image]][npm-version-url] [![Stars][stars-image]][stars-url] [![CI][action-image]][action-url] [![Discord][discord-image]][discord-url] [![OpenSSF Best Practices][bestpractices-image]][bestpractices-url]

> The cross-browser extension framework. Build for Chrome, Edge, Firefox, and Safari with no build config required.

<img alt="Logo" align="right" src="https://avatars.githubusercontent.com/u/172809806" width="14.1%" />

```bash
npx extension@latest create my-extension
cd my-extension
npm run dev
```

Works with `npm`, `pnpm`, `yarn`, `bun`, and `deno`.

The CLI itself runs on Node.js 22.12+, Deno 2.5+, and Bun 1.2+.

[Documentation](https://extension.js.org/docs) · [Templates](https://templates.extension.dev/?utm_source=readme&utm_campaign=nav-templates) · [Showcase](https://extension.js.org/showcase) · [Blog](https://extension.js.org/blog)

## Why Extension.js

Browser extensions ship with the worst dev experience in modern web. Manifest V3 fragmentation, browser-specific quirks, no hot reload for content scripts, and a separate build pipeline for every target. Extension.js fixes that.

- **Hot Module Replacement** for popup, options, devtools and other extension pages, including React, Vue, Svelte, and Preact components, with targeted reloads for content scripts and the service worker so one save never reloads the whole extension
- **Manifest V3 by default**, with automatic adapters for Chrome, Edge, Firefox, and Safari targets
- **One CLI** for Chrome, Edge, Firefox, and any Chromium or Gecko binary
- **Zero config**, no webpack, no rollup, no plugins to maintain
- **First-class** TypeScript, React, Vue, Svelte, and Preact support
- **Production builds** with `extension build --zip`, ready for the Chrome Web Store and Firefox Add-ons
- **Drop-in** for existing extensions with one `devDependency`

## Watch it work

[![One command, and the extension is running in a real browser](https://media.extension.land/video/extension-js/sixty-second-demo.gif)](https://extension.js.org/docs)

Or skip the install and try a [live template](https://templates.extension.dev) in your browser.

## How is this different

If you have used [Plasmo](https://www.plasmo.com), [WXT](https://wxt.dev), or [CRXJS](https://crxjs.dev), here is what Extension.js does that the others do not:

| Capability | Extension.js |
| :--------- | :----------- |
| Run any GitHub sample directly | `extension dev https://github.com/.../sample` |
| Managed browser binaries | `extension install firefox` downloads an isolated build |
| Targeted content-script reload across browsers | Built in, only the changed entries re-inject, no plugin glue |
| Production zip for the stores | `extension build --zip` |
| Framework agnostic | [Vanilla](https://templates.extension.dev/javascript), [TS](https://templates.extension.dev/typescript), [React](https://templates.extension.dev/react), [Vue](https://templates.extension.dev/vue), [Svelte](https://templates.extension.dev/svelte), [Preact](https://templates.extension.dev/preact), no lock-in |
| Custom Chromium and Gecko binaries | `--chromium-binary`, `--gecko-binary` |

Extension.js is sponsored by [extension.dev](https://docs.extension.dev/?utm_source=readme), the platform that hosts the build, share and store submission side of shipping an extension. To hand someone an unpublished build behind a link, with no zip and no install on their side, see [Share an unpublished build for review](https://docs.extension.dev/share/unpublished-build-for-review?utm_source=readme).

## Frameworks

<div align="center">

| <img alt="ESNext" src="https://github.com/cezaraugusto/extension.js/assets/4672033/a9e2541a-96f0-4caa-9fc9-5fc5c3e901c8" width="70"> | <img alt="TypeScript" src="https://github.com/cezaraugusto/extension.js/assets/4672033/b42c5330-9e2a-4045-99c3-1f7d264dfaf4" width="70"> | <img alt="WASM" src="https://github.com/cezaraugusto/extension.js/assets/4672033/f19edff3-9005-4f50-b05c-fba615896a7f" width="70"> | <img alt="React" src="https://github.com/cezaraugusto/extension.js/assets/4672033/ff64721d-d145-4213-930d-e70193f8d57e" width="70"> | <img alt="Vue" src="https://github.com/cezaraugusto/extension.js/assets/4672033/15f1314a-aa65-4ce2-a3f3-cf53c4f730cf" width="70"> | <img alt="Svelte" src="https://github.com/cezaraugusto/extension.js/assets/4672033/de1082fd-7cf6-4202-8c12-a5c3cd3e5b42" width="70"> | <img alt="Preact" src="https://github.com/cezaraugusto/extension.js/assets/4672033/8807efd9-93e5-4db5-a1d2-9ac524f7ecc2" width="70"> |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| ESNext<br>[Try out](https://templates.extension.dev/javascript) | TypeScript<br>[Try out](https://templates.extension.dev/typescript) | WASM<br>[Try out](https://github.com/extension-js/examples/tree/main/examples/transformers-js) | React<br>[Try out](https://templates.extension.dev/react) | Vue<br>[Try out](https://templates.extension.dev/vue) | Svelte<br>[Try out](https://templates.extension.dev/svelte) | Preact<br>[Try out](https://templates.extension.dev/preact) |

</div>

## Browsers

Use these flags with `extension dev`, `extension start`, or `extension preview`:

- Select a browser: `--browser <chrome | edge | firefox | safari>`
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
| <sup>Google Chrome<br>✅ Supported</sup> | <sup>Microsoft Edge<br>✅ Supported</sup> | <sup>Mozilla Firefox<br>✅ Supported</sup> | <sup>Apple Safari<br>✅ Supported</sup> | <sup>Chromium-based<br>✅ Supported</sup> | <sup>Gecko-based<br>✅ Supported</sup> |

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

Run `npm run dev` to develop, and watch the browser open with your extension already loaded:

[![extension dev: the browser opens with the extension loaded](https://media.extension.land/video/extension-js/dev-build-preview.gif)](https://extension.js.org/docs/commands/dev)

Use `npm run build` for production, and `npm run preview` to inspect the production output.

## Start from a Chrome sample

Pull any sample from [Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples) and run it directly:

```bash
npx extension@latest dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder --browser=edge
```

[![Running a Chrome sample straight from its GitHub URL](https://media.extension.land/video/extension-js/run-chrome-sample.gif)](https://extension.js.org/docs/getting-started/immediately)

## Package managers

<div align="center">

| <img alt="npm" src="https://media.extension.land/logos/package-managers/npm.svg" width="70"> | <img alt="pnpm" src="https://media.extension.land/logos/package-managers/pnpm.svg" width="70"> | <img alt="Yarn" src="https://media.extension.land/logos/package-managers/yarn.svg" width="70"> | <img alt="Bun" src="https://media.extension.land/logos/package-managers/bun.svg" width="70"> | <picture><source media="(prefers-color-scheme: dark)" srcset="https://media.extension.land/logos/package-managers/deno-dark.svg"><img alt="Deno" src="https://media.extension.land/logos/package-managers/deno.svg" width="70"></picture> |
| :-: | :-: | :-: | :-: | :-: |
| npm<br>✅ Supported | pnpm<br>✅ Supported | Yarn<br>✅ Supported | Bun<br>✅ Supported | Deno<br>✅ Supported |

</div>

Each of these installs Extension.js, launches it, and runs its scripts. Which runtime the CLI then executes on is a separate question.

## Runtimes

| Runtime | Status | Notes |
| :-- | :-- | :-- |
| Node.js | ✅ 22.12 and newer | The default. `npx`, `pnpm dlx`, `yarn dlx` and `bunx` all land here through the published bin |
| Deno | ✅ 2.5 and newer | `deno run -A npm:extension@latest`. Deno 2.8.0 is refused because it cannot load `node:querystring`, fixed in 2.8.1 |
| Bun | ✅ 1.2 and newer | `bunx --bun extension` and `bun run --bun`. Plain `bunx` runs the CLI on Node.js instead, through the published bin |

## Community

- Star the repo if Extension.js helped you ship faster
- Join the [Discord](https://discord.gg/v9h2RgeTSN) for help and feedback
- Open issues and feature requests on [GitHub](https://github.com/extension-js/extension.js/issues)
- Browse production-ready [examples](https://github.com/extension-js/examples)

## Sponsors

Sponsors help the project ship faster releases, better developer experience, and long-term reliability for extension teams.

<div align="center">
  <p>
    <a href="https://extension.dev/?utm_medium=sponsor&utm_source=extensionjs" target="_blank" rel="noopener noreferrer">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://extension.js.org/images/sponsors/extensiondev_dark.svg" />
        <source media="(prefers-color-scheme: light)" srcset="https://extension.js.org/images/sponsors/extensiondev.svg" />
        <img src="https://extension.js.org/images/sponsors/extensiondev.svg" width="220" alt="extension.dev" />
      </picture>
    </a>
  </p>
  <p>
    <a href="https://github.com/sponsors/cezaraugusto">Become a sponsor</a>
  </p>
</div>

Documentation is hosted by [Mintlify](https://mintlify.com/?utm_medium=infrastructure&utm_source=extensionjs) through its open source program. Tiers and placement are listed in [BACKERS.md](https://github.com/extension-js/extension.js/blob/main/BACKERS.md).

## Contributing

Bug reports and pull requests are welcome. Read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the dev setup, the test commands, and what a pull request needs to carry.

## License

MIT (c) Cezar Augusto and the Extension.js authors.
