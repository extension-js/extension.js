[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/extension-js/extension.js/actions
[npm-image]: https://img.shields.io/npm/v/extension.svg
[npm-url]: https://npmjs.org/package/extension
[downloads-image]: https://img.shields.io/npm/dm/extension.svg
[downloads-url]: https://npmjs.org/package/extension
[node]: https://img.shields.io/node/v/extension.svg
[node-url]: https://nodejs.org
[prs]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg
[prs-url]: https://github.com/extension-js/extension/blob/main/CONTRIBUTING.md
[snyk-image]: https://snyk.io/test/github/extension-js/extension/badge.svg
[snyk-url]: https://snyk.io/test/github/extension-js/extension
[npm-version-image]: https://img.shields.io/npm/v/extension.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension
[discord-image]: https://img.shields.io/discord/1253608412890271755?label=Discord&logo=discord&style=flat
[discord-url]: https://discord.gg/v9h2RgeTSN

# Extension.js [![Version][npm-version-image]][npm-version-url] [![Downloads][downloads-image]][downloads-url] [![workflow][action-image]][action-url] [![discord][discord-image]][discord-url]

> The cross-browser extension framework.

<hr />

<img alt="Logo" align="right" src="https://user-images.githubusercontent.com/4672033/102850460-4d22aa80-43f8-11eb-82db-9efce586f73e.png" width="22.5%" />

- [Create A New Extension](#create-a-new-extension) — How to create a new extension.
- [Get Started Immediately](#get-started-immediately) — Get work done in no time.
- [Start From A Template](https://extension.land/templates) — Start with your favorite tool.
- [I have An Extension](#i-have-an-extension) — Use only specific parts of Extension.js.

Extension.js makes it very easy to develop cross-browser extensions.<br />Developers use it due to its fast builds, simple interface, and zero-configuration setup.

## Create A New Extension

```bash
npx extension create my-extension
cd my-extension
npm run dev
```

https://github.com/cezaraugusto/extension/assets/4672033/7263d368-99c4-434f-a60a-72c489672586

## Web Standards and Framework Support

For a preview of extensions running these technologies, see the [templates](https://extension.land/templates) website.

| <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/a9e2541a-96f0-4caa-9fc9-5fc5c3e901c8" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/b42c5330-9e2a-4045-99c3-1f7d264dfaf4" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/f19edff3-9005-4f50-b05c-fba615896a7f" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/ff64721d-d145-4213-930d-e70193f8d57e" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/15f1314a-aa65-4ce2-a3f3-cf53c4f730cf" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/c5f8a127-3c2a-4ceb-bb46-948cf2c8bd89" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/de1082fd-7cf6-4202-8c12-a5c3cd3e5b42" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/78e5fe3d-dc79-4aa2-954e-1a5973d1d9db" width="70"> | <img src="https://github.com/cezaraugusto/extension.js/assets/4672033/8807efd9-93e5-4db5-a1d2-9ac524f7ecc2" width="70"> |
| :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: |
|                                                    ESNext<br>latest                                                     |                                                  TypeScript<br>latest                                                   |                                                     WASM<br>latest                                                      |                                                      React<br>18+                                                       |                                                        Vue<br>3+                                                        |                                                      Angular<br>👋                                                      |                                                      Svelte<br>5+                                                       |                                                       Solid<br>👋                                                       |                                                      Preact<br>10+                                                      |

👋 = PR Welcome!

## Get Started Immediately

### Use Chrome to start developing an extension from Chrome Extension Samples

> See the example below where we request the sample [page-redder](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder) from [Google Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples).

```bash
npx extension dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder --browser=edge
```

https://github.com/cezaraugusto/extension/assets/4672033/ee221a94-6ec7-4e04-8553-8812288927f1

</details>

<!--
<details>
   <summary>
   🔥 Use Edge to start developing an extension from Chrome Extension Samples
   </summary>

> See the example below where we request the sample [magic8ball](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/topSites/magic8ball) from from [Google Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples) with Edge as the runtime browser.

```bash
npx extension dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/topSites/magic8ball --browser=edge
```

https://github.com/cezaraugusto/extension/assets/4672033/2db2a1f6-3110-4380-9a49-dc9d034146aa

</details>

<details>
   <summary>
   🔥🔥 Use Edge to start developing a Mozilla Add-On from MDN WebExtensions Examples
   </summary>

> See the example below where we request the sample [Apply CSS](https://github.com/mdn/webextensions-examples/tree/main/apply-css) from [MDN WebExtensions Examples](https://github.com/mdn/webextensions-examples) using Edge as the runtime browser.

```bash
npx extension dev https://github.com/mdn/webextensions-examples/tree/main/apply-css --browser=edge --polyfill=true
```

https://github.com/cezaraugusto/extension/assets/4672033/130cb430-1567-419c-8c90-23fddcf20f00

</details>

<details>
   <summary>
   🔥🔥🔥 Use Chrome and Firefox to start developing a Mozilla Add-On from MDN WebExtensions Examples
   </summary>

> See the example below where we request the sample [firefox-code-search](https://github.com/mdn/webextensions-examples/tree/main/firefox-code-search) from [MDN WebExtensions Examples](https://github.com/mdn/webextensions-examples) using Chrome and Firefox as the runtime browsers.

```bash
npx extension dev https://github.com/mdn/webextensions-examples/tree/main/firefox-code-search --browser=chrome,firefox --polyfill=true
```

https://github.com/cezaraugusto/extension.js/assets/4672033/ac94b608-c936-40df-bce7-63ffd7fe31c5

</details>
-->

## I have An Extension

https://github.com/cezaraugusto/extension/assets/4672033/48694a23-b7f1-4098-9c5d-eff49983739c

If you have an existing extension which is using a package manager, you can install the Extension.js package and manually create the scripts used to run your extension.

**Step 1 - Install extension as a `devDependency`**

```bash
npm install extension --save-dev
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

| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chromium/chromium.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari.svg" width="70"> |
| :-----------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------: |
|                                              Chrome<br>✅                                               |                                               Chromium<br>☑️                                                |                                             Edge<br>✅                                              |                                               Firefox<br>✅                                               |                                              Opera<br>☑️                                              |                                              Safari<br>⛔️                                              |

The browsers listed above represent those with official extension stores. Note that Chromium-based browsers (like Arc, Brave, Vivaldi, and many others) are theoretically supported through the Chrome/Chromium compatibility layer.

### Mobile Browsers

| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" width="70"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari-ios/safari-ios.svg" width="70"> |
| :-------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------: |
|                                         Firefox (Android)<br>⛔️                                          |                                               Safari (iOS)<br>⛔️                                               |

## License

MIT (c) Cezar Augusto and the Extension.js authors.
