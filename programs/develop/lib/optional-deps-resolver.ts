import * as fs from 'fs'
import * as path from 'path'
import {createRequire} from 'module'
import {resolveDevelopInstallRoot} from './develop-context'
import {getOptionalDependencyContract} from './optional-deps-contracts'
import type {
  OptionalDependencyContract,
  OptionalDependencyVerificationRule
} from './optional-dependency-types'

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

type EnsureLoadInput<T = any> = EnsureResolveInput & {
  moduleAdapter?: (loaded: any) => T
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
  input: EnsureResolveInput | EnsureLoadInput<any>
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

  if (extensionRoot && extensionRoot.includes('.pnpm')) {
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
  } catch {
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
  } catch {
    return undefined
  }
}

function resolveFromKnownLocations(
  dependencyId: string,
  projectPath: string
): string | undefined {
  return resolveDependency(dependencyId, projectPath)?.resolvedPath
}

function getPackageDirFromInstallRoot(
  dependencyId: string,
  installRoot: string
): string {
  return path.join(installRoot, 'node_modules', ...dependencyId.split('/'))
}

function listInstalledPackageDirs(nodeModulesDir: string): string[] {
  if (!fs.existsSync(nodeModulesDir)) return []

  try {
    const entries = fs.readdirSync(nodeModulesDir, {withFileTypes: true})
    const packageDirs: string[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.bin') continue

      const entryPath = path.join(nodeModulesDir, entry.name)

      if (!entry.name.startsWith('@')) {
        packageDirs.push(entryPath)
        continue
      }

      const scopedEntries = fs.readdirSync(entryPath, {withFileTypes: true})
      for (const scopedEntry of scopedEntries) {
        if (!scopedEntry.isDirectory()) continue
        packageDirs.push(path.join(entryPath, scopedEntry.name))
      }
    }

    return packageDirs
  } catch {
    return []
  }
}

function findNestedPackageDir(
  dependencyId: string,
  installRoot: string
): string | undefined {
  const targetPackageJson = path.join(
    installRoot,
    'node_modules',
    ...dependencyId.split('/'),
    'package.json'
  )
  if (fs.existsSync(targetPackageJson)) {
    return path.dirname(targetPackageJson)
  }

  const visited = new Set<string>()
  const queue: Array<{nodeModulesDir: string; depth: number}> = [
    {
      nodeModulesDir: path.join(installRoot, 'node_modules'),
      depth: 0
    }
  ]
  const maxDepth = 4

  while (queue.length > 0) {
    const current = queue.shift() as {nodeModulesDir: string; depth: number}
    if (visited.has(current.nodeModulesDir)) continue
    visited.add(current.nodeModulesDir)

    const candidatePackageJson = path.join(
      current.nodeModulesDir,
      ...dependencyId.split('/'),
      'package.json'
    )

    if (fs.existsSync(candidatePackageJson)) {
      return path.dirname(candidatePackageJson)
    }

    if (current.depth >= maxDepth) continue

    for (const packageDir of listInstalledPackageDirs(current.nodeModulesDir)) {
      const nestedNodeModulesDir = path.join(packageDir, 'node_modules')
      if (fs.existsSync(nestedNodeModulesDir)) {
        queue.push({
          nodeModulesDir: nestedNodeModulesDir,
          depth: current.depth + 1
        })
      }
    }
  }

  return undefined
}

function readPackageJsonFromDir(packageDir: string): any | undefined {
  const manifestPath = path.join(packageDir, 'package.json')
  if (!fs.existsSync(manifestPath)) return undefined

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    return JSON.parse(raw || '{}')
  } catch {
    return undefined
  }
}

function getPackageEntryCandidates(pkg: any): string[] {
  const candidateEntries: string[] = []

  if (typeof pkg?.main === 'string') candidateEntries.push(pkg.main)
  if (typeof pkg?.module === 'string') candidateEntries.push(pkg.module)
  if (typeof pkg?.exports === 'string') candidateEntries.push(pkg.exports)

  const dotExport = pkg?.exports?.['.']
  if (typeof dotExport === 'string') candidateEntries.push(dotExport)

  if (dotExport && typeof dotExport === 'object') {
    if (typeof dotExport.require === 'string')
      candidateEntries.push(dotExport.require)
    if (typeof dotExport.default === 'string')
      candidateEntries.push(dotExport.default)
    if (typeof dotExport.import === 'string')
      candidateEntries.push(dotExport.import)
  }

  candidateEntries.push('index.js', 'index.cjs', 'index.mjs')
  return candidateEntries
}

function resolveFirstExistingEntry(
  packageDir: string,
  candidateEntries: string[]
): string | undefined {
  for (const relativeEntry of candidateEntries) {
    const absoluteEntry = path.resolve(packageDir, relativeEntry)
    if (fs.existsSync(absoluteEntry)) return absoluteEntry
  }
  return undefined
}

function resolveFromPackageDir(packageDir: string): string | undefined {
  if (!fs.existsSync(packageDir)) return undefined

  try {
    return require.resolve(packageDir)
  } catch {
    // fall through to package.json guided fallback
  }

  const pkg = readPackageJsonFromDir(packageDir)
  if (!pkg) return undefined

  const candidateEntries = getPackageEntryCandidates(pkg)
  return resolveFirstExistingEntry(packageDir, candidateEntries)
}

function resolveFromInstallRootPackageDir(
  dependencyId: string,
  installRoot: string
): string | undefined {
  const directDir = getPackageDirFromInstallRoot(dependencyId, installRoot)
  const fromDirect = resolveFromPackageDir(directDir)
  if (fromDirect) return fromDirect
  const nested = findNestedPackageDir(dependencyId, installRoot)
  return nested ? resolveFromPackageDir(nested) : undefined
}

function dedupeFailures(packageIds: string[]) {
  return Array.from(new Set(packageIds))
}

function resolveRealPathSafe(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

function findOwningPackageDir(resolvedPath: string): string | undefined {
  let currentPath = path.dirname(resolvedPath)

  for (let depth = 0; depth < 8; depth++) {
    const packageJson = path.join(currentPath, 'package.json')
    if (fs.existsSync(packageJson)) return currentPath

    const parent = path.dirname(currentPath)
    if (parent === currentPath) break
    currentPath = parent
  }

  return undefined
}

function isSameInstalledPackage(
  resolvedPath: string,
  expectedInstalledPath: string
): boolean {
  const resolvedPackageDir = findOwningPackageDir(resolvedPath)
  const expectedPackageDir = findOwningPackageDir(expectedInstalledPath)

  if (resolvedPackageDir && expectedPackageDir) {
    return (
      resolveRealPathSafe(resolvedPackageDir) ===
      resolveRealPathSafe(expectedPackageDir)
    )
  }

  return (
    resolveRealPathSafe(resolvedPath) ===
    resolveRealPathSafe(expectedInstalledPath)
  )
}

function evaluateModuleContextRule(
  rule: Extract<
    OptionalDependencyVerificationRule,
    {type: 'module-context-resolve' | 'module-context-load'}
  >,
  fromPackagePath: string,
  options?: {expectedInstalledPath?: string}
): string | undefined {
  try {
    const req = createRequire(fromPackagePath)
    const resolvedPeer = req.resolve(rule.packageId)
    if (
      options?.expectedInstalledPath &&
      !isSameInstalledPackage(resolvedPeer, options.expectedInstalledPath)
    ) {
      return rule.packageId
    }
    if (rule.type === 'module-context-load') {
      req(rule.packageId)
    }
    return undefined
  } catch {
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
    if (failure) failures.push(failure)
  }

  return dedupeFailures(failures)
}

export function getContractVerificationFailuresAtInstallRoot(
  contract: OptionalDependencyContract,
  installRoot: string
) {
  const resolvedByPackage = new Map<string, string | undefined>()
  const resolvePackage = (packageId: string) => {
    if (!resolvedByPackage.has(packageId)) {
      resolvedByPackage.set(
        packageId,
        resolveFromInstallRootPackageDir(packageId, installRoot)
      )
    }
    return resolvedByPackage.get(packageId)
  }

  const failures: string[] = []

  for (const rule of contract.verificationRules) {
    if (rule.type === 'install-root') {
      const resolvedPath = resolvePackage(rule.packageId)
      if (!resolvedPath) failures.push(rule.packageId)
      continue
    }

    const fromPackagePath = resolvePackage(rule.fromPackage)
    if (!fromPackagePath) {
      failures.push(rule.fromPackage)
      continue
    }

    const expectedPeerPath = resolvePackage(rule.packageId)
    if (!expectedPeerPath) {
      failures.push(rule.packageId)
      continue
    }

    const failure = evaluateModuleContextRule(rule, fromPackagePath, {
      expectedInstalledPath: expectedPeerPath
    })
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

/**
 * Resolve a toolchain package from the extension project or extension-develop.
 * Use after preflight has verified contracts.
 */
export function resolveOptionalDependencySync(
  dependencyId: string,
  projectPath: string
): string {
  const resolved = resolveFromKnownLocations(dependencyId, projectPath)
  if (resolved) return resolved
  const bases = getResolutionBases(projectPath)
  throw new Error(
    `[CSS] ${dependencyId} could not be resolved. Searched: ${bases.join(', ')}`
  )
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

  throw new Error(
    `[${input.integration}] ${input.dependencyId} could not be resolved.` +
      (missing.length > 0
        ? ` Missing or invalid packages: ${missing.join(', ')}.`
        : '') +
      '\n' +
      JSON.stringify({...diagnostics, missing}, null, 2)
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

  throw new Error(
    `[${input.integration}] ${input.dependencyId} could not be resolved from the project or extension-develop.\n` +
      JSON.stringify(
        {
          ...diagnostics,
          missingPeerDeps,
          expectation:
            'Run optional dependency preflight or reinstall extension-develop.'
        },
        null,
        2
      )
  )
}

export async function ensureOptionalModuleLoaded<T = any>(
  input: EnsureLoadInput<T>
): Promise<T> {
  const resolvedPath = await ensureOptionalPackageResolved(input)
  const candidateBases = getResolutionBases(input.projectPath)
  let loaded: any
  let didLoad = false
  let lastLoadError: unknown

  for (const basePath of candidateBases) {
    const req = createRequire(packageJsonPath(basePath))
    const candidateModuleIds = [input.dependencyId, resolvedPath]
    for (const candidateModuleId of candidateModuleIds) {
      try {
        loaded = req(candidateModuleId)
        didLoad = true
        break
      } catch (error) {
        lastLoadError = error
      }
    }
    if (didLoad) break
  }

  if (!didLoad) {
    try {
      loaded = require(resolvedPath)
      didLoad = true
    } catch (directRequireError) {
      lastLoadError = directRequireError
    }
  }

  if (!didLoad) {
    const diagnostics = {
      ...buildDiagnostics({
        integration: input.integration,
        dependencyId: input.dependencyId,
        projectPath: input.projectPath,
        installDependencies: input.installDependencies || [input.dependencyId],
        verifyPackageIds: input.verifyPackageIds ||
          input.installDependencies || [input.dependencyId]
      }),
      resolvedPath,
      loadError:
        lastLoadError instanceof Error
          ? lastLoadError.message
          : String(lastLoadError)
    }

    throw new Error(
      `[${input.integration}] ${input.dependencyId} could not be loaded after it resolved.\n` +
        JSON.stringify(diagnostics, null, 2)
    )
  }

  return input.moduleAdapter ? input.moduleAdapter(loaded) : loaded
}

export function loadOptionalModuleWithoutInstall<T = any>(
  input: EnsureLoadInput<T>
): T {
  const resolvedPath = resolveOptionalPackageWithoutInstall(input)
  const candidateBases = getResolutionBases(input.projectPath)

  let loaded: any
  let didLoad = false
  let lastLoadError: unknown

  for (const basePath of candidateBases) {
    const req = createRequire(packageJsonPath(basePath))
    const candidateModuleIds = [input.dependencyId, resolvedPath]

    for (const candidateModuleId of candidateModuleIds) {
      try {
        loaded = req(candidateModuleId)
        didLoad = true
        break
      } catch (error) {
        lastLoadError = error
      }
    }

    if (didLoad) break
  }

  if (!didLoad) {
    try {
      loaded = require(resolvedPath)
      didLoad = true
    } catch (directRequireError) {
      lastLoadError = directRequireError
    }
  }

  if (!didLoad) {
    throw new Error(
      `[${input.integration}] ${input.dependencyId} could not be loaded after resolving.\n` +
        JSON.stringify(
          {
            resolvedPath,
            loadError:
              lastLoadError instanceof Error
                ? lastLoadError.message
                : String(lastLoadError)
          },
          null,
          2
        )
    )
  }

  return input.moduleAdapter ? input.moduleAdapter(loaded) : loaded
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

export async function ensureOptionalContractModuleLoaded<T = any>(input: {
  contractId: string
  projectPath: string
  dependencyId: string
  moduleAdapter?: (loaded: any) => T
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

export function loadOptionalContractModuleWithoutInstall<T = any>(input: {
  contractId: string
  projectPath: string
  dependencyId: string
  moduleAdapter?: (loaded: any) => T
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
