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
import {resolveDevelopInstallRoot} from '../plugin-css/css-lib/integrations'
import packageJson from '../../package.json'

function getPreflightCacheDir(packageRoot: string): string {
  return path.join(packageRoot, '.cache', 'extensionjs', 'preflight')
}

function getProjectKey(projectPath: string): string {
  return createHash('sha1').update(path.resolve(projectPath)).digest('hex')
}

function getCacheVersionPath(cacheDir: string): string {
  return path.join(cacheDir, 'version.json')
}

function getProjectDepsHash(projectPath: string): string {
  const lockfileSignature = getNearestLockfileSignature(projectPath)
  try {
    const packageJsonPath = path.join(projectPath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      return createHash('sha1')
        .update(
          JSON.stringify({
            packageJson: 'no-package-json',
            lockfile: lockfileSignature
          })
        )
        .digest('hex')
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
      devDependencies: normalize(devDeps),
      lockfile: lockfileSignature
    })

    return createHash('sha1').update(stable).digest('hex')
  } catch {
    return createHash('sha1')
      .update(
        JSON.stringify({
          packageJson: 'invalid-package-json',
          lockfile: lockfileSignature
        })
      )
      .digest('hex')
  }
}

function getNearestLockfileSignature(projectPath: string): string {
  const lockfileNames = [
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb'
  ]
  let current = path.resolve(projectPath)

  while (true) {
    for (const lockfileName of lockfileNames) {
      const lockfilePath = path.join(current, lockfileName)
      if (!fs.existsSync(lockfilePath)) continue

      try {
        const content = fs.readFileSync(lockfilePath)
        const digest = createHash('sha1').update(content).digest('hex')
        return `${lockfileName}:${digest}`
      } catch {
        return `${lockfileName}:unreadable`
      }
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return 'none'
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

export function getPreflightMarkerPath(
  projectPath: string
): string | undefined {
  const packageRoot = resolveDevelopInstallRoot()

  if (!packageRoot) return undefined

  const cacheDir = getPreflightCacheDir(packageRoot)

  return path.join(cacheDir, `${getProjectKey(projectPath)}.json`)
}

export function hasPreflightMarker(projectPath: string): boolean {
  const marker = getPreflightMarkerPath(projectPath)
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

export function writePreflightMarker(projectPath: string): void {
  const marker = getPreflightMarkerPath(projectPath)

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
