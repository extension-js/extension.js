// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import type {Compilation} from '@rspack/core'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../../types'
import {dropPageAction, shouldDropPageAction} from '../../shared/html-surfaces'
import {getManifestOverrides} from '../manifest-overrides'

const cjsRequire = createRequire(import.meta.url)

// Manifest source strings ride per compilation; a WeakMap keeps them typed
// instead of stashing untyped string properties on the compilation object.
const manifestSourceStore = new WeakMap<
  Compilation,
  {original?: string; current?: string}
>()

function manifestSourceEntry(compilation: Compilation) {
  let entry = manifestSourceStore.get(compilation)
  if (!entry) {
    entry = {}
    manifestSourceStore.set(compilation, entry)
  }
  return entry
}

function readAssetSource(asset: {source?: unknown} | null | undefined): string {
  if (!asset) return ''

  const source = asset.source

  if (typeof source === 'string') return source

  if (typeof source === 'function') {
    const out = source()

    return typeof out === 'string' ? out : String(out || '')
  }

  if (source && typeof (source as {source?: unknown}).source === 'function') {
    const out = (source as {source: () => unknown}).source()

    return typeof out === 'string' ? out : String(out || '')
  }

  return ''
}

export function setOriginalManifestContent(
  compilation: Compilation,
  source: string
): void {
  manifestSourceEntry(compilation).original = source
}

export function getOriginalManifestContent(
  compilation: Compilation
): string | undefined {
  return manifestSourceStore.get(compilation)?.original
}

export function setCurrentManifestContent(
  compilation: Compilation,
  source: string
): void {
  manifestSourceEntry(compilation).current = source
}

export function getCurrentManifestContent(
  compilation: Compilation
): string | undefined {
  return manifestSourceStore.get(compilation)?.current
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
    const manifestAsset = getAsset.call(compilation, 'manifest.json') as
      | {source?: unknown}
      | null
      | undefined
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

// Re-export the canonical resolver so emission, feature-scripts, and
// feature-html share one implementation, incl. Safari/webkit resolution.
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

  // Chromium dropped page_action with Manifest V3; keeping the key would
  // ship a page for a surface that never shows.
  const forOverrides = shouldDropPageAction(filteredManifest, browser)
    ? dropPageAction(filteredManifest)
    : filteredManifest

  return {
    ...forOverrides,
    ...JSON.parse(getManifestOverrides(manifestPath, forOverrides))
  } as Manifest
}
