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

// An installed copy names the peer range it declares. A copy that is not
// installed can still be a conflict when the range package.json declares for
// it cannot reach the release known to accept the engine.
export type RspackPeerConflict =
  | {name: string; version: string; range: string}
  | {name: string; declared: string; fixedIn: string}

export interface RspackPeerScan {
  conflicts: RspackPeerConflict[]
  unreadable: string[]
}

// Releases measured to have widened their @rspack/core peer range, with the
// range that release declares.
const KNOWN_FIXES: Record<string, {version: string; accepts: string}> = {
  'css-loader': {version: '7.1.4', accepts: '0.x || ^1.0.0 || ^2.0.0-0'}
}

function knownFixFor(name: string, engineVersion: string) {
  const fix = KNOWN_FIXES[name]

  return fix &&
    semver.satisfies(engineVersion, fix.accepts, {includePrerelease: true})
    ? fix
    : undefined
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

// The resolver honors a package's exports map, which may hide package.json,
// so the direct path under node_modules is the second attempt.
function readInstalledManifest(
  req: NodeJS.Require,
  projectPath: string,
  name: string
): PackageManifest | undefined {
  try {
    return readJson(req.resolve(`${name}/package.json`))
  } catch {
    // Ignore
  }

  return readJson(
    path.join(projectPath, 'node_modules', ...name.split('/'), 'package.json')
  )
}

// Every direct dependency of the project whose @rspack/core peer range does
// not accept the engine's version. npm refuses to install next to one of
// these (ERESOLVE), which is the failure this check names, so a dependency
// that cannot be read is reported rather than cleared.
export function scanRspackPeers(
  projectPath: string,
  engineVersion: string
): RspackPeerScan {
  const manifest = readJson(path.join(projectPath, 'package.json'))
  if (!manifest) return {conflicts: [], unreadable: []}

  const declaredRanges: Record<string, unknown> = {
    ...manifest.dependencies,
    ...manifest.devDependencies
  }
  const req = createRequire(path.join(projectPath, 'package.json'))
  const conflicts: RspackPeerConflict[] = []
  const unreadable: string[] = []

  for (const name of Object.keys(declaredRanges)) {
    if (name === RSPACK) continue

    const installed = readInstalledManifest(req, projectPath, name)

    if (!installed) {
      const declared = declaredRanges[name]
      const fix = knownFixFor(name, engineVersion)

      if (
        fix &&
        typeof declared === 'string' &&
        semver.validRange(declared) &&
        semver.gtr(fix.version, declared)
      ) {
        conflicts.push({name, declared, fixedIn: fix.version})
      } else {
        unreadable.push(name)
      }

      continue
    }

    const range = installed.peerDependencies?.[RSPACK]
    if (typeof range !== 'string' || !range.trim()) continue
    if (!semver.validRange(range)) continue

    if (semver.satisfies(engineVersion, range, {includePrerelease: true})) {
      continue
    }

    conflicts.push({
      name,
      version: String(installed.version || 'unknown'),
      range
    })
  }

  return {conflicts, unreadable}
}

export function describeRspackPeerConflicts(
  conflicts: RspackPeerConflict[],
  engineVersion: string
): string {
  const major = semver.major(engineVersion)

  return conflicts
    .map((conflict) =>
      'range' in conflict
        ? `${conflict.name} ${conflict.version} accepts ${RSPACK} ${conflict.range}, the engine ships ${engineVersion}`
        : `${conflict.name} ${conflict.declared} is declared but not installed and stays below ${conflict.fixedIn}, the first release whose peer range accepts ${RSPACK} ${major}.x (the engine ships ${engineVersion})`
    )
    .join('. ')
}

export function describeUnreadableDependencies(unreadable: string[]): string {
  const shown = unreadable.slice(0, 6).join(', ')
  const rest = unreadable.length - 6
  const one = unreadable.length === 1

  return (
    `could not read ${unreadable.length} direct ` +
    `${one ? 'dependency' : 'dependencies'} (${shown}` +
    `${rest > 0 ? ` and ${rest} more` : ''}), ` +
    `${one ? `its ${RSPACK} peer range is` : `their ${RSPACK} peer ranges are`} unverified`
  )
}

export function remedyRspackPeerConflicts(
  conflicts: RspackPeerConflict[],
  engineVersion: string
): string {
  const major = semver.major(engineVersion)

  return conflicts
    .map((conflict) => {
      const fix = knownFixFor(conflict.name, engineVersion)

      return fix
        ? `Upgrade ${conflict.name} to ${fix.version} or newer, its peer range accepts ${RSPACK} ${major}, then install again`
        : `Upgrade ${conflict.name} to a release whose ${RSPACK} peer range accepts ${major}.x, then install again`
    })
    .join('. ')
}
