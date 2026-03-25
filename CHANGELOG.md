# Changelog

## Unreleased

- Added -b shortcut to browser option (#430) (3cf4a3da)
- Stabilize Windows pnpm smoke workspace paths (24f8c280)
- Stabilize Windows npm optional dependency preflight (9a5398df)
- Handle cross-drive Windows file specifiers in pnpm smoke (b6111ba9)
- Align pnpm optional-deps smoke with source-under-test (47e8a742)
- Generalize optional dependency contracts across webpack tooling (42662d82)
- Enforce transactional optional dependency installs (bedd8996)
- Setup internal standalone library for installing and resolving on-demand tooling (b0b75cf7)
- Setup internal standalone library for installing and resolving on-demand tooling (410a91f5)
- Stabilize CI platform-specific optional deps assertions (4efa77a7)
- Setup internal standalone library for installing and resolving on-demand tooling (ecc9110e)

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

