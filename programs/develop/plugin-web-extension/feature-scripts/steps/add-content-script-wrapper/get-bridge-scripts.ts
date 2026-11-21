// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import {filterKeysForThisBrowser} from '../../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../../lib/parse-json-safe'
import {PROJECT_MANIFEST_FILENAMES} from '../../../../lib/project-manifest'
import type {DevOptions, FilepathList, Manifest} from '../../../../types'
import {
  getCanonicalContentScriptEntryName,
  mainWorldBridgeIndexes
} from '../../contracts'

function findPackageRoot(startDir: string): string | undefined {
  let current = startDir

  for (let i = 0; i < 15; i++) {
    if (
      PROJECT_MANIFEST_FILENAMES.some((filename) =>
        fs.existsSync(path.join(current, filename))
      )
    ) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) break

    current = parent
  }

  return undefined
}

function resolveExistingFile(
  candidates: Array<string | undefined>
): string | undefined {
  const suffixes = ['', '.js', '.cjs', '.mjs']

  for (const candidate of candidates) {
    if (!candidate) continue

    for (const suffix of suffixes) {
      const resolved = suffix ? `${candidate}${suffix}` : candidate

      if (fs.existsSync(resolved)) {
        return resolved
      }
    }
  }

  return undefined
}

export function resolveMainWorldBridgeSourcePath(options?: {
  lookupDir?: string
  packageRoot?: string
}): string | undefined {
  const lookupDir = options?.lookupDir || __dirname
  const packageRoot = options?.packageRoot || findPackageRoot(lookupDir)

  return resolveExistingFile([
    path.resolve(lookupDir, 'main-world-bridge'),
    // Monorepo/source tree fallback when running from compiled output.
    packageRoot
      ? path.resolve(
          packageRoot,
          'plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/main-world-bridge'
        )
      : undefined,
    // Published/compiled package fallback.
    packageRoot
      ? path.resolve(packageRoot, 'dist', 'main-world-bridge')
      : undefined
  ])
}

// Each MAIN-world script gets an isolated-world bridge listed after every
// declared script, so its index is the declared count plus its ordinal.
export function getMainWorldBridgePairs(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome'
): Array<{mainIndex: number; bridgeIndex: number}> {
  try {
    const raw = parseAuthoredJson<Manifest>(
      fs.readFileSync(manifestPath, 'utf-8')
    )
    // Resolve browser-prefixed keys before scanning: entries compiled here
    // must key off the same FILTERED shape the emitted manifest uses.
    const resolved = filterKeysForThisBrowser(raw, browser)

    return mainWorldBridgeIndexes(resolved?.content_scripts)
  } catch {
    // The manifest feature reports a manifest that does not read or parse,
    // and that build fails there, so no bridge is planned for it here.
    return []
  }
}

export function getMainWorldBridgeScripts(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome'
): FilepathList {
  const bridgeScripts: FilepathList = {}
  const bridgeSource = resolveMainWorldBridgeSourcePath()

  if (!bridgeSource) return bridgeScripts

  for (const {bridgeIndex} of getMainWorldBridgePairs(manifestPath, browser)) {
    bridgeScripts[getCanonicalContentScriptEntryName(bridgeIndex)] =
      bridgeSource
  }

  return bridgeScripts
}
