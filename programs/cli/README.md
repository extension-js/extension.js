[action-image]: https://github.com/cezaraugusto/create-browser-extension/workflows/CI/badge.svg
[action-url]: https://github.com/cezaraugusto/create-browser-extension/actions
[npm-image]: https://img.shields.io/npm/v/create-browser-extension.svg
[npm-url]: https://npmjs.org/package/create-browser-extension
[wip-image]: https://img.shields.io/badge/under-development-orange.svg
[wip-url]: https://github.com/cezaraugusto/create-browser-extension

# Create Browser Extension [![workflow][action-image]][action-url] [![npm][npm-image]][npm-url] [![wip][wip-image]][wip-url]

<img alt="Logo" align="right" src="https://user-images.githubusercontent.com/4672033/102850460-4d22aa80-43f8-11eb-82db-9efce586f73e.png" width="25%" />

Create modern cross-browser extensions with no build configuration.

- [Creating an extension](#creating-an-extension) — How to create a new extension.
- [Getting started immediately](#getting-started-immediately) — Get work done in no time.
- [I have an extension](#i-have-an-extension) - Use only specific parts of `extension-create`.

`extension-create` helps you develop cross-browser extensions with built-in support for module imports/exports, auto-reload, and more. Interested to know how it's being developed? [Every week I send emails about its progress](https://cezaraugusto.substack.com/). For goals, see the [wiki](https://github.com/cezaraugusto/extension-create/wiki/This-initiative).

## Creating an Extension

```sh
npx extension-create my-extension-hello
cd my-extension-hello
npm start
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

```sh
npx extension-create dev https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder
```

<p align="center">
<img src="https://user-images.githubusercontent.com/4672033/106188671-04dc7200-6186-11eb-940a-52aebab46f31.gif" width="720" alt="npm start">
</p>

Will not only download the extension but also kickstart a Chrome instance in a fresh profile with your sample extension loaded and default auto-reload support. Try it yourself!

### Use `Microsoft Edge` to kickstart any sample from [chrome-extesions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/)

You read it! Just run the command above with the `--browser=edge` flag:

```
npx extension-create start --browser=edge https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder
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
  }
}
```

#### Using a specific browser for development

| <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome.svg" alt="Chrome browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge.svg" alt="Microsoft Edge browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox.svg" alt="Mozilla Firefox browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari.svg" alt="Apple Safari browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera.svg" alt="Opera browser logo"> | <img width=120 src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chromium/chromium.svg" alt="Chromium browser logo"> |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Google Chrome ✅                                                                                                                 | Microsoft Edge ✅                                                                                                                    | Mozilla Firefox ⛔️                                                                                                                         | Apple Safari ⛔️                                                                                                                       | Opera browser ⛔️                                                                                                             | Chromium (forks) 🤔                                                                                                                    |


If you want to target a specific browser, just pass the `--browser` flag to the dev/start command (Chrome or Edge, soon others), like `npx extension-create dev --browser=edge`.

That's it!

> _Hint: pass `all` instead of `edge` as an argument to load both Edge and Chrome at the same time!_

## Program Options Table

For a list of all commands available, see [OPTIONS_TABLE.md](OPTIONS_TABLE.md).

## What's next?

See the [Wiki](https://github.com/cezaraugusto/extension-create/wiki) for stable updates and future project roadmap. If you're interested in the latest news, I write weekly about this project development at https://cezaraugusto.substack.com.

## License

MIT (c) Cezar Augusto.
