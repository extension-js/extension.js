# Contributing 🧩

First off, thanks a lot for taking time to read this part. Extension.js' core phiolosophy is to make it very easy to develop browser extensions, and that includes the program that makes it happen as well. Hope this guide makes it very easy for you to contribute ;)

Extension.js runs on top of webpack using custom plugins. The whole Extension.js program consists of three core modules.

| Program   | Description                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------- |
| `cli`     | The Command Line Interface that executes the Extension.js programs.                            |
| `create`  | Create extensions from built-in templates. This is what runs when `extension create` is fired. |
| `develop` | Wrapper around the webpack config that consists of the `dev`, `start`, and `build` commands.   |

## Installation

1. Clone the project `git@github.com:cezaraugusto/extension.git` && `cd extension`.
2. Install dependencies (will symlink files where appropriate) `yarn install`
3. Create an `.env` file at the project root and add `EXTENSION_ENV=development`

## Usage

To watch and apply changes to the project, you will need two or more terminals open:

### Terminal 1: Watch mode

Use it to watch file changes. Under the hood this runs the compiler (`yarn compile`) infinitely.

```sh
yarn watch
```

### Terminal 2: Mimick `extension` command behavior.

Now that you have the watcher running, running `yarn extension <command> [argument]` will emulate the production `extension <command> [argument]`. Use it to experiment with the multiple Extension.js CLI commands.

```sh
yarn extension <command> [argument]
```

That's all!

## Templates

Extension.js uses its own templates for testing. If you need to test a React extension behavior for example, running `yarn extension dev ./examples/new-react` will open the `new-react` template and use the defaults applied for a React configuration.

## Useful Commands

The monorepo's `package.json` includes scripts that affect all programs and packages at once
and are needed for the project development.

### `extension`

This is the same command users run when they do `npx extension <command>

```sh
yarn extension <command> [args] [flags]
```

### `compile`

Compiles (builds) packages and programns. This npm script generates the `/dist` folder that other packages may consume.

```sh
yarn compile
```

### `watch`

Like compile, but listens for code changes, where it compiles again.

> Note: You want a terminal always running this command during development.

```sh
yarn watch
```

### `lint`

Iterates over all projects and lint them using ESLint.

```sh
yarn lint
```

### `test`

Run the test suite of each package and program (where available).

```sh
yarn test
```

### `clean`

Deletes cache, `dist/` and `node_modules/` across packages and programs.

```sh
yarn clean
```
