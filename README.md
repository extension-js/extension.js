[npm-version-image]: https://img.shields.io/npm/v/extension.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension
[npm-downloads-image]: https://img.shields.io/npm/dm/extension.svg?color=0971fe
[npm-downloads-url]: https://www.npmjs.com/package/extension
[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main&color=0971fe
[action-url]: https://github.com/extension-js/extension.js/actions
[discord-image]: https://img.shields.io/discord/1253608412890271755?label=Discord&logo=discord&style=flat&color=0971fe
[discord-url]: https://discord.gg/v9h2RgeTSN
[snyk-image]: https://snyk.io/test/github/extension-js/extension/badge.svg?color=0971fe
[snyk-url]: https://snyk.io/test/github/extension-js/extension

[![Version][npm-version-image]][npm-version-url] [![Downloads][npm-downloads-image]][npm-downloads-url] [![CI][action-image]][action-url] [![Discord][discord-image]][discord-url]

# Extension.js

> The cross-browser extension framework

<img alt="Logo" align="right" src="https://avatars.githubusercontent.com/u/172809806" width="20%" />

- [Create a new extension](#create-a-new-extension) — How to create a new extension.
- [Watch demo](#watch-demo) — See how creating a new extension works.
- [Start from an example](https://github.com/extension-js/extension.js/tree/main/examples) — Start from a working baseline.
- [I have an extension](#i-have-an-extension) — Use only specific parts of Extension.js.

Create cross-browser extensions without manual build configuration.<br />Use Extension.js to develop, build, and preview across browsers with a unified workflow.

## Create a new extension

Use the `create` command to generate a new extension. Also works with pnpm, yarn, and bun.

```bash
npx extension@latest create my-extension
cd my-extension
npm run dev
```

### Watch demo

[Watch demo](https://github.com/cezaraugusto/extension/assets/4672033/7263d368-99c4-434f-a60a-72c489672586)

## Web standards and framework support

<!-- For a preview of extensions running these technologies, see the [templates](https://templates.extension.land) website. -->

<div align="center">

| <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/a9e2541a-96f0-4caa-9fc9-5fc5c3e901c8" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/b42c5330-9e2a-4045-99c3-1f7d264dfaf4" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/f19edff3-9005-4f50-b05c-fba615896a7f" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/ff64721d-d145-4213-930d-e70193f8d57e" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/15f1314a-aa65-4ce2-a3f3-cf53c4f730cf" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/de1082fd-7cf6-4202-8c12-a5c3cd3e5b42" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/8807efd9-93e5-4db5-a1d2-9ac524f7ecc2" width="70"> |
| :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: |
|                            ESNext<br>[Try out](https://templates.extension.land/javascript)                             |                          TypeScript<br>[Try out](https://templates.extension.land/typescript)                           |                                                     WASM<br>(soon)                                                      |                               React<br>[Try out](https://templates.extension.land/react)                                |                                 Vue<br>[Try out](https://templates.extension.land/vue)                                  |                              Svelte<br>[Try out](https://templates.extension.land/svelte)                               |                              Preact<br>[Try out](https://templates.extension.land/preact)                               |

</div>

<details>
<summary>Get started from a sample</summary>

## Get started

Start developing an extension using a sample from Chrome Extension Samples

See the example below where we request the sample [page-redder](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder) from [Google Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples).

### Watch demo

[Watch demo](https://github.com/cezaraugusto/extension/assets/4672033/ee221a94-6ec7-4e04-8553-8812288927f1)

### Try Yourself

```bash
npx extension@latest dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder --browser=edge
```

</details>

## I have an extension

If you have an existing extension which is using a package manager, you can install the Extension.js package and manually create the scripts used to run your extension.

### See how it works

[See how it works](https://github.com/cezaraugusto/extension/assets/4672033/48694a23-b7f1-4098-9c5d-eff49983739c)

**Step 1 - Install extension as a `devDependency`**

```bash
npm install extension@latest --save-dev
```

**Step 2 - Link your npm scripts with the executable Extension.js commands**

```json
{
  "scripts": {
    "build": "extension build",
    "dev": "extension dev",
    "preview": "extension preview"
  },
  "devDependencies": {
    // ...other dependencies
    "extension": "latest"
  }
}
```

Done. You are all set!

- To develop the extension, run `npm run dev`.
- To build the extension in production mode, run `npm run build`.
- To visualize the extension in production mode, run `npm run build` and `npm run preview`.

## Using a specific browser for development

| <img src="https://media.extension.land/logos/browsers/chrome.svg" width="70"> | <img src="https://media.extension.land/logos/browsers/edge.svg" width="70"> | <img src="https://media.extension.land/logos/browsers/firefox.svg" width="70"> | <img src="https://media.extension.land/logos/browsers/safari.svg" width="70"> | <img src="https://media.extension.land/logos/browsers/chromium.svg" width="70"> | <img src="https://media.extension.land/logos/browsers/firefox.svg" width="70"> |
| :---------------------------------------------------------------------------: | :-------------------------------------------------------------------------: | :----------------------------------------------------------------------------: | :---------------------------------------------------------------------------: | :-----------------------------------------------------------------------------: | :----------------------------------------------------------------------------: |
|                             Chrome browser<br>✅                              |                             Edge browser<br>✅                              |                             Firefox browser<br>✅                              |                           Safari browser<br>(soon)                            |                              Chromium-based<br>✅                               |                               Gecko-based<br>✅                                |

### Browser flags and custom binaries

Use these flags with `extension dev`, `extension start`, or `extension preview`:

- Select a browser: `--browser <chrome | edge | firefox>`
- Custom Chromium binary: `--chromium-binary <path-to-binary>`
- Custom Gecko (Firefox) binary: `--gecko-binary <path-to-binary>`

Examples:

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
  <p>
    <span style="font-size:21px; color:black;">Browser testing via</span><br>
    <a href="https://www.lambdatest.com/?utm_source=extensionjs&utm_medium=sponsor" target="_blank" rel="noopener noreferrer">
      <img src="https://www.lambdatest.com/blue-logo.png" width="250" height="45" alt="LambdaTest Logo" />
    </a>
  </p>
</div>

## License

MIT (c) Cezar Augusto and the Extension.js Authors.
