# Changelog

## Unreleased

- Improve browser launch, reload, and teardown reliability across Chromium and Firefox. (71df0578, b9167cb4, fb1f1011)
- Make `extension-create` and `extension-develop` programmatically accessible with injectable loggers, structured results, and a BuildEmitter event API. (b026cba2)

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

