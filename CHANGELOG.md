# Changelog

## Unreleased

- feat(cli): add `--source`, `--watch-source`, and `--source-raw` for full HTML capture; validate URLs with clearer errors.
- feat(source-inspection): include Shadow DOM under `[data-extension-root="true"]`; warn when the host is missing.
- feat(feature-scripts): mount-only wrapper for content scripts with HMR wiring; CSS updates trigger remount.
- refactor(templates): switch content scripts to `export default function initial()`; keep static CSS imports for HMR tracking.
- feat(browser runners): improve Chromium/Firefox/Edge binary resolution, profile handling, and Windows path support.
- feat(config): support `extensions/` folder with config; stabilize config loading.
- feat(devtools/logger): centralized logger and clearer CLI output; refreshed welcome page and theme.
- fix(build): improve PostCSS/SASS/LESS resolution; fix web-accessible resources paths and manifest overrides.
- fix(installer): preflight install script improvements and dependency auto-install for `create`.
- perf/stability: improve start/preview process termination and reduce timeouts.
- docs: update source inspection, telemetry, and release guidance.
- test/ci: expand plugin test coverage, add e2e scaffolding, and refine workflows.
- deps: update TypeScript and align React-related packages; security dependency updates.
