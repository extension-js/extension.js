import fs from 'fs'
import path from 'path'
import {createRequire} from 'module'

const require = createRequire(import.meta.url)

function parseJsonSafe(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function resolveDevelopRootFromDir(dir: string): string | undefined {
  try {
    const packageJsonPath = path.join(dir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return undefined
    const pkg = parseJsonSafe(packageJsonPath)
    return pkg?.name === 'extension-develop' ? dir : undefined
  } catch {
    return undefined
  }
}

function resolveWorkspaceDevelopRoot(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir)

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(currentDir, 'programs', 'develop')
    const resolved = resolveDevelopRootFromDir(candidate)
    if (resolved) return resolved

    const parent = path.dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
  }

  return undefined
}

function resolveInstalledDevelopRoot(): string | undefined {
  try {
    const packageJsonPath = require.resolve('extension-develop/package.json')
    return resolveDevelopRootFromDir(path.dirname(packageJsonPath))
  } catch {
    try {
      const entryPath = require.resolve('extension-develop')
      return resolveDevelopRootFromDir(path.dirname(path.dirname(entryPath)))
    } catch {
      return undefined
    }
  }
}

function resolvePreferredDevelopRoot(startDir: string): {
  root: string | undefined
  source: 'workspace' | 'env' | 'installed' | 'missing'
} {
  const workspaceRoot = resolveWorkspaceDevelopRoot(startDir)
  if (workspaceRoot) return {root: workspaceRoot, source: 'workspace'}

  const envRoot = process.env.EXTENSION_DEVELOP_ROOT
    ? resolveDevelopRootFromDir(
        path.resolve(process.env.EXTENSION_DEVELOP_ROOT)
      )
    : undefined
  if (envRoot) return {root: envRoot, source: 'env'}

  const installedRoot = resolveInstalledDevelopRoot()
  if (installedRoot) return {root: installedRoot, source: 'installed'}

  return {root: undefined, source: 'missing'}
}

function resolveDevelopDistEntry(
  root: string,
  name: string = 'module'
): string | undefined {
  const base = path.join(root, 'dist', name)
  const candidates = [`${base}.cjs`, `${base}.js`, `${base}.mjs`, base]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

export function resolveExtensionDevelopRoot(
  startDir: string = __dirname
): string {
  const {root, source} = resolvePreferredDevelopRoot(startDir)
  if (!root) {
    throw new Error('Unable to locate the extension-develop runtime.')
  }

  process.env.EXTENSION_DEVELOP_ROOT = root

  if (source === 'workspace') {
    process.env.EXTENSION_CREATE_DEVELOP_ROOT = root
  }

  return root
}

export function resolveExtensionDevelopVersion(
  startDir: string = __dirname,
  fallbackVersion?: string
): string {
  try {
    const root = resolveExtensionDevelopRoot(startDir)
    const packageJsonPath = path.join(root, 'package.json')
    const pkg = parseJsonSafe(packageJsonPath)
    return pkg?.version || fallbackVersion || '0.0.0'
  } catch {
    return fallbackVersion || '0.0.0'
  }
}

export function loadExtensionDevelopModule<T = any>(
  startDir: string = __dirname
): T {
  const root = resolveExtensionDevelopRoot(startDir)
  const {source} = resolvePreferredDevelopRoot(startDir)
  const distEntry = resolveDevelopDistEntry(root)

  if (distEntry) {
    return require(distEntry) as T
  }

  if (source === 'workspace') {
    throw new Error(
      `Local extension-develop runtime is not built at ${path.join(root, 'dist')}. ` +
        'Run `pnpm --filter extension-develop compile` before invoking the local CLI.'
    )
  }

  return require('extension-develop') as T
}

/**
 * Load only the lightweight preview entry from extension-develop.
 * This avoids pulling in rspack and the full build toolchain, making
 * `extension preview` start significantly faster.
 */
export function loadExtensionDevelopPreviewModule<T = any>(
  startDir: string = __dirname
): T {
  const root = resolveExtensionDevelopRoot(startDir)
  const {source} = resolvePreferredDevelopRoot(startDir)
  const previewEntry = resolveDevelopDistEntry(root, 'preview')

  if (previewEntry) {
    return require(previewEntry) as T
  }

  // Fall back to the full module if the preview entry doesn't exist
  // (e.g. older extension-develop versions without the split entry).
  const fullEntry = resolveDevelopDistEntry(root)
  if (fullEntry) {
    return require(fullEntry) as T
  }

  if (source === 'workspace') {
    throw new Error(
      `Local extension-develop runtime is not built at ${path.join(root, 'dist')}. ` +
        'Run `pnpm --filter extension-develop compile` before invoking the local CLI.'
    )
  }

  return require('extension-develop/preview') as T
}
