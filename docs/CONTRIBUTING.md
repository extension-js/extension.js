# Contributing 🧩

Thanks for your interest in contributing! Extension.js’ goal is to make developing browser extensions fast and easy. This guide explains how to get a working dev setup, run tests, and send great PRs.

## Monorepo layout

Extension.js is a PNPM workspace. Public programs are published to npm; others are internal.

| Program            | Package name        | Description                                             |
| ------------------ | ------------------- | ------------------------------------------------------- |
| `programs/extension` | `extension`       | The CLI that runs `extension <command>`                 |
| `programs/develop` | `extension-develop` | `dev`/`build`/`preview` engines and Rspack integration |

Related workspaces:

- `extensions/*`, built-in extensions loaded by Extension.js

Templates used by `extension create` live in the external
[extension-js/examples](https://github.com/extension-js/examples) repo; CI hydrates
them into a local `templates/` directory via `scripts/hydrate-templates-from-examples.sh`.

### What is inside `templates/*/node_modules`

The hydrate script clones the examples repo, copies every example into `templates/`,
records the examples commit in `templates/.examples-commit`, and then runs
`pnpm install --ignore-workspace --prefer-offline` inside `templates/` and inside each
template folder. `templates/` is gitignored and excluded from the workspace, so each
template is a standalone package and its `node_modules` holds only what its own
`package.json` declares: the framework, its types and its build helpers. The CLI is not
installed there. A template is built with the workspace CLI, as in
`pnpm extension build templates/react`, or with a published `extension` package.

A folder named `.ignored_<package>` inside a template's `node_modules` is a package pnpm
found there that it did not install itself, usually left by an earlier install with a
different layout. pnpm moves such a folder aside instead of deleting it. Nothing resolves
through an `.ignored_*` folder, so it can be deleted, and a fresh
`pnpm install --ignore-workspace` in that template does not bring it back.

To build a template outside the repo, copy the whole template folder and keep two things
intact. Keep symlinks as symlinks (`cp -R` and `rsync -a` do, `cp -RL` does not), since
pnpm links packages into `node_modules/.pnpm` with relative paths. Keep every `dist`
folder under `node_modules`, since packages such as `vue` and `preact` ship their code
there. If the copy skips the template's own build output, skip only the top level `dist/`
of the template, never `node_modules/**/dist`. A copy that drops either one reports
"compiled with errors" for unresolved modules that have nothing to do with the change
under test.

## Prerequisites

- Node.js 22.12+ (CI runs on 22.x).
- PNPM 10.x (workspace uses `packageManager: pnpm@10.28.0`).
- macOS, Linux, or Windows.
- Optional for E2E: browsers used by Playwright (Chrome/Chromium is enough for most).
- Optional for the alternate runtime lanes: Deno 2.5+ (`pnpm smoke:deno`) and Bun 1.2+ (`pnpm smoke:bun`). The CLI runs on Node.js, Deno and Bun, and each one is judged on its own version.

## Setup

1. Fork and clone the repo

```sh
git clone https://github.com/extension-js/extension.js.git
cd extension.js
```

2. Install dependencies

```sh
pnpm install
```

3. Create a `.env` at the repo root to enable verbose dev logs and local behaviors

```dotenv
EXTENSION_DEBUG=1
```

## Day-to-day development

Use two terminals: one watching builds, another to run the CLI locally.

### Terminal 1, Watch builds

```sh
pnpm watch
```

### Terminal 2, Run local CLI (mirrors released `extension`)

```sh
pnpm extension <command> [args] [flags]
```

Examples:

```sh
# Run dev against a built-in extension
pnpm extension dev ./extensions/extension-js-devtools

# Create a brand-new extension from templates
pnpm extension create my-extension
cd my-extension && pnpm dev
```

## Useful scripts (root)

- `pnpm compile`, Build all workspaces (produces `dist/` used by the local CLI)
- `pnpm watch`, Build once then watch all programs for changes
- `pnpm extension`, Run the local CLI at `programs/extension/dist/cli.cjs`
- `pnpm test`, Run all tests across packages via Turbo
- `pnpm test:cli` | `pnpm test:dev` | `pnpm test:build`, Focused test groups
- `pnpm test:e2e`, Playwright end-to-end tests
- `pnpm lint`, Biome lint (config in `biome.json`)
- `pnpm format`, Biome format write

Tip: run a single package’s script with Turbo filters, e.g.:

```sh
pnpm -w turbo run test --filter=./programs/extension
```

Playwright note: if the first E2E run asks for browsers, install them via:

```sh
pnpm exec playwright install
```

## Coding guidelines

- TypeScript-first where applicable; otherwise modern ESNext.
- Biome (lint + format) is enforced. Run `pnpm lint` and `pnpm format` before pushing.
- Keep code small, composable, and dependency-light. Prefer standard APIs.
- Handle errors meaningfully; avoid silent catches.
- Security: minimize browser permissions; sanitize inputs; validate cross-process messages.

## Tests accompany changes

New functionality lands with a spec next to the unit it changes, and a bug fix lands with the regression spec that fails on the parent commit. A pull request without either is asked for one before review.

A spec that resolves an installed package must find it under both pnpm layouts. CI installs with the isolated linker, where a dependency of a workspace package lives under `node_modules/.pnpm/node_modules`, while a machine set to `node-linker=hoisted` sees it in the nearest `node_modules`. Resolve it with `workspacePackage()` from `programs/develop/__spec__/helpers/workspace-package.ts`, which walks both, and never gate a case on a bare `require.resolve` that only one layout answers, or the case skips on CI while it runs locally.

## Testing on Windows

The test suite runs on Windows in CI. To avoid regressions:

- **Paths:** Use cross-platform path assertions. In `programs/develop`, use helpers from `lib/__spec__/platform-utils.ts`: `normalizePathForAssert()` for string comparison, or `pathPattern(['seg', 'ments'])` for regex matches that accept both `/` and `\`.
- **Spawning (pnpm, npm, etc.):** Resolve the binary (e.g. from `process.execPath`’s directory or `node_modules/.bin`) and pass it to `spawnSync`/`spawn`; on Windows use `shell: true` when the command is a `.cmd`/`.bat` file so the child runs correctly.
- **Symlinks:** On Windows, creating symlinks often requires Developer Mode or admin. Prefer `fs.realpathSync()` + `fs.cpSync()` for test fixtures when copying from the pnpm store, or use copy-only paths on Windows.

Run `pnpm test` locally on Windows (or rely on the **Run test suite (Windows)** CI job) before submitting changes that touch tests or spawn logic.

## Debugging & troubleshooting

- Extra logs: pass `--debug`, or set `EXTENSION_DEBUG=1` in `.env`.
- Force-clean the repo:

```sh
git clean -xfd && pnpm install && pnpm compile
```

- Chrome/Edge/Firefox management logs print only in dev env.
- If the local CLI prints outdated code, ensure Terminal 1 is running `pnpm watch`.

## Communication

- Discussions and questions: join our Discord, https://discord.gg/v9h2RgeTSN

Thanks again for contributing! 🙌
