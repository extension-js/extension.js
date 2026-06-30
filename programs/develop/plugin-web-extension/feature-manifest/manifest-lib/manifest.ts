// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {createRequire} from 'module'
import {type Compilation} from '@rspack/core'
import type {Manifest, DevOptions} from '../../../types'
import {getManifestOverrides} from '../manifest-overrides'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'

const cjsRequire = createRequire(import.meta.url)

const INTERNAL_MANIFEST_SOURCE = '__extensionjs_manifest_source__'
const INTERNAL_MANIFEST_CURRENT_SOURCE =
  '__extensionjs_manifest_current_source__'

function readAssetSource(asset: any): string {
  if (!asset) return ''

  const source = asset.source

  if (typeof source === 'string') return source

  if (typeof source === 'function') {
    const out = source()

    return typeof out === 'string' ? out : String(out || '')
  }

  if (source && typeof source.source === 'function') {
    const out = source.source()

    return typeof out === 'string' ? out : String(out || '')
  }

  return ''
}

export function setOriginalManifestContent(
  compilation: Compilation,
  source: string
): void {
  ;(compilation as any)[INTERNAL_MANIFEST_SOURCE] = source
}

export function getOriginalManifestContent(
  compilation: Compilation
): string | undefined {
  return (compilation as any)[INTERNAL_MANIFEST_SOURCE]
}

export function setCurrentManifestContent(
  compilation: Compilation,
  source: string
): void {
  ;(compilation as any)[INTERNAL_MANIFEST_CURRENT_SOURCE] = source
}

export function getCurrentManifestContent(
  compilation: Compilation
): string | undefined {
  return (compilation as any)[INTERNAL_MANIFEST_CURRENT_SOURCE]
}

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  const currentManifest = getCurrentManifestContent(compilation)
  if (currentManifest) {
    return parseJsonSafe(currentManifest)
  }

  const getAsset = compilation.getAsset

  if (typeof getAsset === 'function') {
    const manifestAsset = getAsset.call(compilation, 'manifest.json')
    const manifest = readAssetSource(manifestAsset)

    if (manifest) {
      return parseJsonSafe(manifest)
    }
  }

  const manifestAsset = compilation.assets?.['manifest.json']

  if (manifestAsset) {
    const manifest = readAssetSource(manifestAsset)

    if (manifest) {
      return parseJsonSafe(manifest)
    }
  }

  const originalManifest = getOriginalManifestContent(compilation)
  if (originalManifest) {
    return parseJsonSafe(originalManifest)
  }

  // Prefer direct fs read to support ESM and test environments reliably
  try {
    const text = fs.readFileSync(manifestPath, 'utf8')
    return parseJsonSafe(text)
  } catch {
    try {
      const resolved = cjsRequire.resolve(manifestPath)
      delete cjsRequire.cache[resolved]
    } catch {
      // resolve() can throw for unusual paths; fall through to a plain require
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return cjsRequire(manifestPath)
  }
}

// Re-export the canonical resolver (imported above) so the emission path,
// feature-scripts, and feature-html all share one implementation — including
// Safari/webkit chromium-family resolution.
export {filterKeysForThisBrowser}

export function buildCanonicalManifest(
  manifestPath: string,
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  const filteredManifest = filterKeysForThisBrowser(
    manifest,
    browser
  ) as Manifest

  return {
    ...filteredManifest,
    ...JSON.parse(getManifestOverrides(manifestPath, filteredManifest))
  } as Manifest
}
