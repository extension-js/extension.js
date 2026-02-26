# Changelog

## Unreleased

- Fix Windows path assertions in preview spec (1d5995e5)
- Fix extension-create not running through Node.js interface (47cca82f)
- Follow up on built-in extension overriding user NTP (16ec25bd)
- Add tests to prevent built-in extension not bundling (078cf500)
- chore(release): move changelog to v3.8.5 (4903d1d3)

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

