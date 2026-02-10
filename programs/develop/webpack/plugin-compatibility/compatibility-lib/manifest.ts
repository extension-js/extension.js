//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import {type Compilation} from '@rspack/core'
import type {Manifest, DevOptions} from '../../webpack-types'

function parseJsonSafe(text: string) {
  const s = text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return JSON.parse(s || '{}')
}

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  const readAssetSource = (asset: any): string => {
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

  try {
    const text = fs.readFileSync(manifestPath, 'utf8')
    return parseJsonSafe(text)
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(manifestPath)
  }
}

export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  const CHROMIUM_BASED_BROWSERS = ['chrome', 'edge']
  const GECKO_BASED_BROWSERS = ['firefox']

  const isChromiumTarget =
    CHROMIUM_BASED_BROWSERS.includes(browser) ||
    String(browser).includes('chromium')

  const isGeckoTarget =
    GECKO_BASED_BROWSERS.includes(browser) || String(browser).includes('gecko')

  const chromiumPrefixes = new Set(['chromium', 'chrome', 'edge'])
  const geckoPrefixes = new Set(['gecko', 'firefox'])

  const patchedManifest = JSON.parse(
    JSON.stringify(manifest),
    function reviver(this: any, key: string, value: any) {
      const indexOfColon = key.indexOf(':')
      if (indexOfColon === -1) return value

      const prefix = key.substring(0, indexOfColon)
      if (
        prefix === browser ||
        (isChromiumTarget && chromiumPrefixes.has(prefix)) ||
        (isGeckoTarget && geckoPrefixes.has(prefix))
      ) {
        this[key.substring(indexOfColon + 1)] = value
      }
    }
  )

  return patchedManifest
}
