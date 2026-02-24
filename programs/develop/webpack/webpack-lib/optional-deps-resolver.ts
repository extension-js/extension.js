import * as fs from 'fs'
import * as path from 'path'
import {createRequire} from 'module'
import {
  installOptionalDependencies,
  resolveDevelopInstallRoot
} from '../plugin-css/css-lib/integrations'

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
}

type EnsureLoadInput<T = any> = EnsureResolveInput & {
  moduleAdapter?: (loaded: any) => T
}

const installSingleFlight = new Map<string, Promise<void>>()

function getResolutionBases(projectPath: string): string[] {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  // In pnpm dlx/npx, optional deps live in extension-develop's sibling node_modules
  // (e.g. .../.pnpm/extension-develop@x/node_modules/sass-loader). For
  // require.resolve(id, {paths}), Node looks for path/node_modules/id, so we add
  // the parent of that node_modules (the .pnpm store dir).
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
  projectPath: string,
  installRoot?: string
): string | undefined {
  const resolved = resolveDependency(dependencyId, projectPath)
  if (resolved) return resolved.resolvedPath

  if (!installRoot) return undefined

  // Try installRoot/node_modules first (npm/yarn, or pnpm add --dir)
  const fromRoot = resolveFromInstallRootPackageDir(dependencyId, installRoot)
  if (fromRoot) return fromRoot

  // In pnpm dlx, deps are in extension-develop's sibling node_modules
  // (.../.pnpm/extension-develop@x/node_modules/sass-loader). The parent of
  // that node_modules is the .pnpm store dir.
  if (installRoot.includes('.pnpm')) {
    return resolveFromInstallRootPackageDir(
      dependencyId,
      path.join(installRoot, '..', '..')
    )
  }
  return undefined
}

function getPackageDirFromInstallRoot(
  dependencyId: string,
  installRoot: string
): string {
  return path.join(installRoot, 'node_modules', ...dependencyId.split('/'))
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

function resolveFromInstallRootPackageDir(
  dependencyId: string,
  installRoot: string
): string | undefined {
  const packageDir = getPackageDirFromInstallRoot(dependencyId, installRoot)
  if (!fs.existsSync(packageDir)) return undefined

  // Direct absolute directory resolution handles pnpm-linked trees where
  // bare-specifier lookup can still fail despite package presence.
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

function verifyPackageInInstallRoot(
  packageId: string,
  installRoot: string
): boolean {
  const packageJson = path.join(
    getPackageDirFromInstallRoot(packageId, installRoot),
    'package.json'
  )

  return fs.existsSync(packageJson)
}

function buildDiagnostics(input: {
  integration: string
  dependencyId: string
  projectPath: string
  installRoot?: string
  installDependencies: string[]
  verifyPackageIds: string[]
}) {
  const bases = getResolutionBases(input.projectPath)
  const verifyState = input.verifyPackageIds.map((id) => ({
    dependency: id,
    existsAtInstallRoot: input.installRoot
      ? verifyPackageInInstallRoot(id, input.installRoot)
      : false
  }))

  return {
    integration: input.integration,
    dependencyId: input.dependencyId,
    projectPath: input.projectPath,
    installRoot: input.installRoot || null,
    installDependencies: input.installDependencies,
    verifyPackageIds: input.verifyPackageIds,
    resolutionBases: bases,
    verifyState
  }
}

async function runInstallAndVerify(input: {
  integration: string
  installDependencies: string[]
  verifyPackageIds: string[]
  projectPath: string
  dependencyId: string
  installRoot?: string
}): Promise<void> {
  const didInstall = await installOptionalDependencies(
    input.integration,
    input.installDependencies
  )

  if (!didInstall) {
    const diagnostics = buildDiagnostics({
      integration: input.integration,
      dependencyId: input.dependencyId,
      projectPath: input.projectPath,
      installRoot: input.installRoot,
      installDependencies: input.installDependencies,
      verifyPackageIds: input.verifyPackageIds
    })

    throw new Error(
      `[${input.integration}] Optional dependencies failed to install.\n` +
        JSON.stringify(diagnostics, null, 2)
    )
  }

  if (!input.installRoot) {
    const diagnostics = buildDiagnostics({
      integration: input.integration,
      dependencyId: input.dependencyId,
      projectPath: input.projectPath,
      installRoot: input.installRoot,
      installDependencies: input.installDependencies,
      verifyPackageIds: input.verifyPackageIds
    })

    throw new Error(
      `[${input.integration}] Optional dependency install root is unavailable.\n` +
        JSON.stringify(diagnostics, null, 2)
    )
  }

  const missingAfterInstall = input.verifyPackageIds.filter(
    (id) => !verifyPackageInInstallRoot(id, input.installRoot as string)
  )

  if (missingAfterInstall.length > 0) {
    const diagnostics = buildDiagnostics({
      integration: input.integration,
      dependencyId: input.dependencyId,
      projectPath: input.projectPath,
      installRoot: input.installRoot,
      installDependencies: input.installDependencies,
      verifyPackageIds: input.verifyPackageIds
    })

    throw new Error(
      `[${input.integration}] Optional dependency install reported success but packages are missing: ${missingAfterInstall.join(', ')}.\n` +
        JSON.stringify(diagnostics, null, 2)
    )
  }
}

async function ensureInstalledAndVerified(input: {
  integration: string
  installDependencies: string[]
  verifyPackageIds: string[]
  projectPath: string
  dependencyId: string
}): Promise<void> {
  const installRoot = resolveDevelopInstallRoot()
  const key = [
    installRoot || 'missing-install-root',
    ...input.installDependencies.slice().sort()
  ].join('::')

  const existing = installSingleFlight.get(key)

  if (existing) {
    await existing
    return
  }

  const installPromise = runInstallAndVerify({
    integration: input.integration,
    installDependencies: input.installDependencies,
    verifyPackageIds: input.verifyPackageIds,
    projectPath: input.projectPath,
    dependencyId: input.dependencyId,
    installRoot
  })

  installSingleFlight.set(key, installPromise)
  try {
    await installPromise
  } finally {
    installSingleFlight.delete(key)
  }
}

/**
 * Resolve an optional dependency (e.g. sass-loader, less-loader) from known
 * locations. Use after preflight has run. Throws if not found.
 */
export function resolveOptionalDependencySync(
  dependencyId: string,
  projectPath: string
): string {
  const installRoot = resolveDevelopInstallRoot()
  const resolved = resolveFromKnownLocations(
    dependencyId,
    projectPath,
    installRoot
  )
  if (resolved) return resolved
  const bases = getResolutionBases(projectPath)
  throw new Error(
    `[CSS] ${dependencyId} could not be resolved. Searched: ${bases.join(', ')}`
  )
}

export async function ensureOptionalPackageResolved(
  input: EnsureResolveInput
): Promise<string> {
  const installRoot = resolveDevelopInstallRoot()
  const resolvedBeforeInstall = resolveFromKnownLocations(
    input.dependencyId,
    input.projectPath,
    installRoot
  )
  if (resolvedBeforeInstall) return resolvedBeforeInstall

  const installDependencies = input.installDependencies || [input.dependencyId]
  const verifyPackageIds = input.verifyPackageIds || installDependencies

  await ensureInstalledAndVerified({
    integration: input.integration,
    installDependencies,
    verifyPackageIds,
    projectPath: input.projectPath,
    dependencyId: input.dependencyId
  })

  const resolvedAfterInstall = resolveFromKnownLocations(
    input.dependencyId,
    input.projectPath,
    installRoot
  )
  if (resolvedAfterInstall) return resolvedAfterInstall

  const diagnostics = buildDiagnostics({
    integration: input.integration,
    dependencyId: input.dependencyId,
    projectPath: input.projectPath,
    installRoot,
    installDependencies,
    verifyPackageIds
  })
  throw new Error(
    `[${input.integration}] ${input.dependencyId} could not be resolved after optional dependency installation.\n` +
      JSON.stringify(diagnostics, null, 2)
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
        // pnpm-linked layouts can fail bare-id loading even after successful
        // resolution; absolute-path loading preserves deterministic behavior.
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
        installRoot: resolveDevelopInstallRoot(),
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
