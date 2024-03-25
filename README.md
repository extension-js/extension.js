[action-image]: https://github.com/cezaraugusto/extension-create/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/cezaraugusto/extension-create/actions
[npm-image]: https://img.shields.io/npm/v/extension-create.svg
[npm-url]: https://npmjs.org/package/extension-create
[downloads-image]: https://img.shields.io/npm/dm/extension-create.svg
[downloads-url]: https://npmjs.org/package/extension-create
[node]: https://img.shields.io/node/v/extension-create.svg
[node-url]: https://nodejs.org
[prs]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg
[prs-url]: https://github.com/cezaraugusto/extension-create/blob/main/CONTRIBUTING.md
[vunlerabilities]: https://snyk.io/test/github/cezaraugusto/extension-create/badge.svg
[fossa-image]: https://app.fossa.com/api/projects/git%2Bgithub.com%2Fcezaraugusto%2Fextension-create.svg?type=shield
[fossa-url]: https://app.fossa.com/projects/git%2Bgithub.com%2Fcezaraugusto%2Fextension-create?ref=badge_large

<a href="https://www.producthunt.com/posts/extension-create?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-extension&#0045;create" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=446776&theme=light" alt="extension&#0045;create - Create&#0032;cross&#0045;browser&#0032;extensions&#0032;with&#0032;no&#0032;build&#0032;configuration&#0046; | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

# extension-create [![npm][npm-image]][npm-url] [![fossa][fossa-image]][fossa-url] [![workflow][action-image]][action-url] [![downloads][downloads-image]][downloads-url] [![PR's welcome][prs]][prs-url]

<img alt="Logo" align="right" src="https://user-images.githubusercontent.com/4672033/102850460-4d22aa80-43f8-11eb-82db-9efce586f73e.png" width="25%" />

Create cross-browser extensions with no build configuration.

- [Create A New Extension](#create-a-new-extension) — How to create a new extension.
- [Get Started Immediately](#get-started-immediately) — Get work done in no time.
- [I have An Extension](#i-have-an-extension) - Use only specific parts of `extension-create`.

`extension-create` is a development tool for browser extensions with built-in support for TypeScript, WebAssembly, React, and modern JavaScript.

## Create A New Extension

```sh
npx extension@latest create my-extension
cd my-extension-hello
npm run dev
```

A new browser instance will open up with your extension ready for development.

You are done. Time to hack on your extension!

<div>
    <a href="https://www.loom.com/share/58e21900d693417db1e0e59c0a96c4b3">
      <p>Create A New Extension - Watch Video</p>
    </a>
    <a href="https://www.loom.com/share/58e21900d693417db1e0e59c0a96c4b3">
      <img style="max-width:700px;" src="https://cdn.loom.com/sessions/thumbnails/58e21900d693417db1e0e59c0a96c4b3-1711317353826-with-play.gif">
    </a>
  </div>

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

<div>
    <a href="https://www.loom.com/share/34fc48f3f7954bfa990e767c6a7172f0">
      <p>🔥 Get Started Immediately - Watch Video</p>
    </a>
    <a href="https://www.loom.com/share/34fc48f3f7954bfa990e767c6a7172f0">
      <img style="max-width:700px;" src="https://cdn.loom.com/sessions/thumbnails/34fc48f3f7954bfa990e767c6a7172f0-1711318521320-with-play.gif">
    </a>
  </div>

### Use `Microsoft Edge` to kickstart any sample from [chrome-extesions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/)

`extension-create` supports a variety of browsers, including Microsoft Edge. To start an Edge-compatible extension, simply:

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

<div>
    <a href="https://www.loom.com/share/284d706379a84adabfdde6bd341b8d24">
      <p>Get Started Immediately (using Edge) - Watch Video</p>
    </a>
    <a href="https://www.loom.com/share/284d706379a84adabfdde6bd341b8d24">
      <img style="max-width:700px;" src="https://cdn.loom.com/sessions/thumbnails/284d706379a84adabfdde6bd341b8d24-1711318805218-with-play.gif">
    </a>
  </div>

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
npx extension dev https://github.com/mdn/webextensions-examples/tree/main/apply-css
```

<div>
    <a href="https://www.loom.com/share/6eb724aad822413fb4fe9f52afec5576">
      <p>Get Started Immediately (Using A Mozilla Add-On on Edge) - Watch Video</p>
    </a>
    <a href="https://www.loom.com/share/6eb724aad822413fb4fe9f52afec5576">
      <img style="max-width:700px;" src="https://cdn.loom.com/sessions/thumbnails/6eb724aad822413fb4fe9f52afec5576-1711319191911-with-play.gif">
    </a>
  </div>

## I have An Extension

<div>
    <a href="https://www.loom.com/share/c7ae4fc7cdfc47c39334c7efe3175dd9">
      <p>Usage With An Existing Extension - Watch Video</p>
    </a>
    <a href="https://www.loom.com/share/c7ae4fc7cdfc47c39334c7efe3175dd9">
      <img style="max-width:300px;" src="https://cdn.loom.com/sessions/thumbnails/c7ae4fc7cdfc47c39334c7efe3175dd9-1711318289851-with-play.gif">
    </a>
  </div>

If you have an existing extension which is using a package manager, you can install the `extension-create` package and manually create the scripts used to run your extension. See the demo above or follow these instructions to get it done:

**Step 1 - Install extension-create as a `devDependency`**

```sh
npm install extension --save-dev
```

**Step 2 - Link your npm scripts with the executable `extension-create` commands**

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

If you want to target a specific browser, just pass the `--browser` flag to the `dev`/`start` command (based on the list available above), like `npx extension-create dev --browser=edge`.

> Hint
> Pass --browser="all" to load all available browsers at once.

```sh
extension dev --browser=all
```

<img width="1440" alt="Screenshot 2024-03-25 at 13 06 15" src="https://github.com/cezaraugusto/docs.extensioncreate.com/assets/4672033/01a90694-4705-416e-898c-20bf845984e7">

## License

MIT (c) Cezar Augusto.
