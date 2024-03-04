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

# extension-create [![npm][npm-image]][npm-url] [![fossa][fossa-image]][fossa-url] [![workflow][action-image]][action-url] [![downloads][downloads-image]][downloads-url] [![PR's welcome][prs]][prs-url]

<img alt="Logo" align="right" src="https://user-images.githubusercontent.com/4672033/102850460-4d22aa80-43f8-11eb-82db-9efce586f73e.png" width="25%" />

Create cross-browser extensions with no build configuration.

- [Creating an extension](#creating-an-extension) — How to create a new extension.
- [Getting started immediately](#getting-started-immediately) — Get work done in no time.
- [I have an extension](#i-have-an-extension) - Use only specific parts of `extension-create`.

`extension-create` helps you develop cross-browser extensions with built-in support for module imports/exports, auto-reload, and more.

## Creating an Extension

```sh
npx extension-create@latest create my-extension-hello
cd my-extension-hello
npm run dev
```

A new browser instance will open up with your extension ready for development.

You are done. Time to hack on your extension!

<p align="center">
<img src="https://user-images.githubusercontent.com/4672033/106184765-ba0c2b80-6180-11eb-9d0f-d9d00d168290.gif" width="720" alt="npm start">
</p>

## Getting Started Immediately

### Kickstart any sample from Chrome Extension Samples

The [chrome-extensions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/) project is a great way to kickstart developing your extension.

If we go to the samples repository and look for an extension sample to work, let's say the [page-redder](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder) sample, all we need is to copy and paste it's URL as an argument for the start command:

#### Command

```sh
# This command will:
# 1. Download the Chrome extension sample URL to the current working directory
# 2. Bundle the downloaded extension using extension-create
# 3. Enable the extension in Chrome using a fresh user profile
npx extension-create dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder
```

<p align="center">
<img src="https://user-images.githubusercontent.com/4672033/106188671-04dc7200-6186-11eb-940a-52aebab46f31.gif" width="720" alt="npm start">
</p>

Will not only download the extension but also kickstart a Chrome instance in a fresh profile with your sample extension loaded and default auto-reload support. Try it yourself!

### Use `Microsoft Edge` to kickstart any sample from [chrome-extesions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/)

**You read it!** Just run the command above with the `--browser=edge` flag:

```sh
npx extension-create dev --browser=edge https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder
```

And see a Chrome Extension sample running automatically. On Edge!

## I have an extension

Just add `extension-create` to your npm scripts. Here's how it should look in your `package.json`:

```js
{
  // ...npm stuff,
  "scripts": {
    "start": "npx extension-create start",
    "dev": "npx extension-create dev",
    "build": "npx extension-create build"
  },
  "devDependencies": {
    "extension-create": "latest"
  }
}
```

#### Using a specific browser for development

| <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome.svg" alt="Chrome browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge.svg" alt="Microsoft Edge browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" alt="Mozilla Firefox browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari.svg" alt="Apple Safari browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera.svg" alt="Opera browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chromium/chromium.svg" alt="Chromium browser logo"> |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Google Chrome ✅                                                                                                                 | Microsoft Edge ✅                                                                                                                    | Mozilla Firefox ⛔️                                                                                                                         | Apple Safari ⛔️                                                                                                                       | Opera browser ⛔️                                                                                                             | Chromium (forks) 🤔                                                                                                                    |

If you want to target a specific browser, just pass the `--browser` flag to the dev/start command (Chrome or Edge, soon others), like `npx extension-create dev --browser=edge`.

That's it!

## Program Options Table

For a list of all commands available, see [OPTIONS_TABLE.md](OPTIONS_TABLE.md).

## License

MIT (c) Cezar Augusto.
