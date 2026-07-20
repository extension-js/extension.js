// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {ParsedJson} from './parse-json-safe'
import {canonicalizeDir, isResourceUnderDirs} from './resource-path'

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function tryReadJson(filePath: string): ParsedJson | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return undefined
  }
}

function findPackageRootFromEntry(
  entryPath: string,
  packageName: string
): string | undefined {
  let currentDir = path.dirname(entryPath)

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    const packageJson = tryReadJson(packageJsonPath)

    if (packageJson?.name === packageName) {
      return currentDir
    }

    const parentDir = path.dirname(currentDir)

    if (parentDir === currentDir) {
      return undefined
    }

    currentDir = parentDir
  }
}

function resolvePackageRoot(
  requireFromProject: NodeRequire,
  projectRoot: string,
  packageName: string
): string | undefined {
  try {
    return path.dirname(
      requireFromProject.resolve(`${packageName}/package.json`)
    )
  } catch {
    // Ignore
  }

  // Fallback for packages using restrictive exports maps.
  try {
    const entryPath = requireFromProject.resolve(packageName)
    const discovered = findPackageRootFromEntry(entryPath, packageName)
    if (discovered) return discovered
  } catch {
    // Ignore
  }

  const guessedPackageDir = path.join(
    projectRoot,
    'node_modules',
    ...packageName.split('/')
  )
  if (fs.existsSync(path.join(guessedPackageDir, 'package.json'))) {
    return guessedPackageDir
  }

  return undefined
}

function getWorkspaceDependencyNames(projectRoot: string): string[] {
  const packageJsonPath = path.join(projectRoot, 'package.json')

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const dependencySections = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.peerDependencies,
      packageJson.optionalDependencies
    ]
    const names = new Set<string>()

    for (const section of dependencySections) {
      if (!section || typeof section !== 'object') continue

      for (const [name, version] of Object.entries(section)) {
        if (typeof version !== 'string') continue
        if (
          version.startsWith('workspace:') ||
          version.startsWith('link:') ||
          version.startsWith('file:')
        ) {
          names.add(name)
        }
      }
    }

    return Array.from(names)
  } catch {
    return []
  }
}

// Keep both the symlinked package path and its real path so include/exclude
// checks work across npm/pnpm/yarn and different symlink modes.
export function resolveTranspilePackageDirs(
  projectRoot: string,
  transpilePackages?: string[]
): string[] {
  const autoWorkspacePackages = getWorkspaceDependencyNames(projectRoot)
  const packageNames = Array.from(
    new Set(
      [...autoWorkspacePackages, ...(transpilePackages || [])]
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  )

  if (packageNames.length === 0) {
    return []
  }

  const requireFromProject = createRequire(
    path.join(projectRoot, 'package.json')
  )

  const resolvedDirs = new Set<string>()

  for (const packageName of packageNames) {
    const packageDir = resolvePackageRoot(
      requireFromProject,
      projectRoot,
      packageName
    )
    if (!packageDir) {
      // Package might not be installed in the active project; ignore quietly.
      continue
    }

    resolvedDirs.add(normalizePath(packageDir))
    try {
      resolvedDirs.add(normalizePath(fs.realpathSync(packageDir)))
    } catch {
      // Ignore
    }
  }

  return Array.from(resolvedDirs)
}

// Containment check routed through the shared canonicalization helper so both
// sides normalize identically across platforms. See lib/resource-path.
export function isSubPath(
  resourcePath: string,
  directoryPath: string
): boolean {
  return isResourceUnderDirs(resourcePath, [canonicalizeDir(directoryPath)])
}
