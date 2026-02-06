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

export function getMainWorldBridgeScripts(manifestPath: string): FilepathList {
  const bridgeScripts: FilepathList = {}

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const contentScripts: any[] = Array.isArray(raw?.content_scripts)
      ? raw.content_scripts
      : []
    const originalCount = contentScripts.length

    const packageRoot = findPackageRoot(__dirname)
    const bridgeSourceCandidates = [
      // Same directory (source tree or dist tree)
      path.resolve(__dirname, 'main-world-bridge.js'),
      // Monorepo/source tree fallback (when running from dist/)
      packageRoot
        ? path.resolve(
            packageRoot,
            'webpack/plugin-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/main-world-bridge.js'
          )
        : undefined,
      // Built package (dist) – emitted by rslib as `dist/main-world-bridge.js`
      packageRoot
        ? path.resolve(packageRoot, 'main-world-bridge.js')
        : undefined
    ].filter((candidate): candidate is string => Boolean(candidate))

    const bridgeSource =
      bridgeSourceCandidates.find((p) => fs.existsSync(p)) || undefined

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
