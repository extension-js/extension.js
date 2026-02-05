// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createHash} from 'crypto'
import packageJson from '../../package.json'
import {resolveDevelopInstallRoot} from '../plugin-css/css-lib/integrations'

function getInstallCacheDir(packageRoot: string): string {
  return path.join(packageRoot, '.cache', 'extensionjs', 'install')
}

function getProjectKey(projectPath: string): string {
  return createHash('sha1').update(path.resolve(projectPath)).digest('hex')
}

function getCacheVersionPath(cacheDir: string): string {
  return path.join(cacheDir, 'version.json')
}

function getProjectDepsHash(projectPath: string): string {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      return 'no-package-json'
    }
    const raw = fs.readFileSync(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    const deps = parsed?.dependencies || {}
    const devDeps = parsed?.devDependencies || {}

    const normalize = (input: Record<string, string>) => {
      const sortedKeys = Object.keys(input).sort()
      const normalized: Record<string, string> = {}

      for (const key of sortedKeys) {
        normalized[key] = input[key]
      }

      return normalized
    }

    const stable = JSON.stringify({
      dependencies: normalize(deps),
      devDependencies: normalize(devDeps)
    })

    return createHash('sha1').update(stable).digest('hex')
  } catch {
    return 'invalid-package-json'
  }
}

function ensureCacheVersion(cacheDir: string): boolean {
  const versionPath = getCacheVersionPath(cacheDir)
  const expectedVersion = packageJson.version
  try {
    if (!fs.existsSync(versionPath)) {
      return true
    }

    const raw = fs.readFileSync(versionPath, 'utf8')
    const data = JSON.parse(raw || '{}')

    if (data?.version !== expectedVersion) {
      fs.rmSync(cacheDir, {recursive: true, force: true})
      return false
    }

    return true
  } catch {
    try {
      fs.rmSync(cacheDir, {recursive: true, force: true})
    } catch {
      // ignore
    }
    return false
  }
}

function getInstallMarkerPath(projectPath: string): string | undefined {
  const packageRoot = resolveDevelopInstallRoot()
  if (!packageRoot) return undefined

  const cacheDir = getInstallCacheDir(packageRoot)
  return path.join(cacheDir, `${getProjectKey(projectPath)}.json`)
}

export function hasInstallMarker(projectPath: string): boolean {
  const marker = getInstallMarkerPath(projectPath)
  if (!marker) return false

  const cacheDir = path.dirname(marker)
  if (!ensureCacheVersion(cacheDir)) {
    return false
  }

  if (!fs.existsSync(marker)) return false

  try {
    const raw = fs.readFileSync(marker, 'utf8')
    const data = JSON.parse(raw || '{}')
    const depsHash = getProjectDepsHash(projectPath)

    if (data?.depsHash !== depsHash) {
      fs.rmSync(marker, {force: true})
      return false
    }

    return true
  } catch {
    try {
      fs.rmSync(marker, {force: true})
    } catch {
      // ignore
    }
    return false
  }
}

export function writeInstallMarker(projectPath: string): void {
  const marker = getInstallMarkerPath(projectPath)
  if (!marker) return

  const cacheDir = path.dirname(marker)
  try {
    fs.mkdirSync(cacheDir, {recursive: true})
    fs.writeFileSync(
      getCacheVersionPath(cacheDir),
      JSON.stringify({version: packageJson.version})
    )

    fs.writeFileSync(
      marker,
      JSON.stringify({
        projectPath: path.resolve(projectPath),
        depsHash: getProjectDepsHash(projectPath),
        version: packageJson.version,
        ts: Date.now()
      })
    )
  } catch {
    // Best-effort cache marker
  }
}
