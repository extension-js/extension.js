# Changelog

## Unreleased

- Drop ?url query bypass in CSS loaders, add end-to-end regression spec (0e529e9d)
- Pin @rspack/dev-server to ^1.2.1 until @rspack/core 2.x ships stable (64bbd22d)
- Default --install to off on extension create (ecef8841)
- Collapse CLI telemetry to 2 events with sampling, cap, and dedup (450206d4)
- Fix follow-redirects auth header leak vulnerability (GHSA-r4q5-vmmm-2653) (43fcde8b)
- Update --help and --ai-help with Docker, --host, and Flatpak Firefox docs (20641386)
- Add CDP pipe transport and CDP-first extension loading (d54c7902)
- Add --host flag and Docker/devcontainer support (6ff4c5c9)
- Harden --source across platforms and tighten commands/* orchestration (91ee1101)

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

