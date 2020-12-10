> ## This project is under active development and subject to change.

[action-image]: https://github.com/cezaraugusto/create-browser-extension/workflows/CI/badge.svg
[action-url]: https://github.com/cezaraugusto/create-browser-extension/actions
[npm-image]: https://img.shields.io/npm/v/create-browser-extension.svg
[npm-url]: https://npmjs.org/package/create-browser-extension
[wip-image]: https://img.shields.io/badge/under-development-orange.svg
[wip-url]: https://github.com/cezaraugusto/create-browser-extension

# Create Browser Extension [![workflow][action-image]][action-url] [![npm][npm-image]][npm-url] [![wip][wip-image]][wip-url]

<img alt="Logo" align="right" src="LOGO.png" width="25%" />

Create modern cross-browser extensions with no build configuration.

- [Creating an extension](#creating-an-extension) – How to create a new extension.
- [Getting started immediately](#getting-started-immediately) – Get work done in no time.

`create-browser-extension` helps you develop extensions with built-in support for esnext, module imports/exports, auto-reload, unit testing, and more. Read about the project vision and personal motivations [here](https://github.com/cezaraugusto/create-browser-extension/wiki/This-initiative).

## Creating an Extension

```sh
npx create-browser-extension my-extension-hello
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

### Zero-config extension kickstart with support for modules and page-reloads

```
npx create-browser-extension start my-existing-extension
```

## Next steps

Project roadmap TBD. These are the major areas I plan to cover (sorted)

- [x] `create` - Everything needed to create a new extension, Supports templates (alpha)
- [ ] `develop` - Everything needed to develop a new extension. (under development)
  - [x] `start` - Runs the extension on a browser with support for hot-reload, JS modules, and custom browser configs. (in progress)
    - [x] Chrome - Develop your extension running a standalone Chrome instance
    - [ ] Firefox - Develop your extension running a standalone Firefox instance
    - [ ] Edge (Chromium) - Develop your extension running a standalone Edge (Chromium) instance
    - [ ] Safari - Develop your extension running a standalone Safari instance
    - [ ] Brave - Develop your extension running a standalone Brave instance
    - [ ] Multiple TBD - Develop your extension running multiple browser instances
    - [ ] Other browsers TBD
  - [ ] `build` - Prepares the code with production defaults for the publish step.
  - [ ] `test` - Unit test extensions using Jest (TBD: e2e support)
  - [ ] `lint` - Lints the extension with defaults optimized for cross-browser webExtesions
  - [ ] `eject` - Detaches the current extension project as a standalone project. (similar to `create-react-app` eject option)
- [ ] `publish` - Everything needed to publish or update a new extension to all popular extension stores. (TBD)

## License

MIT (c) Cezar Augusto.
