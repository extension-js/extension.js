// Public API surface for optional dependency runtime.
// Internal architecture intentionally uses neutral names inspired by robust CLI
// runtimes, without mirroring third-party package internals 1:1.
export {
  installOptionalDependencies,
  installOptionalDependenciesBatch,
  type InstallOptionalDependenciesOptions
} from './installer-engine'

export {
  resolveDevelopInstallRoot,
  resolveOptionalInstallRoot,
  hasDependency
} from './runtime-context'
