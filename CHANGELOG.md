# Changelog

## Unreleased

## 3.1.1 (January 19, 2026)

- Added `--source`, `--watch-source`, and `--source-raw` for full HTML capture; URL validation now has clearer errors.
- Included Shadow DOM under `[data-extension-root="true"]` and warn when the host is missing.
- Added a mount-only wrapper for content scripts with HMR wiring; CSS updates trigger remount.
- Switched content script templates to `export default function initial()` and kept static CSS imports for HMR tracking.
- Improved Chromium/Firefox/Edge binary resolution, profile handling, and Windows path support.
- Supported the `extensions/` folder in config and stabilized config loading.
- Added a centralized logger with clearer CLI output; refreshed welcome page and theme.
- Improved PostCSS/SASS/LESS resolution and fixed web-accessible resources paths and manifest overrides.
- Improved preflight install and dependency auto-install for `create`.
- Improved start/preview process termination and reduced timeouts.
- Updated source inspection, telemetry, and release guidance docs.
- Expanded plugin test coverage, added e2e scaffolding, and refined workflows.
- Updated TypeScript and aligned React-related packages; applied security dependency updates.
