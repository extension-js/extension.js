// ███╗   ███╗███╗   ███╗███╗   ███╗███╗   ███╗███╗   ███╗███╗   ███╗███╗   ███╗
// ████╗ ████║████╗ ████║████╗ ████║████╗ ████║████╗ ████║████╗ ████║████╗ ████║
// ██╔████╔██║██╔████╔██║██╔████╔██║██╔████╔██║██╔████╔██║██╔████╔██║██╔████╔██║
// ██║╚██╔╝██║██║╚██╔╝██║██║╚██╔╝██║██║╚██╔╝██║██║╚██╔╝██║██║╚██╔╝██║██║╚██╔╝██║
// ██║ ╚═╝ ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║ ╚═╝ ██║
// ╚═╝     ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import semver from 'semver'
import {resolveExtensionDevelopRoot} from './extension-develop-runtime'

const RSPACK = '@rspack/core'

export interface RspackPeerConflict {
  name: string
  version: string
  range: string
}

interface PackageManifest {
  version?: unknown
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}

function readJson(filePath: string): PackageManifest | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
}

// The @rspack/core the engine builds with: the installed copy next to
// extension-develop when there is one, else the version its manifest pins.
export function engineRspackVersion(projectPath: string): string | undefined {
  let developRoot: string

  try {
    developRoot = resolveExtensionDevelopRoot(projectPath)
  } catch {
    return undefined
  }

  try {
    const req = createRequire(path.join(developRoot, 'package.json'))
    const installed = readJson(req.resolve(`${RSPACK}/package.json`))?.version

    if (typeof installed === 'string' && semver.valid(installed)) {
      return installed
    }
  } catch {
    // Fall through to the pinned version
  }

  const pinned = readJson(path.join(developRoot, 'package.json'))
    ?.dependencies?.[RSPACK]

  return (
    (typeof pinned === 'string' && semver.coerce(pinned)?.version) || undefined
  )
}

// Every direct dependency of the project whose @rspack/core peer range does
// not accept the engine's version. npm refuses to install next to one of
// these (ERESOLVE), which is the failure this check names.
export function findRspackPeerConflicts(
  projectPath: string,
  engineVersion: string
): RspackPeerConflict[] {
  const manifest = readJson(path.join(projectPath, 'package.json'))
  if (!manifest) return []

  const names = new Set<string>([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {})
  ])
  const req = createRequire(path.join(projectPath, 'package.json'))
  const conflicts: RspackPeerConflict[] = []

  for (const name of names) {
    if (name === RSPACK) continue

    let installed: PackageManifest | undefined

    try {
      installed = readJson(req.resolve(`${name}/package.json`))
    } catch {
      continue
    }

    const range = installed?.peerDependencies?.[RSPACK]
    if (typeof range !== 'string' || !range.trim()) continue
    if (!semver.validRange(range)) continue

    if (semver.satisfies(engineVersion, range, {includePrerelease: true})) {
      continue
    }

    conflicts.push({
      name,
      version: String(installed?.version || 'unknown'),
      range
    })
  }

  return conflicts
}

// Releases known to have widened their @rspack/core peer range.
const KNOWN_FIXES: Record<string, string> = {
  'css-loader': '7.1.4'
}

export function describeRspackPeerConflicts(
  conflicts: RspackPeerConflict[],
  engineVersion: string
): string {
  return conflicts
    .map(
      (conflict) =>
        `${conflict.name} ${conflict.version} accepts ${RSPACK} ${conflict.range}, the engine ships ${engineVersion}`
    )
    .join('. ')
}

export function remedyRspackPeerConflicts(
  conflicts: RspackPeerConflict[],
  engineVersion: string
): string {
  const major = semver.major(engineVersion)

  return conflicts
    .map((conflict) => {
      const fixed = KNOWN_FIXES[conflict.name]

      return fixed
        ? `Upgrade ${conflict.name} to ${fixed} or newer, its peer range accepts ${RSPACK} ${major}, then install again`
        : `Upgrade ${conflict.name} to a release whose ${RSPACK} peer range accepts ${major}.x, then install again`
    })
    .join('. ')
}
