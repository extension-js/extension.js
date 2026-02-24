# Changelog

## Unreleased

- Further simplify install-root entrypoint resolution helpers (219f4297)
- Simplify optional dependency resolver control flow (5e4461be)
- Codify optional-deps runtime contract and lock regressions (c858f403)
- Use registry-mode extension for Windows pnpm smoke lane (adb9f11c)
- Fix Windows file specifiers for local package overrides in smoke matrix (74709f57)
- Fix Windows process spawning in optional-deps smoke runner (d9c9a5eb)
- Fix optional-deps matrix portability across Windows, Yarn, and Bun (f52b5f70)
- Fix optional-deps smoke matrix when browser-extension fixture is absent (ed556207)
- Add automated optional-dependency smoke coverage across package managers (487b765f)
- Fix optional module loading fallback in pnpm CI layouts (678b6c13)
- Fix optional dependency resolution in pnpm canary CI (8c9854cf)
- Harden optional dependency runtime resolution deterministically (f7b796f1)
- chore(release): move changelog to v3.8.2 (b3dd6d98)

