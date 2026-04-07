# Pre-existing test failures (2026-04-07)

Discovered during the content-script reload persistence work. None were
caused by the reload changes — all existed before. **All resolved.**

---

## 1. ~~CLI test suites: missing vitest globals~~ (RESOLVED)

All CLI tests pass (16 files, 74 tests). The vitest config at
`programs/cli/vitest.config.ts` already has `globals: true` and the
tests pick it up correctly.

## 2. ~~Dev-server config: `hot` expectation mismatch~~ (RESOLVED)

The test expected `hot: false` but production code intentionally sets
`hot: true` so Rspack injects `module.hot` (content scripts get HMR
stripped separately by `StripContentScriptDevServerRuntime`). Updated
the test to match the intentional behavior.

## 3. ~~PostCSS integration: tailwindcss path not found~~ (RESOLVED)

The test passes. The tailwindcss path resolution works correctly in
the current workspace layout.

## 4. ~~UpdateManifest: compilation.options undefined~~ (RESOLVED)

The test mock for `compilation` was missing `options` and `getAssets`.
Added `options: {mode}` and `getAssets()` to the mock to match what
`patchDevContentScriptManifestPaths` reads at runtime.
