[npm-version-image]: https://img.shields.io/npm/v/extension.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension
[downloads-image]: https://img.shields.io/npm/dm/extension.svg
[downloads-url]: https://npmjs.org/package/extension
[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/extension-js/extension.js/actions
[coverage-image]: https://img.shields.io/codecov/c/github/extension-js/extension.js
[coverage-url]: https://codecov.io/github/extension-js/extension.js
[discord-image]: https://img.shields.io/discord/1253608412890271755?label=Discord&logo=discord&style=flat
[discord-url]: https://discord.gg/v9h2RgeTSN
[snyk-image]: https://snyk.io/test/github/extension-js/extension/badge.svg
[snyk-url]: https://snyk.io/test/github/extension-js/extension

> The cross-browser extension framework

# Extension.js [![Version][npm-version-image]][npm-version-url] [![Downloads][downloads-image]][downloads-url] [![workflow][action-image]][action-url] [![coverage][coverage-image]][coverage-url] [![discord][discord-image]][discord-url]

<img alt="Logo" align="right" src="https://avatars.githubusercontent.com/u/172809806" width="20%" />

- [Create A New Extension](#create-a-new-extension) — How to create a new extension.
- [Get Started Immediately](#get-started-immediately) — Get work done in no time.
- [Start From An Example](https://github.com/extension-js/extension.js/tree/main/examples) — Start with your favorite tool.
- [I have An Extension](#i-have-an-extension) — Use only specific parts of Extension.js.

Extension.js makes it very easy to develop cross-browser extensions.<br />Developers prefer it for its fast builds, unified interface, and zero configuration setup.

## Create A New Extension

Use the `create` command to generate a new extension. Also works with pnpm, yarn, and bun.

```bash
npx extension@latest create my-extension
cd my-extension
npm run dev
```

### Watch Demo

https://github.com/cezaraugusto/extension/assets/4672033/7263d368-99c4-434f-a60a-72c489672586

## Web Standards and Framework Support

<!-- For a preview of extensions running these technologies, see the [templates](https://templates.extension.land) website. -->

| <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/a9e2541a-96f0-4caa-9fc9-5fc5c3e901c8" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/b42c5330-9e2a-4045-99c3-1f7d264dfaf4" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/f19edff3-9005-4f50-b05c-fba615896a7f" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/ff64721d-d145-4213-930d-e70193f8d57e" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/15f1314a-aa65-4ce2-a3f3-cf53c4f730cf" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/de1082fd-7cf6-4202-8c12-a5c3cd3e5b42" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/78e5fe3d-dc79-4aa2-954e-1a5973d1d9db" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/c5f8a127-3c2a-4ceb-bb46-948cf2c8bd89" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/8807efd9-93e5-4db5-a1d2-9ac524f7ecc2" width="70"> |
| :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: |
|                                                    ESNext<br>latest                                                     |                                                  TypeScript<br>latest                                                   |                                                     WASM<br>latest                                                      |                                                      React<br>18+                                                       |                                                        Vue<br>3+                                                        |                                                      Svelte<br>5+                                                       |                                                      Preact<br>10+                                                      |                                                      Angular<br>👋                                                      |                                                       Solid<br>👋                                                       |

👋 = PR Welcome!

## Get Started Immediately

Start developing an extension using a sample from Chrome Extension Samples

See the example below where we request the sample [page-redder](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder) from [Google Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples).

### Watch Demo

https://github.com/cezaraugusto/extension/assets/4672033/ee221a94-6ec7-4e04-8553-8812288927f1

### Try Yourself

```bash
npx extension@latest dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder --browser=edge
```

</details>

## I have An Extension

If you have an existing extension which is using a package manager, you can install the Extension.js package and manually create the scripts used to run your extension.

### See How It Works

https://github.com/cezaraugusto/extension/assets/4672033/48694a23-b7f1-4098-9c5d-eff49983739c

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

### Desktop Browsers

| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chromium/chromium.svg" width="70"> |
| :-----------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------: |
|                                              Chrome<br>✅                                               |                                             Edge<br>✅                                              |                                               Firefox<br>✅                                               |                                              Opera<br>☑️                                              |                                              Safari<br>⛔️                                              |                                               Chromium<br>☑️                                                |

The browsers listed above represent those with official extension stores. Note that Chromium-based browsers (like Arc, Brave, Vivaldi, and many others) are theoretically supported through the Chrome/Chromium compatibility layer.

### Mobile Browsers

| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari-ios/safari-ios.svg" width="70"> |
| :-------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------: |
|                                         Firefox (Android)<br>⛔️                                          |                                               Safari (iOS)<br>⛔️                                               |

## License

MIT (c) Cezar Augusto and the Extension.js Authors.
