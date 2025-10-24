# Changelog

## Unreleased

- feat(cli): add --source and --watch-source to print full page HTML after content scripts inject (Chrome/Firefox), and --source-raw to force raw-only output.
- feat(source-inspection): include Shadow DOM content under host [data-extension-root="true"]; warn if host is missing.
- feat(cli): validate --source/--starting-url as http(s) with clear error messages.
- docs: document source inspection flags and attribute host in CLI help and programs/develop/README.md; add piping example to root README.
- test: add URL validator tests, CLI source-flags tests, and print behavior tests.
- feat(feature-scripts): loader now injects a mount-only wrapper for declared content scripts. User code keeps Shadow DOM and CSS handling; HMR is auto-wired and CSS updates trigger remount.
- refactor(templates): remove template-side readyState/HMR logic; each template now `export default function initial()` and keeps static CSS imports for Rspack HMR tracking.
- docs(feature-scripts): update README to clarify mount-only wrapper contract and CSS HMR behavior.
- test: add unit tests for loader injection, CSS detection, and runtime lifecycle; add e2e scaffold for CSS HMR remount verification.
