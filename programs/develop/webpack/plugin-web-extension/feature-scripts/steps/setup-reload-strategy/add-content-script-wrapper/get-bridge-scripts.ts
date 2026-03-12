// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import path from 'path'
import fs from 'fs'
import type {FilepathList} from '../../../../../webpack-types'

function findPackageRoot(startDir: string): string | undefined {
  let current = startDir
  for (let i = 0; i < 15; i++) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
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
    // Source tree: same directory as this file.
    path.resolve(lookupDir, 'main-world-bridge'),
    // Monorepo/source tree fallback when running from compiled output.
    packageRoot
      ? path.resolve(
          packageRoot,
          'webpack/plugin-web-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/main-world-bridge'
        )
      : undefined,
    // Published/compiled package fallback.
    packageRoot
      ? path.resolve(packageRoot, 'dist', 'main-world-bridge')
      : undefined
  ])
}

export function getMainWorldBridgeScripts(manifestPath: string): FilepathList {
  const bridgeScripts: FilepathList = {}

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const contentScripts: any[] = Array.isArray(raw?.content_scripts)
      ? raw.content_scripts
      : []
    const originalCount = contentScripts.length

    const bridgeSource = resolveMainWorldBridgeSourcePath()

    if (!bridgeSource) {
      return bridgeScripts
    }

    // Create bridge entries for each MAIN world content script
    let bridgeOrdinal = 0
    for (let i = 0; i < contentScripts.length; i++) {
      const cs = contentScripts[i]

      if (cs?.world !== 'MAIN') continue

      const bridgeIndex = originalCount + bridgeOrdinal++
      bridgeScripts[`content_scripts/content-${bridgeIndex}`] = bridgeSource
    }
  } catch {
    // ignore: bridge is best-effort and only needed for MAIN world users
  }

  return bridgeScripts
}
