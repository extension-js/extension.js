# Contributing 🧩

`Extension.js` is a monorepo consisting of multiple programs and packages.

- Programs: Each CLI command (including the CLI itself) is a program.
- Packages: Helper libraries and built-in webpack plugins.

## Monorepo Packages

| Package Name                                                                       | Description                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`browser-extension-manifest-fields`](/packages/browser-extension-manifest-fields) | Library to output manifest asset paths.                                        |
| [`common-errors-plugin`](/packages/common-errors-plugin)                           | Plugin to handle common compilation errors.                                    |
| [`eslint-config-extension-create`](/packages/eslint-config-extension-create)       | Preset of eslint rules for `Extension`.                                        |
| [`html-plugin`](/packages/html-plugin)                                             | Plugin to handle and compile HTML fields (and its assets) from the manifest.   |
| [`icons-plugin`](/packages/icons-plugin)                                           | Plugin to handle and compile icon fields from the manifest.                    |
| [`json-plugin`](/packages/json-plugin)                                             | Plugin to handle and compile JSON fields from the manifest.                    |
| [`locales-plugin`](/packages/locales-plugin)                                       | Plugin to handle and compile locales fields from the manifest.                 |
| [`manifest-compat-plugin`](/packages/manifest-compat-plugin)                       | Plugin to handle compatibility errors in the manifest.                         |
| [`manifest-plugin`](/packages/manifest-plugin)                                     | Plugin to handle and compile the manifest file.                                |
| [`resolve-plugin`](/packages/resolve-plugin)                                       | Plugin to resolve paths for Chrome or browser API namespaces.                  |
| [`resources-plugin`](/packages/resources-plugin)                                   | Plugin to handle and compile static across the extension features.             |
| [`run-chrome-extension`](/packages/run-chrome-extension)                           | Plugin to run the Chrome browser during development.                           |
| [`run-edge-extension`](/packages/run-edge-extension)                               | Plugin to run the Edge browser during development.                             |
| [`run-firefox-extension`](/packages/run-firefox-extension)                         | Plugin to run the Firefox browser during development.                          |
| [`scripts-plugin`](/packages/scripts-plugin)                                       | Plugin to handle and compile script fields from the manifest.                  |
| [`tsconfig`](/packages/tsconfig)                                                   | The shared tsconfig to handle the project TypeScript files during compilation. |

## Programs

`Extension` includes several command line programs, each serving a specific purpose in the extension development lifecycle:

| Program   | Description                                                                                  |
| --------- | -------------------------------------------------------------------------------------------- |
| `cli`     | The Command Line Interface that executes the Extension programs.                             |
| `create`  | Create extensions from built-in templates.                                                   |
| `develop` | Wrapper around the webpack config that consists of the `dev`, `start`, and `build` commands. |
| `publish` | This is empty for now.                                                                       |

## Installation

1. Clone the project `git@github.com:cezaraugusto/extension.git` && `cd extension`.
2. Install dependencies (will symlink files where appropriate) `yarn install`
3. Create an `.env` file at the project root and add `EXTENSION_ENV=development`

## Usage

To watch and apply changes to the project, you will need two or more terminals open:

### Terminal 1: Use it to watch file changes (yarn watch)

```sh
yarn watch
```

> **NOTE:** The browser runners (`run-chrome-extension` and `run-edge-extension`) are not
> watched by default, since they trigger the execution of the browser binary. To see changes
> applied to these packages, apply a `yarn compile` command either globally (at project root)
> or individually (running `yarn compile` at the package folder level).

### Terminal 2: Use it to actually execute the commands you want to test.

The CLI is available internally as an npm script `yarn extension <command> [argument]`.
Use it to experiment with the multiple Extension CLI commands.

```sh
yarn extension <command> [argument]
```

## Useful Commands

The monorepo's `package.json` includes scripts that affect all programs and packages at once
and are needed for the project development.

### Extension

This is the same command users run when they do `npx extension <command>

```sh
yarn extension <command> [args] [flags]
```

### Compile

Compiles (builds) packages and programns. This npm script generates the `/dist` folder that other packages may consume.

```sh
yarn compile
```

### Watch

Like compile, but listens for code changes, where it compiles again.

> Note: You want a terminal always running this command during development.

```sh
yarn watch
```

### Lint

Iterates over all projects and lint them using ESLint.

```sh
yarn lint
```

### Test

Run the test suite of each package and program (where available).

```sh
yarn test
```

### Clean

Deletes cache, dist/ and node_modules/ across packages and programs .

```sh
yarn clean
```
