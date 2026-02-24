# Optional Dependencies Runtime Contract

This document defines the non-negotiable runtime behavior for optional
dependency resolution and loading in `extension-develop`.

## Goal

Optional integrations (PostCSS/Sass/Less/React/Preact/Vue/Svelte/TypeScript)
must work deterministically on the first run across supported package managers
and operating systems.

## Contract

1. **First-run determinism**
   - If a dependency is not already resolvable, one call to optional install
     must be enough for resolve/load to succeed.
   - No second CLI run should be required as a workaround.

2. **No unnecessary installs**
   - If a dependency is already resolvable from project/runtime bases, install
     must not run.

3. **Install-root verification**
   - When install reports success, required package ids must exist in the
     develop install root before proceeding.

4. **Cross-layout resolution**
   - Resolution must support:
     - normal Node `require.resolve` from candidate bases
     - pnpm-linked layouts where package presence exists but bare-id resolution
       may fail
     - package entry discovery through `main`/`module`/`exports` fallbacks

5. **Cross-layout loading**
   - Module loading must attempt bare id first, then resolved absolute path
     loading when necessary.

6. **Single-flight installs**
   - Concurrent requests for the same install root/dependency set must dedupe
     to one install attempt.

7. **Retry behavior**
   - A failed install attempt must not poison subsequent calls. A later call can
     retry installation and succeed.

8. **Actionable failures**
   - Failures must include structured diagnostics containing:
     - integration + dependency id
     - project path
     - install root
     - resolution bases
     - verification state for expected package ids

## Regression Enforcement

The following tests are required guardrails:

- `programs/develop/webpack/webpack-lib/__spec__/optional-deps-resolver.spec.ts`
  - resolves when already installed
  - dedupes concurrent installs
  - resolves from install-root package exports
  - first successful install does not require a second run
  - failed install can be retried successfully
  - install-success-but-missing-package fails with diagnostics
  - module loading works with adapter after deterministic resolve

- `ci-scripts/run-optional-deps-smoke.mjs` matrix workflow coverage for
  `pnpm`, `npm`, `yarn`, and `bun` on CI-targeted OS combinations.

If behavior changes, update this contract and tests in the same change.
