# Changelog

## Unreleased

- Fix rebase regression for the --wait output banner (fd113486)
- Patch vulnerable immutable transitive dependency (889ce936)
- Improve --wait for `start` command (4c5fb927)
- Add banner to --wait output (77f68308)
- Add staging `monorepo` example as ignored (70e90fb1)
- Add --wait support for superior Playwright DX/AX (93f0ea55)
- chore(release): move changelog to v3.8.11 (f733add3)
- release(stable): v3.8.11 (bdc41d1e)
- Rename no-runner behavior to no-browser (7ecf73e2)
- Invalidate optional-deps preflight cache when lockfiles change (c1570a13)
- chore(release): move changelog to v3.8.10 (18bf71bb)
- release(stable): v3.8.10 (559a5b3d)
- Support monorepo root env fallback for extension config loading (8f188f47)
- No loading for first-time optional deps install (57882032)

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

