import * as fs from 'fs'
import * as path from 'path'

function isPackageEntry(entry: fs.Dirent): boolean {
  return entry.isDirectory() || entry.isSymbolicLink()
}

function getDirectPackageDir(dependencyId: string, installRoot: string): string {
  return path.join(installRoot, 'node_modules', ...dependencyId.split('/'))
}

function listInstalledPackageDirs(nodeModulesDir: string): string[] {
  if (!fs.existsSync(nodeModulesDir)) return []

  try {
    const entries = fs.readdirSync(nodeModulesDir, {withFileTypes: true})
    const packageDirs: string[] = []

    for (const entry of entries) {
      if (!isPackageEntry(entry) || entry.name === '.bin') continue

      const entryPath = path.join(nodeModulesDir, entry.name)

      if (!entry.name.startsWith('@')) {
        packageDirs.push(entryPath)
        continue
      }

      const scopedEntries = fs.readdirSync(entryPath, {withFileTypes: true})
      for (const scopedEntry of scopedEntries) {
        if (!isPackageEntry(scopedEntry)) continue
        packageDirs.push(path.join(entryPath, scopedEntry.name))
      }
    }

    return packageDirs
  } catch {
    return []
  }
}

function findPackageDirInPnpmStore(
  dependencyId: string,
  installRoot: string
): string | undefined {
  const pnpmStoreDir = path.join(installRoot, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmStoreDir)) return undefined

  try {
    const storeEntries = fs.readdirSync(pnpmStoreDir, {withFileTypes: true})

    for (const entry of storeEntries) {
      if (!isPackageEntry(entry) || entry.name === 'node_modules') continue

      const candidatePackageJson = path.join(
        pnpmStoreDir,
        entry.name,
        'node_modules',
        ...dependencyId.split('/'),
        'package.json'
      )

      if (fs.existsSync(candidatePackageJson)) {
        return path.dirname(candidatePackageJson)
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function findNestedPackageDir(
  dependencyId: string,
  installRoot: string
): string | undefined {
  const directPackageJson = path.join(
    getDirectPackageDir(dependencyId, installRoot),
    'package.json'
  )
  if (fs.existsSync(directPackageJson)) {
    return path.dirname(directPackageJson)
  }

  const fromPnpmStore = findPackageDirInPnpmStore(dependencyId, installRoot)
  if (fromPnpmStore) return fromPnpmStore

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
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8') || '{}')
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

function resolveFromPackageDir(packageDir: string): string | undefined {
  if (!fs.existsSync(packageDir)) return undefined

  const pkg = readPackageJsonFromDir(packageDir)
  if (!pkg) return undefined

  for (const relativeEntry of getPackageEntryCandidates(pkg)) {
    const absoluteEntry = path.resolve(packageDir, relativeEntry)
    if (fs.existsSync(absoluteEntry)) return absoluteEntry
  }

  return undefined
}

export function resolvePackageFromInstallRoot(
  dependencyId: string,
  installRoot: string
): string | undefined {
  const packageDir = findNestedPackageDir(dependencyId, installRoot)
  if (!packageDir) return undefined

  return resolveFromPackageDir(packageDir)
}
