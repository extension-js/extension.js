# Changelog

## Unreleased

- Improve build output and warning summaries so extension size and performance issues are easier to understand. (5200ca7c, ce925123, e85570cb, 6db941cc, 826d42f0, c69c1ce4)
- Fix manifest emission, persistence, and reload flows to make development rebuilds more reliable. (0c1241c2, 1d9d4d7c, ea6f77d5, d0735c80, ec457943, 27172e54, aaecab3d)
- Improve content script development behavior, including bridge resolution and clearer default export warnings. (eb303538, 09209ab9)
- Improve Chromium and Windows stability across teardown and follow-up test scenarios. (2ac3b30f, 8fc857bb, 46fc5467)
- Stabilize optional dependency installation during build and nested workspace environment resolution. (69829142, 253bb420)
- Reduce noisy ecosystem warnings and refresh the lockfile security resolution. (40e410d0, 9ffc1d74)
- Generate curated stable release notes (7ecec801)

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

