> ## This project is under active development and subject to change.

[action-image]: https://github.com/cezaraugusto/extension-create/workflows/CI/badge.svg
[action-url]: https://github.com/cezaraugusto/extension-create/actions
[npm-image]: https://img.shields.io/npm/v/extension-create.svg
[npm-url]: https://npmjs.org/package/extension-create
[wip-image]: https://img.shields.io/badge/under-development-orange.svg
[wip-url]: https://github.com/cezaraugusto/extension-create

# extension-create [![workflow][action-image]][action-url] [![npm][npm-image]][npm-url] [![wip][wip-image]][wip-url]

<img alt="Logo" align="right" src="https://user-images.githubusercontent.com/4672033/102850460-4d22aa80-43f8-11eb-82db-9efce586f73e.png" width="25%" />

Create modern cross-browser extensions with no build configuration.

- [Creating an extension](#creating-an-extension) — How to create a new extension.
- [Getting started immediately](#getting-started-immediately) — Get work done in no time.
- [Advancing your skills](https://github.com/cezaraugusto/browser-extensions-book) — Learn everything extensions can do for you, for free.

`extension-create` helps you develop cross-browser extensions with built-in support for module imports/exports, auto-reload, and more. Interested to know how it's being developed? Every week I send emails about its progress [here](https://cezaraugusto.substack.com/). For goals, see the [wiki](https://github.com/cezaraugusto/extension-create/wiki/This-initiative).

## Creating an Extension

```sh
npx extension-create my-extension-hello
cd my-extension-hello
npm start
```

A new browser instance (for now, Chrome) will open up with your extension ready for development.

You are done. Time to hack on your extension!

<!-- TODO: Add "extension-hello" sample
<p align="center">
<img src="" width="600" alt="npm start">
</p>
-->

## Getting Started Immediately

### Kickstart any sample from [chrome-extesions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/)

The URL for the **make_page_red** sample is https://github.com/GoogleChrome/chrome-extensions-samples/tree/master/api/browserAction/make_page_red. We then copy the URL and paste it using the start command:

```sh
npx extension-create start https://github.com/GoogleChrome/chrome-extensions-samples/tree/master/api/browserAction/make_page_red
```

<!-- TODO: add getting started sample
<p align="center">
<img src="https://user-images.githubusercontent.com/4672033/105644192-e0755280-5e72-11eb-90bd-658224eb33c7.gif" width="600" alt="npm start">
</p>
 -->
Will not only download the extension but also kickstart a Chrome instance in a fresh profile with your sample extension loaded. Try it yourself!

## What's next?

See the [Wiki](https://github.com/cezaraugusto/extension-create/wiki) for stable updates and future project roadmap. If you're interesteed in the latest news, I write weekly about this development at https://cezaraugusto.substack.com

## License

MIT (c) Cezar Augusto.
