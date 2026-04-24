# Changelog

## Unreleased

- Pin uuid >=14 to close Dependabot alert 143 (91fd4ef2)
- Restore the per-rebuild "compiled successfully" stdout line in browser-launch mode (f0d02b57)
- Cover fresh tabs and page reloads for content-script edits (efde4e52)
- Add content-script reload regression tests (9f4638a5)
- Fix content-script hot reload (63d49da1)
- Scope browser-root auto-attach to extension targets, silence debugger infobar (67296cfe)

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

