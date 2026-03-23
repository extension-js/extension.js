# Changelog

## Unreleased

- Fix excludeBrowserFlags forwarding in dev config (e074a42b)
- Fix optional dependency installs across framework tooling (461e1b3d)
- Refactor optional dependency bootstrap into `optional-deps-lib` and remove legacy integration facade.
- Fix Discord release not working (3e85528b)

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

