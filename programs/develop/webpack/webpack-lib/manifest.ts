import * as fs from 'fs'
import {type Compilation} from '@rspack/core'
import {CHROMIUM_BASED_BROWSERS, GECKO_BASED_BROWSERS} from './constants'
import {type Manifest} from '../webpack-types'
import {DevOptions} from '../types/options'

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  if (
    (compilation as any).getAsset?.('manifest.json') ||
    (compilation as any).assets?.['manifest.json']
  ) {
    const source = (compilation as any).assets['manifest.json']?.source?.()
    const manifest =
      typeof source === 'function' ? source().toString() : String(source || '')
    return JSON.parse(manifest || '{}')
  }

  // Prefer direct fs read to support ESM and test environments reliably
  try {
    const text = fs.readFileSync(manifestPath, 'utf8')
    return JSON.parse(text)
  } catch {
    // Fallback to require when available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(manifestPath)
  }
}

export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  const isChromiumTarget =
    CHROMIUM_BASED_BROWSERS.includes(browser as any) ||
    String(browser).includes('chromium')

  const isGeckoTarget =
    GECKO_BASED_BROWSERS.includes(browser as any) ||
    String(browser).includes('gecko')

  const chromiumPrefixes = new Set(['chromium', 'chrome', 'edge'])
  const geckoPrefixes = new Set(['gecko', 'firefox'])

  const patchedManifest = JSON.parse(
    JSON.stringify(manifest),
    function reviver(this: any, key: string, value: any) {
      const indexOfColon = key.indexOf(':')

      // Retain plain keys.
      if (indexOfColon === -1) {
        return value
      }

      // Replace browser:key keys.
      const prefix = key.substring(0, indexOfColon)

      if (
        // exact browser match (e.g., 'firefox')
        prefix === browser ||
        // chromium family
        (isChromiumTarget && chromiumPrefixes.has(prefix)) ||
        // gecko/firefox family
        (isGeckoTarget && geckoPrefixes.has(prefix))
      ) {
        this[key.substring(indexOfColon + 1)] = value
      }

      // Implicitly delete the key otherwise.
    }
  )

  return patchedManifest
}
