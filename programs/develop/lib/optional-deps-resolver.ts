// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {codedError} from './coded-error'
import {resolveDevelopInstallRoot} from './develop-context'
import * as messages from './messages'
import {CODES, debugLine, humanLine, prefix} from './messaging'
import type {
  OptionalDependencyContract,
  OptionalDependencyVerificationRule
} from './optional-dependency-types'
import {getOptionalDependencyContract} from './optional-deps-contracts'
import type {PackageManagerName} from './package-manager'
import {resolvePackageManager} from './package-manager'
import {hasProjectDependency} from './project-manifest'

// Verbose-mode escape hatch shared with the rest of the develop pipeline;
// EXTENSION_VERBOSE=1 restores the full structured diagnostic payload.
// A best-effort step that fails keeps its fallback by design, and says so
// only under EXTENSION_VERBOSE=1 so a healthy run stays as quiet as today.
function debugSwallowed(step: string, error: unknown): void {
  if (!isVerboseMode()) return

  debugLine(
    `${prefix('debug')} optional-deps ${step}: ${String(
      (error as Error)?.message || error
    )}`
  )
}

function isVerboseMode(): boolean {
  return String(process.env.EXTENSION_VERBOSE || '').trim() === '1'
}

// pnpm, yarn and bun add a dev dependency with `add -D`; npm uses `install -D`.
// Detect from the user project's dir, never process.cwd() (the dev server's).
function installVerbForPackageManager(name: PackageManagerName): string {
  if (name === 'npm') return 'install -D'
  if (name === 'deno') return 'add --dev'

  return 'add -D'
}

// Exported so a best-effort step (the AMO lint) can print the same
// package-manager-aware hint without going through a throw.
export function formatInstallHint(
  projectPath: string,
  packageSpecs: string[]
): string {
  const {name} = resolvePackageManager({cwd: projectPath})
  const verb = installVerbForPackageManager(name)

  return `${name} ${verb} ${packageSpecs.join(' ')}`
}

// Single dual-mode formatter every throw site routes through: a one-line
// install hint by default, plus the structured diagnostics in verbose mode.
function formatResolverError(args: {
  integration: string
  dependencyId: string
  headline: string
  installSpecs: string[]
  projectPath: string
  diagnostics: Record<string, unknown>
  // A package that is there and broken is reinstalled, not installed.
  action?: 'Install' | 'Reinstall'
}): string {
  const hint = formatInstallHint(args.projectPath, args.installSpecs)
  const readableLine = `[${args.integration}] ${args.headline} ${args.action || 'Install'} it with: ${hint}`

  if (!isVerboseMode()) {
    return readableLine
  }

  return `${readableLine}\n${JSON.stringify(args.diagnostics, null, 2)}`
}

type ResolutionResult = {
  resolvedPath: string
  basePath: string
}

type EnsureResolveInput = {
  integration: string
  projectPath: string
  dependencyId: string
  installDependencies?: string[]
  verifyPackageIds?: string[]
  contract?: OptionalDependencyContract
}

// Optionally installed modules have caller-defined shapes; the default T is
// the loosest view so existing call sites keep their dynamic contract.
// biome-ignore lint/suspicious/noExplicitAny: dynamic module loading boundary, adapters narrow per call site
export type AnyModule = any

type EnsureLoadInput<T = AnyModule> = EnsureResolveInput & {
  moduleAdapter?: (loaded: AnyModule) => T
}

function toInstallRootContract(
  integration: string,
  contractId: string,
  installDependencies: string[],
  verifyPackageIds: string[]
): OptionalDependencyContract {
  return {
    id: contractId,
    integration,
    installPackages: installDependencies,
    verificationRules: verifyPackageIds.map((packageId) => ({
      type: 'install-root',
      packageId
    }))
  }
}

function getVerificationContract(
  input: EnsureResolveInput | EnsureLoadInput<AnyModule>
): OptionalDependencyContract {
  if (input.contract) return input.contract

  const installDependencies = input.installDependencies || [input.dependencyId]
  const verifyPackageIds = input.verifyPackageIds || installDependencies

  return toInstallRootContract(
    input.integration,
    input.integration,
    installDependencies,
    verifyPackageIds
  )
}

function getResolutionBases(projectPath: string): string[] {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  if (extensionRoot?.includes('.pnpm')) {
    bases.push(path.join(extensionRoot, '..', '..'))
  }

  return Array.from(new Set(bases))
}

function packageJsonPath(basePath: string): string {
  return path.join(basePath, 'package.json')
}

function tryResolveWithBase(
  dependencyId: string,
  basePath: string
): string | undefined {
  try {
    const req = createRequire(packageJsonPath(basePath))

    return req.resolve(dependencyId)
  } catch (error) {
    debugSwallowed(`resolve ${dependencyId} from ${basePath}`, error)

    return undefined
  }
}

function resolveDependency(
  dependencyId: string,
  projectPath: string
): ResolutionResult | undefined {
  const bases = getResolutionBases(projectPath)

  for (const basePath of bases) {
    const resolvedPath = tryResolveWithBase(dependencyId, basePath)

    if (resolvedPath) {
      return {resolvedPath, basePath}
    }
  }

  try {
    const resolvedPath = require.resolve(dependencyId, {paths: bases})

    return {resolvedPath, basePath: projectPath}
  } catch (error) {
    debugSwallowed(`resolve ${dependencyId} from the project bases`, error)

    return undefined
  }
}

function resolveFromKnownLocations(
  dependencyId: string,
  projectPath: string
): string | undefined {
  const direct = resolveDependency(dependencyId, projectPath)?.resolvedPath
  if (direct) return direct

  // Strict pnpm can hide peer-tooling behind symlinks Node cannot traverse
  // from here; if the user's package.json declares it, trust the install.
  if (declaresDependency(projectPath, dependencyId)) {
    return projectPath
  }

  return undefined
}

function declaresDependency(
  projectPath: string,
  dependencyId: string
): boolean {
  try {
    return hasProjectDependency(projectPath, dependencyId)
  } catch (error) {
    debugSwallowed(`read the project manifest for ${dependencyId}`, error)

    return false
  }
}

function dedupeFailures(packageIds: string[]) {
  return Array.from(new Set(packageIds))
}

function evaluateModuleContextRule(
  rule: Extract<
    OptionalDependencyVerificationRule,
    {type: 'module-context-resolve' | 'module-context-load'}
  >,
  fromPackagePath: string
): string | undefined {
  try {
    const req = createRequire(fromPackagePath)

    req.resolve(rule.packageId)

    if (rule.type === 'module-context-load') {
      req(rule.packageId)
    }

    return undefined
  } catch (error) {
    debugSwallowed(`verify ${rule.packageId}`, error)

    return rule.packageId
  }
}

export function getContractVerificationFailuresFromKnownLocations(
  contract: OptionalDependencyContract,
  projectPath: string
) {
  const resolvedByPackage = new Map<string, string | undefined>()

  const resolvePackage = (packageId: string) => {
    if (!resolvedByPackage.has(packageId)) {
      resolvedByPackage.set(
        packageId,
        resolveFromKnownLocations(packageId, projectPath)
      )
    }

    return resolvedByPackage.get(packageId)
  }

  const failures: string[] = []

  for (const rule of contract.verificationRules) {
    if (rule.type === 'install-root') {
      if (!resolvePackage(rule.packageId)) failures.push(rule.packageId)

      continue
    }

    const fromPackagePath = resolvePackage(rule.fromPackage)

    if (!fromPackagePath) {
      failures.push(rule.fromPackage)
      continue
    }

    const failure = evaluateModuleContextRule(rule, fromPackagePath)
    // Strict pnpm hides user-side frameworks from the contract tooling's dir;
    // the bundler aliases them at compile time, so trust project package.json.
    if (failure && declaresDependency(projectPath, failure)) continue
    if (failure) failures.push(failure)
  }

  return dedupeFailures(failures)
}

function buildDiagnostics(input: {
  contract?: OptionalDependencyContract
  integration: string
  dependencyId: string
  projectPath: string
  installDependencies: string[]
  verifyPackageIds: string[]
}) {
  const bases = getResolutionBases(input.projectPath)

  return {
    contractId: input.contract?.id || null,
    integration: input.integration,
    dependencyId: input.dependencyId,
    projectPath: input.projectPath,
    installDependencies: input.installDependencies,
    verifyPackageIds: input.verifyPackageIds,
    resolutionBases: bases
  }
}

export async function ensureOptionalPackageResolved(
  input: EnsureResolveInput
): Promise<string> {
  const contract = getVerificationContract(input)
  const missing = getContractVerificationFailuresFromKnownLocations(
    contract,
    input.projectPath
  )
  const resolved = resolveFromKnownLocations(
    input.dependencyId,
    input.projectPath
  )

  if (resolved && missing.length === 0) {
    return resolved
  }

  const diagnostics = buildDiagnostics({
    integration: input.integration,
    dependencyId: input.dependencyId,
    projectPath: input.projectPath,
    contract,
    installDependencies: contract.installPackages,
    verifyPackageIds: contract.installPackages
  })

  const headline =
    `${input.dependencyId} could not be resolved.` +
    (missing.length > 0
      ? ` Missing or invalid packages: ${missing.join(', ')}.`
      : '')

  throw codedError(
    CODES.E_OPTIONAL_DEP_UNRESOLVED,
    formatResolverError({
      integration: input.integration,
      dependencyId: input.dependencyId,
      headline,
      installSpecs: missing.length > 0 ? missing : contract.installPackages,
      projectPath: input.projectPath,
      diagnostics: {...diagnostics, missing}
    })
  )
}

export function resolveOptionalPackageWithoutInstall(
  input: EnsureResolveInput
) {
  const contract = getVerificationContract(input)
  const resolved = resolveFromKnownLocations(
    input.dependencyId,
    input.projectPath
  )

  const missingPeerDeps = getContractVerificationFailuresFromKnownLocations(
    contract,
    input.projectPath
  )

  if (resolved && missingPeerDeps.length === 0) {
    return resolved
  }

  const diagnostics = buildDiagnostics({
    integration: input.integration,
    dependencyId: input.dependencyId,
    projectPath: input.projectPath,
    contract,
    installDependencies: contract.installPackages,
    verifyPackageIds: contract.installPackages
  })

  throw codedError(
    CODES.E_OPTIONAL_DEP_UNRESOLVED,
    formatResolverError({
      integration: input.integration,
      dependencyId: input.dependencyId,
      headline: `${input.dependencyId} could not be resolved from the project or extension-develop.`,
      installSpecs:
        missingPeerDeps.length > 0 ? missingPeerDeps : contract.installPackages,
      projectPath: input.projectPath,
      diagnostics: {
        ...diagnostics,
        missingPeerDeps,
        expectation:
          'Run optional dependency preflight or reinstall extension-develop.'
      }
    })
  )
}

function firstLineOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return text.split('\n')[0].trim().replace(/\.$/, '')
}

type FailedCopy = {copy: string; error: unknown}

// The reason travels with the error as its cause, so a caller can say why
// the package is unusable without parsing the readable line.
function optionalLoadError(
  input: EnsureLoadInput<AnyModule>,
  resolvedPath: string,
  loadError: unknown,
  headline: string,
  action: 'Install' | 'Reinstall'
) {
  const installSpecs = input.installDependencies || [input.dependencyId]
  const diagnostics = {
    ...buildDiagnostics({
      integration: input.integration,
      dependencyId: input.dependencyId,
      projectPath: input.projectPath,
      installDependencies: installSpecs,
      verifyPackageIds: input.verifyPackageIds || installSpecs
    }),
    resolvedPath,
    loadError:
      loadError instanceof Error ? loadError.message : String(loadError)
  }

  return Object.assign(
    codedError(
      CODES.E_OPTIONAL_DEP_LOAD,
      formatResolverError({
        integration: input.integration,
        dependencyId: input.dependencyId,
        headline,
        installSpecs,
        projectPath: input.projectPath,
        diagnostics,
        action
      })
    ),
    {cause: loadError, resolvedPath}
  )
}

// An adapter that rejects the module knows the shape and not the file, so
// the copy it was handed is named on what it throws.
function adaptLoadedModule<T>(
  input: EnsureLoadInput<T>,
  loaded: AnyModule,
  copy: string
): T {
  if (!input.moduleAdapter) return loaded

  try {
    return input.moduleAdapter(loaded)
  } catch (error) {
    if (error && typeof error === 'object' && !('resolvedPath' in error)) {
      Object.assign(error, {resolvedPath: copy})
    }

    throw error
  }
}

const reportedFallbacks = new Set<string>()

// A stand-in copy is said once per process, since a broken copy fails the
// same way on every load of a session.
function reportFallbackCopy(
  dependencyId: string,
  failed: FailedCopy[],
  usedCopy: string
): void {
  const line = messages.optionalCopyFellBack(
    dependencyId,
    failed.map(({copy, error}) => ({copy, why: firstLineOf(error)})),
    usedCopy
  )

  if (reportedFallbacks.has(line)) return

  reportedFallbacks.add(line)
  humanLine(line)
}

function loadResolvedOptionalModule<T>(
  input: EnsureLoadInput<T>,
  resolvedPath: string
): T {
  // The copy the project resolves is the one the project asked for. When it
  // is broken that is the answer, and no other install stands in for it.
  const projectCopy = tryResolveWithBase(input.dependencyId, input.projectPath)

  if (projectCopy) {
    let loaded: AnyModule

    try {
      // Asked by name from the project, which is how the path was resolved.
      loaded = createRequire(packageJsonPath(input.projectPath))(
        input.dependencyId
      )
    } catch (error) {
      throw optionalLoadError(
        input,
        projectCopy,
        error,
        `${input.dependencyId} at ${projectCopy} could not be loaded: ${firstLineOf(error)}.`,
        'Reinstall'
      )
    }

    return adaptLoadedModule(input, loaded, projectCopy)
  }

  const requirers: NodeJS.Require[] = getResolutionBases(input.projectPath).map(
    (basePath) => createRequire(packageJsonPath(basePath))
  )

  if (typeof require === 'function') requirers.push(require)

  const failed: FailedCopy[] = []
  const tried = new Set<string>()
  let lastResolveError: unknown

  // Each distinct copy is loaded once, so one that throws runs its side
  // effects once and is named when another copy stands in for it.
  for (const req of requirers) {
    for (const candidateModuleId of [input.dependencyId, resolvedPath]) {
      let copy: string

      try {
        copy = req.resolve(candidateModuleId)
      } catch (error) {
        lastResolveError = error
        continue
      }

      if (tried.has(copy)) continue

      tried.add(copy)

      let loaded: AnyModule

      try {
        loaded = req(candidateModuleId)
      } catch (error) {
        failed.push({copy, error})
        continue
      }

      if (failed.length > 0) {
        reportFallbackCopy(input.dependencyId, failed, copy)
      }

      return adaptLoadedModule(input, loaded, copy)
    }
  }

  if (failed.length === 0) {
    throw optionalLoadError(
      input,
      resolvedPath,
      lastResolveError,
      `${input.dependencyId} could not be loaded after it resolved.`,
      'Install'
    )
  }

  const causes = failed
    .map(({copy, error}) => `${copy} (${firstLineOf(error)})`)
    .join(', ')

  throw optionalLoadError(
    input,
    failed[0].copy,
    failed[0].error,
    `${input.dependencyId} could not be loaded after it resolved: ${causes}.`,
    'Install'
  )
}

export async function ensureOptionalModuleLoaded<T = AnyModule>(
  input: EnsureLoadInput<T>
): Promise<T> {
  const resolvedPath = await ensureOptionalPackageResolved(input)

  return loadResolvedOptionalModule(input, resolvedPath)
}

export function loadOptionalModuleWithoutInstall<T = AnyModule>(
  input: EnsureLoadInput<T>
): T {
  const resolvedPath = resolveOptionalPackageWithoutInstall(input)

  return loadResolvedOptionalModule(input, resolvedPath)
}

export async function ensureOptionalContractPackageResolved(input: {
  contractId: string
  projectPath: string
  dependencyId: string
}) {
  const contract = getOptionalDependencyContract(input.contractId)

  return ensureOptionalPackageResolved({
    integration: contract.integration,
    projectPath: input.projectPath,
    dependencyId: input.dependencyId,
    contract
  })
}

export async function ensureOptionalContractModuleLoaded<T = AnyModule>(input: {
  contractId: string
  projectPath: string
  dependencyId: string
  moduleAdapter?: (loaded: AnyModule) => T
}): Promise<T> {
  const contract = getOptionalDependencyContract(input.contractId)

  return ensureOptionalModuleLoaded<T>({
    integration: contract.integration,
    projectPath: input.projectPath,
    dependencyId: input.dependencyId,
    contract,
    moduleAdapter: input.moduleAdapter
  })
}

export function resolveOptionalContractPackageWithoutInstall(input: {
  contractId: string
  projectPath: string
  dependencyId: string
}) {
  const contract = getOptionalDependencyContract(input.contractId)

  return resolveOptionalPackageWithoutInstall({
    integration: contract.integration,
    projectPath: input.projectPath,
    dependencyId: input.dependencyId,
    contract
  })
}

export function loadOptionalContractModuleWithoutInstall<T = AnyModule>(input: {
  contractId: string
  projectPath: string
  dependencyId: string
  moduleAdapter?: (loaded: AnyModule) => T
}): T {
  const contract = getOptionalDependencyContract(input.contractId)

  return loadOptionalModuleWithoutInstall<T>({
    integration: contract.integration,
    projectPath: input.projectPath,
    dependencyId: input.dependencyId,
    contract,
    moduleAdapter: input.moduleAdapter
  })
}
