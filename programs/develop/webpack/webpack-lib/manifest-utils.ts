import {type Manifest} from '../webpack-types'
import {DevOptions} from '../types/options'

export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  const CHROMIUM_BASED_BROWSERS = ['chrome', 'edge']
  const GECKO_BASED_BROWSERS = ['firefox']

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
