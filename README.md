[action-image]: https://github.com/cezaraugusto/extension/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/cezaraugusto/extension/actions
[npm-image]: https://img.shields.io/npm/v/extension.svg
[npm-url]: https://npmjs.org/package/extension
[downloads-image]: https://img.shields.io/npm/dm/extension.svg
[downloads-url]: https://npmjs.org/package/extension
[node]: https://img.shields.io/node/v/extension.svg
[node-url]: https://nodejs.org
[prs]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg
[prs-url]: https://github.com/cezaraugusto/extension/blob/main/CONTRIBUTING.md
[vunlerabilities]: https://snyk.io/test/github/cezaraugusto/extension/badge.svg
[fossa-image]: https://app.fossa.com/api/projects/git%2Bgithub.com%2Fcezaraugusto%extension.svg?type=shield
[fossa-url]: https://app.fossa.com/projects/git%2Bgithub.com%2Fcezaraugusto%extension?ref=badge_large


# npx extension [![npm][npm-image]][npm-url] [![fossa][fossa-image]][fossa-url] [![workflow][action-image]][action-url] [![downloads][downloads-image]][downloads-url] [![PR's welcome][prs]][prs-url]

> Plug-and-play, zero-config, cross-browser extension development tool.

<img width="1440" alt="Screenshot 2024-03-25 at 13 06 15" src="https://github.com/cezaraugusto/docs.extensioncreate.com/assets/4672033/01a90694-4705-416e-898c-20bf845984e7">

<hr>

<img alt="Logo" align="right" src="https://user-images.githubusercontent.com/4672033/102850460-4d22aa80-43f8-11eb-82db-9efce586f73e.png" width="25%" />

__Create cross-browser extensions with no build configuration.__

- [Create A New Extension](#create-a-new-extension) — How to create a new extension.
- [Get Started Immediately](#get-started-immediately) — Get work done in no time.
- [I have An Extension](#i-have-an-extension) - Use only specific parts of `extension`.

<!-- `extension` is a development tool for browser extensions with built-in support for TypeScript, WebAssembly, React, and modern JavaScript.  -->
`extension` is a plug-and-play, zero-config, cross-browser extension development tool with built-in support for TypeScript, WebAssembly, React, and modern JavaScript.

## Create A New Extension

```sh
npx extension create my-extension
cd my-extension
npm run dev
```

A new browser instance will open up with your extension ready for development.

You are done. Time to hack on your extension!

https://github.com/cezaraugusto/extension/assets/4672033/7263d368-99c4-434f-a60a-72c489672586

## Get Started Immediately

## Kickstart Any Sample from Chrome Extension Samples

Dive right into development by starting with a sample from the Chrome Extension Samples repository. It's a great way to get acquainted with best practices and save time:

1. Open your terminal.
2. Navigate to the directory where you want your project.
3. Run the command:
   ```bash
   npx extension dev <sample-name>
   ```
   Replace `<sample-name>` with the name of the sample you wish to use from [Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples).

See the example below where we request the sample [page-redder](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder) from [Google Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples).

```sh
npx extension dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder --browser=edge
```

https://github.com/cezaraugusto/extension/assets/4672033/ee221a94-6ec7-4e04-8553-8812288927f1

### Use `Microsoft Edge` to kickstart any sample from [chrome-extesions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/)

`extension` supports a variety of browsers, including Microsoft Edge. To start an Edge-compatible extension, simply:

1. Open your terminal.
2. Navigate to your desired project directory.
3. Execute:
   ```bash
   npx extension dev  <sample-name> --browser=edge
   ```
   Tailor your command by replacing `<sample-name>` with the specific sample you're interested in.

> See the example below where we request the sample [magic8ball](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/topSites/magic8ball) from  from [Google Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples) using Edge as the runtime browser.


```sh
npx extension dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/topSites/magic8ball --browser=edge
```

https://github.com/cezaraugusto/extension/assets/4672033/2db2a1f6-3110-4380-9a49-dc9d034146aa

### Run Mozilla Add-Ons Using Edge 

Bridge the gap between Firefox and Edge by running Mozilla Add-Ons using Edge:

1. Navigate to your project directory.
2. Use the command:
   ```bash
   npx extension dev <addon-name> --browser=edge --polyfill=true 
   ```
   This will fetch a Mozilla Add-On and adapt it for Edge.

> See the example below where we request the sample [Apply CSS](https://github.com/mdn/webextensions-examples/tree/main/apply-css) from [MDN WebExtensions Examples](https://github.com/mdn/webextensions-examples) using Edge as the runtime browser.

```sh
npx extension dev https://github.com/mdn/webextensions-examples/tree/main/apply-css --browser=edge --polyfill=true
```

https://github.com/cezaraugusto/extension/assets/4672033/130cb430-1567-419c-8c90-23fddcf20f00

## I have An Extension

https://github.com/cezaraugusto/extension/assets/4672033/48694a23-b7f1-4098-9c5d-eff49983739c

If you have an existing extension which is using a package manager, you can install the `extension` package and manually create the scripts used to run your extension. See the demo above or follow these instructions to get it done:

**Step 1 - Install extension as a `devDependency`**

```sh
npm install extension --save-dev
```

**Step 2 - Link your npm scripts with the executable `extension` commands**

```json
{
  "scripts": {
    "build": "extension build",
    "dev": "extension dev",
    "start": "extension start"
  },
  "devDependencies": {
    // ...other deps,
    "extension": "latest"
  }
}
```

Done. You are all set!

- To develop the extension, run `npm run dev`.
- To visualize the extension in production mode, run `npm run start`.
- To build the extension in production mode, run `npm run build`.

## Using a specific browser for development

### Desktop Browsers

☑️ = Likely works but no browser runner support yet.

| ![Brave Browser](https://raw.githubusercontent.com/alrra/browser-logos/main/src/brave/brave.svg) | ![Google Chrome](https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome.svg) | ![Microsoft Edge](https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge.svg) | ![Mozilla Firefox](https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg) | ![Opera Browser](https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera.svg) | <img width="110" src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari.svg">| ![Vivaldi Browser](https://raw.githubusercontent.com/alrra/browser-logos/main/src/vivaldi/vivaldi.svg) |
|-|-|-|-|-|-|-|
| Brave Browser | Google Chrome | Microsoft Edge | Mozilla Firefox | Opera Browser | Apple Safari | Vivaldi Browser |
| ☑️ | ✅ | ✅ | ⛔️ | ☑️ | ⛔️ | ☑️ |

### Mobile Browsers

| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" width="100"> | <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari-ios/safari-ios.svg" width="100"> | 
|-|-|
| Firefox For Android | Safari On iOS | 
| ⛔️ | ⛔️ |

If you want to target a specific browser, just pass the `--browser` flag to the `dev`/`start` command (based on the list available above), like `npx extension dev path/to/extension --browser=edge`.

> Hint
> Pass --browser="all" to load all available browsers at once.

```sh
extension dev --browser=all
```

<img width="1440" alt="Screenshot 2024-03-25 at 13 06 15" src="https://github.com/cezaraugusto/docs.extensioncreate.com/assets/4672033/01a90694-4705-416e-898c-20bf845984e7">

## License

MIT (c) Cezar Augusto.
