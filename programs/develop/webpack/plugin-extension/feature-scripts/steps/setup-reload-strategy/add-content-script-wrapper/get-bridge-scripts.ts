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

export function getMainWorldBridgeScripts(manifestPath: string): FilepathList {
  const bridgeScripts: FilepathList = {}

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const contentScripts: any[] = Array.isArray(raw?.content_scripts)
      ? raw.content_scripts
      : []
    const originalCount = contentScripts.length

    // Find the bridge source file by checking multiple possible locations
    const bridgeSourceCandidates = [
      // Same directory (source tree)
      path.resolve(__dirname, 'main-world-bridge.js'),
      // Built package (dist) – emitted by rslib as `dist/main-world-bridge.js`
      path.resolve(__dirname, '../../../../../../main-world-bridge.js')
    ]

    const bridgeSource =
      bridgeSourceCandidates.find((p) => fs.existsSync(p)) ||
      bridgeSourceCandidates[0]

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
