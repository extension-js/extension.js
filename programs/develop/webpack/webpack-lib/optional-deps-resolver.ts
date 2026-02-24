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
  return resolveFromInstallRootPackageDir(dependencyId, installRoot)
}

function getPackageDirFromInstallRoot(
  dependencyId: string,
  installRoot: string
): string {
  return path.join(installRoot, 'node_modules', ...dependencyId.split('/'))
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

  try {
    const packageJsonPath = path.join(packageDir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return undefined

    const raw = fs.readFileSync(packageJsonPath, 'utf8')
    const pkg = JSON.parse(raw || '{}')

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

    for (const relativeEntry of candidateEntries) {
      const absoluteEntry = path.resolve(packageDir, relativeEntry)
      if (fs.existsSync(absoluteEntry)) return absoluteEntry
    }
  } catch {
    return undefined
  }

  return undefined
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
