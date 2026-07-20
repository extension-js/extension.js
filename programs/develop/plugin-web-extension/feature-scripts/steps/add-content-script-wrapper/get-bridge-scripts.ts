// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'fs'
import path from 'path'
import {filterKeysForThisBrowser} from '../../../../lib/manifest-utils'
import {stripBom} from '../../../../lib/parse-json-safe'
import {PROJECT_MANIFEST_FILENAMES} from '../../../../lib/project-manifest'
import type {DevOptions, FilepathList} from '../../../../types'
import {getCanonicalContentScriptEntryName} from '../../contracts'

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
    // Source tree: same directory as this file.
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

export function getMainWorldBridgeScripts(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome'
): FilepathList {
  const bridgeScripts: FilepathList = {}

  try {
    const raw = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf-8')))
    // Resolve browser-prefixed keys (`chromium:world`, `firefox:world`, …)
    // before scanning: the emitted manifest inserts bridges against the
    // FILTERED manifest, so the entries compiled here must key off the same
    // shape or the manifest references bridge bundles that never build.
    const resolved = filterKeysForThisBrowser(raw, browser)
    const contentScripts: any[] = Array.isArray(resolved?.content_scripts)
      ? resolved.content_scripts
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
      bridgeScripts[getCanonicalContentScriptEntryName(bridgeIndex)] =
        bridgeSource
    }
  } catch {
    // ignore: bridge is best-effort and only needed for MAIN world users
  }

  return bridgeScripts
}
