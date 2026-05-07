# Changelog

## Unreleased

- Ignore benign socket teardown errors in browser process handlers (Templates Nightly Edge ECONNRESET) (fda84038)
- Force-exit optional-deps smoke after main() so Linux orphans don't hang the CI step (16eb6708)
- Compile extension-develop before vitest so dist-shape spec has artifacts (d7cc6227)
- Scope ESM banner to Node-side bundles and add regression gates (c0dd71d6)
- Flip extension-develop to ESM output for @rspack/core@2 compatibility (fc952d97)
- Update WASM example link in README (6f7ab3dd)

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

