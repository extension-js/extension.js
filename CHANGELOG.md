# Changelog

## Unreleased

- Update preact.spec assertions to match package-directory preactPath (792b9895)
- Pass preact package directory to PreactRefreshPlugin (not entry file) (d891bc87)
- Add regression test for PreactRefreshPlugin preactPath option (5064a559)
- Pass project preact path to PreactRefreshPlugin for pnpm strict layouts (30d4e851)
- Add regression tests for module-context-resolve project-package fallback (28f31ad5)
- Raise content-script perf budget to 256 KiB for framework templates (3e10d6ce)
- Apply project-package fallback to module-context-resolve rules (a031e07e)
- Trust project package.json when pnpm symlinks hide the contract dep (68d8fe23)
- Suppress executionContextCreated burst on watched-session attach (7911dc82)
- Preserve sibling content_scripts entries during dev reinject (2447d185)
- Inline content-script CSS as data URLs to close the WAR gap on rspack 2.x (32323b25)
- Relocate reload-matrix harness to _FUTURE/examples per workspace convention (57c0d3a7)
- Add remote-mode and template-name fixture resolution to reload-matrix harness (51f7e557)
- Stop firing chrome.runtime.reload for page-only edits in non-content-script extensions (e01377fd)
- Extend reload-matrix harness with multi-scenario runner and 5-row matrix (f6f932d2)
- Scaffold reload-matrix CDP harness for ground-truth reload measurement (047f702a)
- Revert "Serialize and coalesce reload requests at the controller boundary" (4e48859c)
- Serialize and coalesce reload requests at the controller boundary (b49bbabe)

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

