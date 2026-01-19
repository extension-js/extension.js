# Contributing 🧩

Thanks for your interest in contributing! Extension.js’ goal is to make developing browser extensions fast and easy. This guide explains how to get a working dev setup, run tests, and send great PRs.

## Monorepo layout

Extension.js is a PNPM workspace. Public programs are published to npm; others are internal.

| Program            | Package name        | Description                                             |
| ------------------ | ------------------- | ------------------------------------------------------- |
| `programs/cli`     | `extension`         | The CLI that runs `extension <command>`                 |
| `programs/develop` | `extension-develop` | `dev`/`build`/`preview` engines and webpack integration |

Related workspaces:

- `extensions/*` — built-in extensions loaded by Extension.js
- `templates/*` — templates used by `extension create`

## Prerequisites

- Node.js 18+ (Node 20 is recommended; CI typically runs on 20).
- PNPM 10.x (workspace uses `packageManager: pnpm@10.28.0`).
- macOS, Linux, or Windows.
- Optional for E2E: browsers used by Playwright (Chrome/Chromium is enough for most).

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
EXTENSION_AUTHOR_MODE=development
```

## Day-to-day development

Use two terminals: one watching builds, another to run the CLI locally.

### Terminal 1 — Watch builds

```sh
pnpm watch
```

### Terminal 2 — Run local CLI (mirrors released `extension`)

```sh
pnpm extension <command> [args] [flags]
```

Examples:

```sh
# Run dev against a built-in example
pnpm extension dev ./extensions/browser-extension

# Create a brand-new extension from templates
pnpm extension create my-extension
cd my-extension && pnpm dev
```

## Useful scripts (root)

- `pnpm compile` — Build all workspaces (produces `dist/` used by the local CLI)
- `pnpm watch` — Build once then watch all programs for changes
- `pnpm extension` — Run the local CLI at `programs/cli/dist/cli.js`
- `pnpm test` — Run all tests across packages via Turbo
- `pnpm test:cli` | `pnpm test:dev` | `pnpm test:build` — Focused test groups
- `pnpm test:e2e` — Playwright end-to-end tests
- `pnpm lint` — ESLint (config in `eslint.config.mjs`)
- `pnpm format` — Prettier write

Tip: run a single package’s script with Turbo filters, e.g.:

```sh
pnpm -w turbo run test --filter=./programs/cli
```

Playwright note: if the first E2E run asks for browsers, install them via:

```sh
pnpm exec playwright install
```

## Coding guidelines

- TypeScript-first where applicable; otherwise modern ESNext.
- ESLint 9 + Prettier 3 are enforced. Run `pnpm lint` and `pnpm format` before pushing.
- Keep code small, composable, and dependency-light. Prefer standard APIs.
- Handle errors meaningfully; avoid silent catches.
- Security: minimize browser permissions; sanitize inputs; validate cross-process messages.

## Debugging & troubleshooting

- Extra logs: ensure `.env` contains `EXTENSION_AUTHOR_MODE=development`.
- Force-clean the repo:

```sh
git clean -xfd && pnpm install && pnpm compile
```

- Chrome/Edge/Firefox management logs print only in dev env.
- If the local CLI prints outdated code, ensure Terminal 1 is running `pnpm watch`.

## Communication

- Discussions and questions: join our Discord — https://discord.gg/v9h2RgeTSN

Thanks again for contributing! 🙌
