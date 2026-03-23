# optional-deps-lib

Internal standalone library for installing and resolving on-demand tooling
dependencies in an isolated cache root.

## Purpose

- Keep optional dependency lifecycle logic out of feature-specific modules.
- Guarantee installs happen outside user projects.
- Preserve first-run reliability across package managers and operating systems.

## Invariants

- Optional tooling installs only under `resolveOptionalInstallRoot()`.
- User project lockfiles must not be modified by optional dependency bootstrap.
- Install success is never trusted without follow-up resolution checks.
- Recovery may reset only the isolated optional-deps cache root.

## Internal architecture

- `runtime-context.ts`: install roots and dependency discovery
- `cache-state.ts`: isolated cache manifest + reset semantics
- `installer-engine.ts`: manager command orchestration + fallback logic
- `index.ts`: stable public surface

## Public API

- `resolveDevelopInstallRoot()`
- `resolveOptionalInstallRoot()`
- `installOptionalDependencies(integration, dependencies, options?)`
- `installOptionalDependenciesBatch(plans)`
- `hasDependency(projectPath, dependency)`

## Notes

- All consumers should import from `webpack/optional-deps-lib`.
