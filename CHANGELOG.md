# Changelog

## Unreleased

- Ignore programs/create/.npmrc so local npm tokens are never committed (c1cebcfd)
- Normalize Windows drive slashes after backslash replace (92c63ca4)
- Fix CI workflow script name and Windows path double-slash normalization (78c5dd50)
- Fix pre-existing test failures in dev-server and update-manifest specs (ea849f74)
- Replace in-tree optional-deps installer with isolated-deps package (50262075)
- Simplify reload internals before release (ca86cb59)
- Consolidate ci-scripts into scripts and remove dead scripts (817e5a78)
- Update changelog and companion extension adjustments (66fc7c30)
- Refactor browser plugins, CDP/RDP inspection, and dev server internals (fbbd6d83)
- Wrap extension messaging sendMessage in try-catch in chunk loader (bb325fe5)
- Fix Firefox content reload parity with Chromium (289cbf5d)
- Fix Chromium content reload: suppress manifest reason, reload extension after reinject, await controller (745bf6f2)
- Resolve hashed content script filenames in CDP controller for reinject (e4095523)
- Hash content script filenames in dev mode to bust browser cache on hard reload (666ef6e7)
- Add strip and remove dev server runtime from content script bundles (da8e5b78)
- Rewrite content script wrapper with reinject lifecycle and cleanup registry (b617e907)
- Add canonical content script naming contracts and entry helpers (e9addae1)

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

