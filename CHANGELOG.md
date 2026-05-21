# Changelog

## Unreleased

- Write dev manifest.json in afterEmit and switch content-script hashing to contenthash (f4c6eec9)
- Write dev manifest.json in afterEmit and switch content-script hashing to contenthash (9d6d67b9)
- Bump svelte to 5.55.9 to clear Dependabot XSS advisories (4ee9a2bc)

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

