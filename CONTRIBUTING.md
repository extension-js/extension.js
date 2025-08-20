# Contributing 🧩

Thanks for your interest in contributing! Extension.js’ goal is to make developing browser extensions fast and easy. This guide explains how to get a working dev setup, run tests, and send great PRs.

## Monorepo layout

Extension.js is a PNPM workspace. Public programs are published to npm; others are internal.

| Program            | Package name        | Description                                             |
| ------------------ | ------------------- | ------------------------------------------------------- |
| `programs/cli`     | `extension`         | The CLI that runs `extension <command>`                 |
| `programs/create`  | `extension-create`  | Scaffolds new extensions (`extension create`)           |
| `programs/develop` | `extension-develop` | `dev`/`build`/`preview` engines and webpack integration |

Related workspaces:

- `examples/*` — runnable example extensions used in tests and docs
- `templates/*` — templates used by `extension create`

## Prerequisites

- Node.js 20.x (what CI runs). Node 18 is generally OK, but 20 is recommended.
- PNPM 9.x (workspace uses `packageManager: pnpm@9.9.0`).
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
EXTENSION_ENV=development
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
# Run dev against a local example
pnpm extension dev ./examples/new-react

# Create a brand-new extension from templates
pnpm extension create my-extension
cd my-extension && pnpm dev
```

## Useful scripts (root)

- `pnpm compile` — Build all workspaces (produces `dist/` used by the local CLI)
- `pnpm watch` — Build once then watch all programs for changes
- `pnpm test` — Run all tests across packages via Turbo
- `pnpm test:cli` | `pnpm test:dev` | `pnpm test:build` — Focused test groups
- `pnpm test:e2e` — Playwright end-to-end tests
- `pnpm lint` — ESLint (config in `eslint.config.mjs`)
- `pnpm format` — Prettier write
- `pnpm types` — Typecheck with TypeScript
- `pnpm clean` — Clear caches, `dist/`, and `node_modules/` across the repo

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

## Submitting changes

1. Create a feature branch from `main`.
2. Make your changes and add tests.
3. Run `pnpm test` and ensure lint/types pass.
4. Add a changeset (required for every PR):

```sh
pnpm changeset
```

Select affected packages and the bump type. Commit the generated file.

5. Push and open a PR. CI will run tests and verify the changeset is present.

Release workflow details are in `RELEASING.md` (Next channel on every merge to `main`; Stable via Changesets).

## Debugging & troubleshooting

- Extra logs: ensure `.env` contains `EXTENSION_ENV=development`.
- Force-clean the repo:

```sh
pnpm clean && pnpm install && pnpm compile
```

- Chrome/Edge/Firefox management logs print only in dev env.
- If the local CLI prints outdated code, ensure Terminal 1 is running `pnpm watch`.

## Communication

- Discussions and questions: join our Discord — https://discord.gg/v9h2RgeTSN

Thanks again for contributing! 🙌
