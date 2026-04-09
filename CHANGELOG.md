# Changelog

## Unreleased

- Bump axios from 1.13.5 to 1.15.0 (f5d1e742)
- Remove build-dependencies.json and its entire sync/tracking infrastructure (38fa9db1)
- Extract programs/browser package, rename programs/extension back to programs/cli (3dfa4bc4)
- Update pnpm lockfile (c9b95eed)
- Resolve release notes range when stable tag is off current branch (d559f245)
- Add Linux CI Chromium sandbox flags for CDP dev tooling (85a36eff)
- Remove extensionStart from develop — CLI now orchestrates build + preview (f73947e7)
- Orchestrate start command with separate build + preview calls (b6201775)
- Add BuildEmitter event API to extension-develop (c607c946)
- Add lightweight preview entry to develop for fast extension preview (a1127d5a)
- Rename programs/cli to programs/extension (57457569)
- Optimize GitHub Actions workflows for faster CI (cdfebe72)

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

