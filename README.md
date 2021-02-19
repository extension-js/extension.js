> ### This prooject is under active development.

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
- [I have an extension](#i-have-an-extension) - Use only specific parts of `extension-create`

`extension-create` helps you develop cross-browser extensions with built-in support for module imports/exports, auto-reload, and more. Interested to know how it's being developed? [Every week I send emails about its progress](https://cezaraugusto.substack.com/). For goals, see the [wiki](https://github.com/cezaraugusto/extension-create/wiki/This-initiative).

## Creating an Extension

```sh
npx extension-create my-extension-hello
cd my-extension-hello
npm start
```

A new browser instance (for now, Chrome) will open up with your extension ready for development.

You are done. Time to hack on your extension!

<p align="center">
<img src="https://user-images.githubusercontent.com/4672033/106184765-ba0c2b80-6180-11eb-9d0f-d9d00d168290.gif" width="720" alt="npm start">
</p>

## Getting Started Immediately

### Kickstart any sample from [chrome-extesions-sample](https://github.com/GoogleChrome/chrome-extensions-samples/)

The URL for the **make_page_red** sample is https://github.com/GoogleChrome/chrome-extensions-samples/tree/master/api/browserAction/make_page_red. We then copy the URL and paste it using the start command:

> Optimized for **git version 2.30.0**. Older versions are supported but download can take much longer.

```sh
npx extension-create start https://github.com/GoogleChrome/chrome-extensions-samples/tree/master/api/browserAction/make_page_red
```

<p align="center">
<img src="https://user-images.githubusercontent.com/4672033/106188671-04dc7200-6186-11eb-940a-52aebab46f31.gif" width="720" alt="npm start">
</p>

Will not only download the extension but also kickstart a Chrome instance in a fresh profile with your sample extension loaded and default auto-reload support. Try it yourself!

## I have an extension

`extension-create` was designed to have each command/major feature working as a standalone module. This is useful if you have your extension setup but want to benefit from specific features, such as the browser launcher w/ default auto-reload support.

**Example:**

Using `npx extension-create start .` as an npm script alias. In your package.json:

```js
{
  // ...npm stuff,
  "scripts": {
    "start": "npx extension-create start"
  }
}
```

Will load your extension the same way the screenshot above demonstrates. This method is, in fact, what the [standard template does](https://github.com/cezaraugusto/extension-create/blob/main/create/steps/writePackageJson.js#L19-L21) when you run the create command `npx extension-create <extension-name>`.

## What's next?

See the [Wiki](https://github.com/cezaraugusto/extension-create/wiki) for stable updates and future project roadmap. If you're interesteed in the latest news, I write weekly about this project development at https://cezaraugusto.substack.com.

## License

MIT (c) Cezar Augusto.
