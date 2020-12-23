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

- [Creating an extension](#creating-an-extension) – How to create a new extension.
- [Getting started immediately](#getting-started-immediately) – Get work done in no time.

`extension-create` helps you develop extensions with built-in support for esnext, module imports/exports, auto-reload, unit testing, and more. Read about the project vision and personal motivations [here](https://github.com/cezaraugusto/extension-create/wiki/This-initiative).

## Creating an Extension

```sh
npx extension-create my-extension-hello
cd my-extension-hello
npm start
```

A new browser instance (for now, Chrome) will open up with your extension ready for development.

You are done. Time to hack on your extension!

<!-- TODO add demo image
<p align='center'>
<img src='DEMO.png' width='600' alt='npm start'>
</p>
-->

## Getting Started Immediately

### Kickstart any sample from `chrome-extesions-sample`

Say you like the extension sample `set_icon_path`. The sample URL on GitHub is https://github.com/GoogleChrome/chrome-extensions-samples/tree/master/api/browserAction/set_icon_path.

```sh
npx extension-create start --remote https://github.com/GoogleChrome/chrome-extensions-samples/tree/master/api/browserAction/set_icon_path
```

Will not only download the extension but also kickstart a Chrome instance in a fresh profile with your sample extension loaded. Try it!

This also works with any other GitHub URL
as long as it points to a directory includig the manifest within its root path.

## Next steps

Project roadmap TBD. These are the major areas I plan to cover (sorted)

- [x] `create` - Everything needed to create a new extension. Supports templates (alpha)
- [ ] `develop` - Everything needed to develop a new extension. (under development)
  - [x] `start` - Runs the extension on a browser with support for hot-reload, JS modules, and custom browser configs. (in progress)
    - [ ] `--browser` - Sets the browser to open. Defaults to default broser
      - [x] `chrome` - Develop your extension running a standalone Chrome instance
      - [ ] `firefox` - Develop your extension running a standalone Firefox instance
      - [ ] `edge` (Chromium) - Develop your extension running a standalone Edge (Chromium) instance
      - [ ] `safari` - Develop your extension running a standalone Safari instance
      - [ ] `brave` - Develop your extension running a standalone Brave instance
      - [ ] `multiple` TBD - Develop your extension running multiple browser instances
    - [ ] Other browsers TBD
  - [ ] `build` - Prepares the code with production defaults for the publish step.
  - [ ] `test` - Unit test extensions using Jest
  - [ ] `lint` - Lints the extension with defaults optimized for cross-browser extesions
  - [ ] `eject` - Detaches the current extension project as a standalone project. (similar to `create-react-app` eject option)
- [ ] `publish` - Everything needed to publish or update a new extension to all popular extension stores. (TBD)

## License

MIT (c) Cezar Augusto.
