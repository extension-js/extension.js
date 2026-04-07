# Changelog

## Unreleased

- Internal (CI): upgrade `pnpm/action-setup` to v5 so Actions use Node 24 and GitHub stops warning about Node 20 composite actions (not an extension or CLI behavior change).
- Fix Windows optional dependency installs and smoke coverage (0e1303f1)
- Fix content script CSS fallback restoration (002aa829)
- Offload browser discovery to location libs (7035b423)

## 3.8.2

- Harden optional dependency runtime resolution to reduce first-run failures.

## 3.8.1

- No user-facing changes beyond release packaging updates.

## 3.8.0

- Add support for canary releases.
- Add an experimental `install` command.
- Improve Windows test and runtime reliability across Chromium, Edge, and Firefox flows.
- Improve path handling and source output behavior for more consistent CLI runtime output.
- Stabilize remote zip/template handling and companion loading defaults.
- Improve extension developer feedback by making Extension ID output more reliable and less noisy.

